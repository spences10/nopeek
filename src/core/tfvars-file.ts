import { readFileSync } from 'node:fs';
import type { EnvEntry } from './env-file.js';

interface Token {
	type: 'identifier' | 'string' | 'equals' | 'open' | 'close' | 'eof';
	value?: string;
	line: number;
}

/**
 * Supported .tfvars syntax is deliberately limited to assignments whose values
 * are quoted strings or nested object/map literals containing the same. Keys
 * may be identifiers or quoted strings; # and // line comments are supported.
 * All other HCL expressions are rejected rather than interpreted partially.
 */
export function parse_tfvars_file(path: string): EnvEntry[] {
	const content = readFileSync(path, 'utf-8');
	if (content.startsWith('\uFEFF')) {
		throw syntax_error('UTF-8 BOM is unsupported', 1);
	}
	return new TfvarsParser(content).parse();
}

class TfvarsParser {
	private readonly tokens: Token[];
	private index = 0;
	private readonly entries: EnvEntry[] = [];
	private readonly output_keys = new Map<string, number>();

	constructor(content: string) {
		this.tokens = tokenize_tfvars(content);
	}

	parse(): EnvEntry[] {
		this.parse_assignments(false);
		this.expect('eof');
		return this.entries;
	}

	private parse_assignments(in_object: boolean): void {
		const local_keys = new Map<string, number>();
		while (this.peek().type !== (in_object ? 'close' : 'eof')) {
			if (in_object && this.peek().type === 'eof') {
				throw syntax_error('expected close', this.peek().line);
			}
			const key_token = this.peek();
			if (
				key_token.type !== 'identifier' &&
				key_token.type !== 'string'
			) {
				throw syntax_error(
					'expected an assignment key',
					key_token.line,
				);
			}
			this.index++;
			const key = key_token.value!;
			if (local_keys.has(key)) {
				throw syntax_error(
					`duplicate key ${JSON.stringify(key)}`,
					key_token.line,
				);
			}
			local_keys.set(key, key_token.line);
			this.expect('equals');

			if (this.peek().type === 'string') {
				const value = this.peek().value!;
				this.index++;
				this.add_entry(key, value, key_token.line);
			} else if (this.peek().type === 'open') {
				this.index++;
				this.parse_assignments(true);
				this.expect('close');
			} else {
				throw syntax_error(
					`unsupported non-string value for key ${JSON.stringify(key)}`,
					this.peek().line,
				);
			}
		}
	}

	private add_entry(key: string, value: string, line: number): void {
		if (is_prototype_sensitive_key(key)) {
			throw syntax_error(
				`unsupported output key ${JSON.stringify(key)}`,
				line,
			);
		}
		if (this.output_keys.has(key)) {
			throw syntax_error(
				`flattening collision for key ${JSON.stringify(key)}`,
				line,
			);
		}
		this.output_keys.set(key, line);
		this.entries.push({ key, value });
	}

	private peek(): Token {
		return this.tokens[this.index];
	}

	private expect(type: Token['type']): Token {
		const token = this.peek();
		if (token.type !== type)
			throw syntax_error(`expected ${type}`, token.line);
		this.index++;
		return token;
	}
}

function tokenize_tfvars(content: string): Token[] {
	const tokens: Token[] = [];
	let index = 0;
	let line = 1;

	while (index < content.length) {
		const ch = content[index];
		if (/\s/.test(ch)) {
			if (ch === '\n') line++;
			index++;
			continue;
		}
		if (ch === '#' || (ch === '/' && content[index + 1] === '/')) {
			while (index < content.length && content[index] !== '\n')
				index++;
			continue;
		}
		if (ch === '=') {
			tokens.push({ type: 'equals', line });
			index++;
			continue;
		}
		if (ch === '{') {
			tokens.push({ type: 'open', line });
			index++;
			continue;
		}
		if (ch === '}') {
			tokens.push({ type: 'close', line });
			index++;
			continue;
		}
		if (ch === '"') {
			const start_line = line;
			let value = '';
			let closed = false;
			index++;
			while (index < content.length) {
				const current = content[index++];
				if (current === '"') {
					closed = true;
					break;
				}
				if (current === '\n' || current === '\r') {
					throw syntax_error('newline in quoted string', start_line);
				}
				if (current === '\\') {
					if (index >= content.length) break;
					const escaped = content[index++];
					const decoded: Record<string, string> = {
						'"': '"',
						'\\': '\\',
						n: '\n',
						r: '\r',
						t: '\t',
					};
					if (!(escaped in decoded)) {
						throw syntax_error(
							'unsupported string escape',
							start_line,
						);
					}
					value += decoded[escaped];
				} else {
					value += current;
				}
			}
			if (!closed)
				throw syntax_error('unterminated quoted string', start_line);
			tokens.push({ type: 'string', value, line: start_line });
			continue;
		}
		const match = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(
			content.slice(index),
		);
		if (match) {
			tokens.push({ type: 'identifier', value: match[0], line });
			index += match[0].length;
			continue;
		}
		throw syntax_error('unsupported tfvars syntax', line);
	}

	tokens.push({ type: 'eof', line });
	return tokens;
}

/**
 * Supported .tfvars.json syntax is an object tree whose leaves are strings.
 * Arrays, null, numbers, booleans, duplicate object keys, and flattened output
 * key collisions are rejected.
 */
export function parse_tfvars_json_file(path: string): EnvEntry[] {
	return new StrictJsonTfvarsParser(
		readFileSync(path, 'utf-8'),
	).parse();
}

class StrictJsonTfvarsParser {
	private index = 0;
	private line = 1;
	private readonly entries: EnvEntry[] = [];
	private readonly output_keys = new Set<string>();

	constructor(private readonly content: string) {}

	parse(): EnvEntry[] {
		this.skip_space();
		this.parse_object();
		this.skip_space();
		if (this.index !== this.content.length)
			this.fail('trailing JSON content');
		return this.entries;
	}

	private parse_object(): void {
		this.expect('{');
		this.skip_space();
		const local_keys = new Set<string>();
		if (this.consume('}')) return;
		while (true) {
			const key_line = this.line;
			const key = this.parse_string();
			if (local_keys.has(key))
				this.fail(`duplicate key ${JSON.stringify(key)}`, key_line);
			local_keys.add(key);
			this.skip_space();
			this.expect(':');
			this.skip_space();
			if (this.content[this.index] === '"') {
				const value = this.parse_string();
				if (is_prototype_sensitive_key(key)) {
					this.fail(
						`unsupported output key ${JSON.stringify(key)}`,
						key_line,
					);
				}
				if (this.output_keys.has(key)) {
					this.fail(
						`flattening collision for key ${JSON.stringify(key)}`,
						key_line,
					);
				}
				this.output_keys.add(key);
				this.entries.push({ key, value });
			} else if (this.content[this.index] === '{') {
				this.parse_object();
			} else {
				this.fail(
					`unsupported non-string value for key ${JSON.stringify(key)}`,
				);
			}
			this.skip_space();
			if (this.consume('}')) return;
			this.expect(',');
			this.skip_space();
		}
	}

	private parse_string(): string {
		this.expect('"');
		let value = '';
		while (this.index < this.content.length) {
			const ch = this.content[this.index++];
			if (ch === '"') return value;
			if (ch === '\n' || ch === '\r' || ch.charCodeAt(0) < 0x20)
				this.fail('invalid JSON string');
			if (ch !== '\\') {
				value += ch;
				continue;
			}
			if (this.index >= this.content.length) break;
			const escaped = this.content[this.index++];
			const simple: Record<string, string> = {
				'"': '"',
				'\\': '\\',
				'/': '/',
				b: '\b',
				f: '\f',
				n: '\n',
				r: '\r',
				t: '\t',
			};
			if (escaped in simple) value += simple[escaped];
			else if (escaped === 'u') {
				const hex = this.content.slice(this.index, this.index + 4);
				if (!/^[0-9a-fA-F]{4}$/.test(hex))
					this.fail('invalid JSON unicode escape');
				value += String.fromCharCode(Number.parseInt(hex, 16));
				this.index += 4;
			} else this.fail('invalid JSON escape');
		}
		this.fail('unterminated JSON string');
	}

	private skip_space(): void {
		while (/[ \t\r\n]/.test(this.content[this.index] ?? '')) {
			if (this.content[this.index] === '\n') this.line++;
			this.index++;
		}
	}

	private consume(ch: string): boolean {
		if (this.content[this.index] !== ch) return false;
		this.index++;
		return true;
	}

	private expect(ch: string): void {
		if (!this.consume(ch))
			this.fail(`expected ${JSON.stringify(ch)}`);
	}

	private fail(message: string, line = this.line): never {
		throw syntax_error(message, line, 'tfvars.json');
	}
}

function is_prototype_sensitive_key(key: string): boolean {
	return (
		key === '__proto__' ||
		key === 'prototype' ||
		key === 'constructor'
	);
}

function syntax_error(
	message: string,
	line: number,
	format = 'tfvars',
): Error {
	return new Error(`Invalid ${format} at line ${line}: ${message}`);
}

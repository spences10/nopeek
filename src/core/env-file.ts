import { readFileSync } from 'node:fs';
import {
	parse_tfvars_content,
	parse_tfvars_file,
	parse_tfvars_json_content,
	parse_tfvars_json_file,
} from './tfvars-file.js';

export interface EnvEntry {
	key: string;
	value: string;
}

export function parse_file(path: string): EnvEntry[] {
	if (path.endsWith('.tfvars.json'))
		return parse_tfvars_json_file(path);
	if (path.endsWith('.tfvars')) return parse_tfvars_file(path);
	return parse_env_file(path);
}

export function parse_content(
	path: string,
	content: string,
): EnvEntry[] {
	if (path.endsWith('.tfvars.json'))
		return parse_tfvars_json_content(content);
	if (path.endsWith('.tfvars')) return parse_tfvars_content(content);
	return parse_env_content(content);
}

/**
 * Supported dotenv syntax: blank/comment lines and optional `export` followed
 * by NAME=VALUE. Names match [A-Za-z_][A-Za-z0-9_]*. Values may be unquoted,
 * single quoted, or double quoted; double quotes support \\, \", \n, \r and \t.
 * Inline comments require whitespace before #, so a value-leading # is data.
 * Expansion and multiline values
 * are intentionally unsupported.
 */
export function parse_env_file(path: string): EnvEntry[] {
	return parse_env_content(readFileSync(path, 'utf-8'));
}

export function parse_env_content(content: string): EnvEntry[] {
	if (content.startsWith('\uFEFF'))
		throw env_error('UTF-8 BOM is unsupported', 1);
	const entries: EnvEntry[] = [];
	const keys = new Set<string>();

	for (const [index, raw_line] of content.split(/\r?\n/).entries()) {
		const line_number = index + 1;
		const parsed = parse_env_line(raw_line, line_number);
		if (!parsed) continue;
		if (is_prototype_sensitive_key(parsed.key)) {
			throw env_error(
				`unsupported key ${JSON.stringify(parsed.key)}`,
				line_number,
			);
		}
		if (keys.has(parsed.key)) {
			throw env_error(
				`duplicate key ${JSON.stringify(parsed.key)}`,
				line_number,
			);
		}
		keys.add(parsed.key);
		entries.push(parsed);
	}

	return entries;
}

function parse_env_line(
	raw_line: string,
	line_number: number,
): EnvEntry | null {
	let line = raw_line.trim();
	if (!line || line.startsWith('#')) return null;

	if (/^export[ \t]+(?=[A-Za-z_][A-Za-z0-9_]*\s*=)/.test(line)) {
		line = line.replace(/^export[ \t]+/, '');
	}

	const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
	if (!match)
		throw env_error('expected NAME=VALUE assignment', line_number);
	const key = match[1];
	const raw_value = line.slice(match[0].length).trimStart();
	return { key, value: parse_env_value(raw_value, key, line_number) };
}

function parse_env_value(
	raw_value: string,
	key: string,
	line: number,
): string {
	if (!raw_value) return '';
	const quote = raw_value[0];
	if (quote === '"' || quote === "'")
		return parse_quoted_value(raw_value, quote, key, line);
	return strip_inline_comment(raw_value).trimEnd();
}

function parse_quoted_value(
	raw_value: string,
	quote: '"' | "'",
	key: string,
	line: number,
): string {
	let value = '';
	for (let index = 1; index < raw_value.length; index++) {
		const ch = raw_value[index];
		if (ch === quote) {
			const trailing = raw_value.slice(index + 1);
			if (trailing.trim() && !/^\s+#/.test(trailing)) {
				throw env_error(
					`unexpected content after value for key ${JSON.stringify(key)}`,
					line,
				);
			}
			return value;
		}
		if (quote === '"' && ch === '\\') {
			const escaped = raw_value[++index];
			const decoded: Record<string, string> = {
				'"': '"',
				'\\': '\\',
				n: '\n',
				r: '\r',
				t: '\t',
			};
			if (escaped === undefined || !(escaped in decoded)) {
				throw env_error(
					`unsupported escape for key ${JSON.stringify(key)}`,
					line,
				);
			}
			value += decoded[escaped];
			continue;
		}
		value += ch;
	}
	throw env_error(
		`unterminated quoted value for key ${JSON.stringify(key)}`,
		line,
	);
}

function strip_inline_comment(value: string): string {
	for (let index = 0; index < value.length; index++) {
		if (
			value[index] === '#' &&
			index > 0 &&
			/\s/.test(value[index - 1])
		) {
			return value.slice(0, index);
		}
	}
	return value;
}

function is_prototype_sensitive_key(key: string): boolean {
	return (
		key === '__proto__' ||
		key === 'prototype' ||
		key === 'constructor'
	);
}

function env_error(message: string, line: number): Error {
	return new Error(`Invalid dotenv at line ${line}: ${message}`);
}

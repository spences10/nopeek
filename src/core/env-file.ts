import { readFileSync } from 'node:fs';
import {
	parse_tfvars_file,
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

export function parse_env_file(path: string): EnvEntry[] {
	const content = readFileSync(path, 'utf-8');
	const entries: EnvEntry[] = [];

	for (const raw_line of content.split(/\r?\n/)) {
		const parsed = parse_env_line(raw_line);
		if (parsed) entries.push(parsed);
	}

	return entries;
}

function parse_env_line(raw_line: string): EnvEntry | null {
	let line = raw_line.trim();
	if (!line || line.startsWith('#')) return null;

	if (line.startsWith('export ')) {
		line = line.slice('export '.length).trimStart();
	}

	const eq = line.indexOf('=');
	if (eq === -1) return null;

	const key = line.slice(0, eq).trim();
	const raw_value = line.slice(eq + 1).trimStart();
	const value = parse_env_value(raw_value);

	if (!key) return null;
	return { key, value };
}

function parse_env_value(raw_value: string): string {
	if (!raw_value) return '';

	const quote = raw_value[0];
	if (quote === '"' || quote === "'") {
		return parse_quoted_value(raw_value, quote);
	}

	return strip_inline_comment(raw_value).trimEnd();
}

function parse_quoted_value(
	raw_value: string,
	quote: '"' | "'",
): string {
	let value = '';
	let escaped = false;

	for (let i = 1; i < raw_value.length; i++) {
		const ch = raw_value[i];

		if (quote === '"' && escaped) {
			value += decode_escape(ch);
			escaped = false;
			continue;
		}

		if (quote === '"' && ch === '\\') {
			escaped = true;
			continue;
		}

		if (ch === quote) return value;
		value += ch;
	}

	return value;
}

function decode_escape(ch: string): string {
	if (ch === 'n') return '\n';
	if (ch === 'r') return '\r';
	if (ch === 't') return '\t';
	return ch;
}

function strip_inline_comment(value: string): string {
	for (let i = 0; i < value.length; i++) {
		if (value[i] === '#' && (i === 0 || /\s/.test(value[i - 1]))) {
			return value.slice(0, i);
		}
	}
	return value;
}

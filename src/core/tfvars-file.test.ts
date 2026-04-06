import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse_file } from './env-file.js';
import {
	parse_tfvars_file,
	parse_tfvars_json_file,
} from './tfvars-file.js';

function tmp_file(name: string, content: string): string {
	const dir = join(
		tmpdir(),
		`nopeek-test-${randomBytes(4).toString('hex')}`,
	);
	mkdirSync(dir, { recursive: true });
	const path = join(dir, name);
	writeFileSync(path, content);
	return path;
}

describe('parse_tfvars_file', () => {
	it('parses simple key = "value" assignments', () => {
		const path = tmp_file(
			'test.tfvars',
			'db_password = "s3cret"\napi_key = "sk-abc123"',
		);
		const entries = parse_tfvars_file(path);
		expect(entries).toEqual([
			{ key: 'db_password', value: 's3cret' },
			{ key: 'api_key', value: 'sk-abc123' },
		]);
	});

	it('handles values with special characters', () => {
		const path = tmp_file(
			'test.tfvars',
			'password = "p@ss+w0rd/with=chars&more"',
		);
		const entries = parse_tfvars_file(path);
		expect(entries[0].value).toBe('p@ss+w0rd/with=chars&more');
	});

	it('skips comments (# and //)', () => {
		const path = tmp_file(
			'test.tfvars',
			'# This is a comment\n// Another comment\nkey = "value"',
		);
		const entries = parse_tfvars_file(path);
		expect(entries).toHaveLength(1);
		expect(entries[0].key).toBe('key');
	});

	it('skips map/object blocks', () => {
		const path = tmp_file(
			'test.tfvars',
			[
				'password = "secret"',
				'container_env = {',
				'  NODE_ENV = "production"',
				'  API_KEY  = "sk-123"',
				'}',
				'other_key = "value"',
			].join('\n'),
		);
		const entries = parse_tfvars_file(path);
		expect(entries).toEqual([
			{ key: 'password', value: 'secret' },
			{ key: 'other_key', value: 'value' },
		]);
	});

	it('skips list blocks', () => {
		const path = tmp_file(
			'test.tfvars',
			[
				'secret = "keep"',
				'zones = [',
				'  "us-east-1a",',
				'  "us-east-1b",',
				']',
				'token = "also-keep"',
			].join('\n'),
		);
		const entries = parse_tfvars_file(path);
		expect(entries).toEqual([
			{ key: 'secret', value: 'keep' },
			{ key: 'token', value: 'also-keep' },
		]);
	});

	it('handles varied spacing', () => {
		const path = tmp_file(
			'test.tfvars',
			'tight="value1"\nspacy   =   "value2"',
		);
		const entries = parse_tfvars_file(path);
		expect(entries).toEqual([
			{ key: 'tight', value: 'value1' },
			{ key: 'spacy', value: 'value2' },
		]);
	});

	it('skips unquoted values (numbers, bools)', () => {
		const path = tmp_file(
			'test.tfvars',
			'port = 8080\nenabled = true\nname = "keep-this"',
		);
		const entries = parse_tfvars_file(path);
		expect(entries).toEqual([{ key: 'name', value: 'keep-this' }]);
	});

	it('skips blank lines', () => {
		const path = tmp_file('test.tfvars', '\n\nkey = "value"\n\n');
		const entries = parse_tfvars_file(path);
		expect(entries).toHaveLength(1);
	});
});

describe('parse_tfvars_json_file', () => {
	it('extracts top-level string values', () => {
		const path = tmp_file(
			'test.tfvars.json',
			JSON.stringify({
				db_password: 's3cret',
				api_key: 'sk-abc123',
				port: 8080,
				enabled: true,
				tags: { env: 'prod' },
			}),
		);
		const entries = parse_tfvars_json_file(path);
		expect(entries).toEqual([
			{ key: 'db_password', value: 's3cret' },
			{ key: 'api_key', value: 'sk-abc123' },
		]);
	});

	it('returns empty for no string values', () => {
		const path = tmp_file(
			'test.tfvars.json',
			JSON.stringify({ port: 8080, enabled: true }),
		);
		const entries = parse_tfvars_json_file(path);
		expect(entries).toEqual([]);
	});
});

describe('parse_file dispatcher', () => {
	it('routes .tfvars to tfvars parser', () => {
		const path = tmp_file('prod.tfvars', 'secret = "abc"');
		const entries = parse_file(path);
		expect(entries).toEqual([{ key: 'secret', value: 'abc' }]);
	});

	it('routes .tfvars.json to JSON parser', () => {
		const path = tmp_file(
			'prod.tfvars.json',
			JSON.stringify({ key: 'val' }),
		);
		const entries = parse_file(path);
		expect(entries).toEqual([{ key: 'key', value: 'val' }]);
	});

	it('routes .env to env parser', () => {
		const path = tmp_file('.env', 'FOO=bar');
		const entries = parse_file(path);
		expect(entries).toEqual([{ key: 'FOO', value: 'bar' }]);
	});
});

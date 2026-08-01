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

function thrown_message(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		return String(error);
	}
	throw new Error('expected parser to throw');
}

describe('parse_tfvars_file', () => {
	it('parses the supported strict HCL subset', () => {
		const path = tmp_file(
			'test.tfvars',
			[
				'# top-level strings and nested maps are supported',
				'db_password = "s3cret"',
				'container_env = {',
				'  NODE_ENV = "production"',
				'  "API_KEY" = "sk-123" // quoted key',
				'  nested = { REGION = "us-east-1" }',
				'}',
				'escaped = "line\\nnext"',
			].join('\n'),
		);
		expect(parse_tfvars_file(path)).toEqual([
			{ key: 'db_password', value: 's3cret' },
			{ key: 'NODE_ENV', value: 'production' },
			{ key: 'API_KEY', value: 'sk-123' },
			{ key: 'REGION', value: 'us-east-1' },
			{ key: 'escaped', value: 'line\nnext' },
		]);
	});

	it.each([
		[
			'duplicate key',
			'token = "first"\ntoken = "second"',
			'duplicate key "token"',
		],
		[
			'flattening collision',
			'TOKEN = "first"\nenv = { TOKEN = "second" }',
			'flattening collision for key "TOKEN"',
		],
		['BOM', '\uFEFFtoken = "secret"', 'UTF-8 BOM is unsupported'],
		[
			'prototype-sensitive output name',
			'container = { constructor = "secret" }',
			'unsupported output key "constructor"',
		],
		[
			'comma syntax',
			'env = { TOKEN = "secret", OTHER = "value" }',
			'unsupported tfvars syntax',
		],
		['number', 'port = 8080', 'unsupported tfvars syntax'],
		[
			'boolean',
			'enabled = true',
			'unsupported non-string value for key "enabled"',
		],
		['list', 'zones = ["a"]', 'unsupported tfvars syntax'],
		['expression', 'token = var.token', 'unsupported tfvars syntax'],
		[
			'unterminated quote',
			'token = "secret',
			'unterminated quoted string',
		],
		[
			'bad escape',
			'token = "secret\\x"',
			'unsupported string escape',
		],
		['missing close', 'env = { token = "secret"', 'expected close'],
	])(
		'rejects %s with secret-safe diagnostics',
		(_name, content, diagnostic) => {
			const message = thrown_message(() =>
				parse_tfvars_file(tmp_file('bad.tfvars', content)),
			);
			expect(message).toContain(diagnostic);
			expect(message).not.toContain('first');
			expect(message).not.toContain('second');
			expect(message).not.toContain('secret');
		},
	);
});

describe('parse_tfvars_json_file', () => {
	it('extracts strings from a supported nested object', () => {
		const path = tmp_file(
			'test.tfvars.json',
			'{"db_password":"s3cret","tags":{"env":"prod","region":"us-east-1"}}',
		);
		expect(parse_tfvars_json_file(path)).toEqual([
			{ key: 'db_password', value: 's3cret' },
			{ key: 'env', value: 'prod' },
			{ key: 'region', value: 'us-east-1' },
		]);
	});

	it.each([
		[
			'duplicate key',
			'{"token":"first","token":"second"}',
			'duplicate key "token"',
		],
		[
			'flattening collision',
			'{"TOKEN":"first","env":{"TOKEN":"second"}}',
			'flattening collision for key "TOKEN"',
		],
		[
			'prototype-sensitive output name',
			'{"nested":{"__proto__":"secret"}}',
			'unsupported output key "__proto__"',
		],
		['BOM', '\uFEFF{"token":"secret"}', 'expected "{"'],
		[
			'non-JSON whitespace',
			'{"token"\u00A0:"secret"}',
			'expected ":"',
		],
		[
			'number',
			'{"port":8080}',
			'unsupported non-string value for key "port"',
		],
		[
			'boolean',
			'{"enabled":true}',
			'unsupported non-string value for key "enabled"',
		],
		[
			'null',
			'{"token":null}',
			'unsupported non-string value for key "token"',
		],
		[
			'array',
			'{"tokens":["secret"]}',
			'unsupported non-string value for key "tokens"',
		],
		['malformed JSON', '{"token":"secret"', 'expected ","'],
		[
			'trailing JSON',
			'{"token":"secret"} nope',
			'trailing JSON content',
		],
	])(
		'rejects %s with secret-safe diagnostics',
		(_name, content, diagnostic) => {
			const message = thrown_message(() =>
				parse_tfvars_json_file(tmp_file('bad.tfvars.json', content)),
			);
			expect(message).toContain(diagnostic);
			expect(message).not.toContain('first');
			expect(message).not.toContain('second');
			expect(message).not.toContain('secret');
		},
	);
});

describe('parse_file dispatcher', () => {
	it.each([
		['prod.tfvars', 'secret = "abc"'],
		['prod.tfvars.json', '{"secret":"abc"}'],
		['.env', 'secret=abc'],
	])('routes %s to its parser', (name, content) => {
		expect(parse_file(tmp_file(name, content))).toEqual([
			{ key: 'secret', value: 'abc' },
		]);
	});
});

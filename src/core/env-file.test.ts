import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse_env_file } from './env-file.js';

function tmp_env(content: string): string {
	const dir = join(
		tmpdir(),
		`nopeek-test-${randomBytes(4).toString('hex')}`,
	);
	mkdirSync(dir, { recursive: true });
	const path = join(dir, '.env');
	writeFileSync(path, content);
	return path;
}

describe('parse_env_file', () => {
	it('parses supported dotenv syntax', () => {
		const path = tmp_env(
			[
				'# comment',
				'FOO=bar',
				'export DB_URL="postgres://localhost/db" # local',
				"SECRET='my secret value'",
				'URL=https://example.com?foo=bar&baz=1',
				'MULTI="line\\nnext"',
				'EMPTY=',
			].join('\n'),
		);
		expect(parse_env_file(path)).toEqual([
			{ key: 'FOO', value: 'bar' },
			{ key: 'DB_URL', value: 'postgres://localhost/db' },
			{ key: 'SECRET', value: 'my secret value' },
			{ key: 'URL', value: 'https://example.com?foo=bar&baz=1' },
			{ key: 'MULTI', value: 'line\nnext' },
			{ key: 'EMPTY', value: '' },
		]);
	});

	it('handles exact export tokens and the documented # rule', () => {
		const path = tmp_env(
			[
				'export=one',
				'exported=two',
				'export_token=three',
				'export ACTUAL=four',
				'LITERAL=a#b',
				'COMMENTED=value # comment',
				'VALUE_START=# comment',
				'QUOTED="# literal"',
			].join('\n'),
		);
		expect(parse_env_file(path)).toEqual([
			{ key: 'export', value: 'one' },
			{ key: 'exported', value: 'two' },
			{ key: 'export_token', value: 'three' },
			{ key: 'ACTUAL', value: 'four' },
			{ key: 'LITERAL', value: 'a#b' },
			{ key: 'COMMENTED', value: 'value' },
			{ key: 'VALUE_START', value: '# comment' },
			{ key: 'QUOTED', value: '# literal' },
		]);
	});

	it.each([
		['BOM', '\uFEFFTOKEN=value', 'line 1'],
		[
			'prototype-sensitive name',
			'__proto__=secret',
			'unsupported key "__proto__"',
		],
		['missing equals', 'NOPE', 'line 1'],
		['invalid name', 'BAD-NAME=value', 'line 1'],
		['malformed double quote', 'TOKEN="secret', 'TOKEN'],
		['malformed single quote', "TOKEN='secret", 'TOKEN'],
		['trailing content', 'TOKEN="secret" garbage', 'TOKEN'],
		['unsupported escape', 'TOKEN="secret\\x"', 'TOKEN'],
		[
			'duplicate key',
			'TOKEN=first\nTOKEN=second',
			'duplicate key "TOKEN"',
		],
	])(
		'rejects %s without exposing values',
		(_name, content, diagnostic) => {
			let message = '';
			try {
				parse_env_file(tmp_env(content));
			} catch (error) {
				message = String(error);
			}
			expect(message).toContain(diagnostic);
			expect(message).not.toContain('secret');
			expect(message).not.toContain('first');
			expect(message).not.toContain('second');
		},
	);
});

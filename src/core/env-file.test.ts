import { describe, expect, it } from 'vitest';
import { parse_env_file } from './env-file.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

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
	it('parses simple KEY=VALUE', () => {
		const path = tmp_env('FOO=bar\nBAZ=qux');
		const entries = parse_env_file(path);
		expect(entries).toEqual([
			{ key: 'FOO', value: 'bar' },
			{ key: 'BAZ', value: 'qux' },
		]);
	});

	it('handles double-quoted values', () => {
		const path = tmp_env('DB_URL="postgres://localhost/db"');
		const entries = parse_env_file(path);
		expect(entries[0].value).toBe('postgres://localhost/db');
	});

	it('handles single-quoted values', () => {
		const path = tmp_env("SECRET='my secret value'");
		const entries = parse_env_file(path);
		expect(entries[0].value).toBe('my secret value');
	});

	it('skips comments and blank lines', () => {
		const path = tmp_env('# comment\n\nFOO=bar\n  \n# another');
		const entries = parse_env_file(path);
		expect(entries).toHaveLength(1);
		expect(entries[0].key).toBe('FOO');
	});

	it('skips lines without =', () => {
		const path = tmp_env('NOPE\nFOO=bar');
		const entries = parse_env_file(path);
		expect(entries).toHaveLength(1);
	});

	it('handles values with = signs', () => {
		const path = tmp_env('URL=https://example.com?foo=bar&baz=1');
		const entries = parse_env_file(path);
		expect(entries[0].value).toBe(
			'https://example.com?foo=bar&baz=1',
		);
	});
});

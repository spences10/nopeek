import { existsSync, readFileSync, rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
	has_claude_env_file,
	is_claude_code,
	write_nopeek_env,
} from './session.js';

describe('has_claude_env_file', () => {
	const original = process.env.CLAUDE_ENV_FILE;

	afterEach(() => {
		if (original) {
			process.env.CLAUDE_ENV_FILE = original;
		} else {
			delete process.env.CLAUDE_ENV_FILE;
		}
	});

	it('returns false when CLAUDE_ENV_FILE is not set', () => {
		delete process.env.CLAUDE_ENV_FILE;
		expect(has_claude_env_file()).toBe(false);
	});

	it('returns true when CLAUDE_ENV_FILE is set', () => {
		process.env.CLAUDE_ENV_FILE = '/tmp/test-env';
		expect(has_claude_env_file()).toBe(true);
	});
});

describe('is_claude_code', () => {
	const origCode = process.env.CLAUDECODE;
	const origEntry = process.env.CLAUDE_CODE_ENTRYPOINT;

	afterEach(() => {
		if (origCode) {
			process.env.CLAUDECODE = origCode;
		} else {
			delete process.env.CLAUDECODE;
		}
		if (origEntry) {
			process.env.CLAUDE_CODE_ENTRYPOINT = origEntry;
		} else {
			delete process.env.CLAUDE_CODE_ENTRYPOINT;
		}
	});

	it('returns true when CLAUDECODE is set', () => {
		process.env.CLAUDECODE = '1';
		delete process.env.CLAUDE_CODE_ENTRYPOINT;
		expect(is_claude_code()).toBe(true);
	});

	it('returns true when CLAUDE_CODE_ENTRYPOINT is set', () => {
		delete process.env.CLAUDECODE;
		process.env.CLAUDE_CODE_ENTRYPOINT = 'cli';
		expect(is_claude_code()).toBe(true);
	});

	it('returns false when neither is set', () => {
		delete process.env.CLAUDECODE;
		delete process.env.CLAUDE_CODE_ENTRYPOINT;
		expect(is_claude_code()).toBe(false);
	});
});

describe('write_nopeek_env', () => {
	it('writes exports to a temp file with 0600 perms', () => {
		const path = write_nopeek_env([
			{ key: 'FOO', value: 'bar' },
			{ key: 'BAZ', value: 'hello world' },
		]);
		expect(existsSync(path)).toBe(true);
		const content = readFileSync(path, 'utf-8');
		expect(content).toContain('export FOO=bar');
		expect(content).toContain("export BAZ='hello world'");
		rmSync(path);
	});

	it('shell-escapes special characters', () => {
		const path = write_nopeek_env([
			{
				key: 'DB',
				value: "postgres://u:p@host/db?x=1&y='2'",
			},
		]);
		const content = readFileSync(path, 'utf-8');
		expect(content).toContain('export DB=');
		expect(content).not.toContain('\n\n');
		rmSync(path);
	});
});

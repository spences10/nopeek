import { existsSync, readFileSync, rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
	has_session_env_file,
	is_llm_agent_session,
	validate_key,
	write_nopeek_env,
} from './session.js';

describe('has_session_env_file', () => {
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
		expect(has_session_env_file()).toBe(false);
	});

	it('returns true when CLAUDE_ENV_FILE is set', () => {
		process.env.CLAUDE_ENV_FILE = '/tmp/test-env';
		expect(has_session_env_file()).toBe(true);
	});
});

describe('is_llm_agent_session', () => {
	const orig_env_file = process.env.CLAUDE_ENV_FILE;
	const orig_code = process.env.CLAUDECODE;
	const orig_entry = process.env.CLAUDE_CODE_ENTRYPOINT;

	afterEach(() => {
		if (orig_env_file) {
			process.env.CLAUDE_ENV_FILE = orig_env_file;
		} else {
			delete process.env.CLAUDE_ENV_FILE;
		}
		if (orig_code) {
			process.env.CLAUDECODE = orig_code;
		} else {
			delete process.env.CLAUDECODE;
		}
		if (orig_entry) {
			process.env.CLAUDE_CODE_ENTRYPOINT = orig_entry;
		} else {
			delete process.env.CLAUDE_CODE_ENTRYPOINT;
		}
	});

	it('returns true when env-file injection is available', () => {
		process.env.CLAUDE_ENV_FILE = '/tmp/test-env';
		delete process.env.CLAUDECODE;
		delete process.env.CLAUDE_CODE_ENTRYPOINT;
		expect(is_llm_agent_session()).toBe(true);
	});

	it('returns true when CLAUDECODE is set', () => {
		delete process.env.CLAUDE_ENV_FILE;
		process.env.CLAUDECODE = '1';
		delete process.env.CLAUDE_CODE_ENTRYPOINT;
		expect(is_llm_agent_session()).toBe(true);
	});

	it('returns true when CLAUDE_CODE_ENTRYPOINT is set', () => {
		delete process.env.CLAUDE_ENV_FILE;
		delete process.env.CLAUDECODE;
		process.env.CLAUDE_CODE_ENTRYPOINT = 'cli';
		expect(is_llm_agent_session()).toBe(true);
	});

	it('returns false when no agent markers are set', () => {
		delete process.env.CLAUDE_ENV_FILE;
		delete process.env.CLAUDECODE;
		delete process.env.CLAUDE_CODE_ENTRYPOINT;
		expect(is_llm_agent_session()).toBe(false);
	});
});

describe('validate_key', () => {
	it('accepts valid env key names', () => {
		expect(validate_key('FOO')).toBe(true);
		expect(validate_key('MY_API_KEY')).toBe(true);
		expect(validate_key('_private')).toBe(true);
		expect(validate_key('a123')).toBe(true);
	});

	it('rejects invalid env key names', () => {
		expect(validate_key('')).toBe(false);
		expect(validate_key('123_BAD')).toBe(false);
		expect(validate_key('KEY WITH SPACES')).toBe(false);
		expect(validate_key('KEY;rm -rf /')).toBe(false);
		expect(validate_key('KEY=value')).toBe(false);
		expect(validate_key("KEY'")).toBe(false);
		expect(validate_key('KEY"')).toBe(false);
		expect(validate_key('KEY\nNEWLINE')).toBe(false);
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

	it('rejects invalid key names', () => {
		expect(() =>
			write_nopeek_env([
				{ key: 'VALID', value: 'ok' },
				{ key: '; rm -rf /', value: 'bad' },
			]),
		).toThrow('Invalid env key');
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

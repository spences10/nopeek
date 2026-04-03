import { afterEach, describe, expect, it } from 'vitest';
import { is_claude_session } from './session.js';

describe('is_claude_session', () => {
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
		expect(is_claude_session()).toBe(false);
	});

	it('returns true when CLAUDE_ENV_FILE is set', () => {
		process.env.CLAUDE_ENV_FILE = '/tmp/test-env';
		expect(is_claude_session()).toBe(true);
	});
});

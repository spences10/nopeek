import { afterEach, describe, expect, it, vi } from 'vitest';
import { set_command } from './set.js';

describe('set_command', () => {
	const original_env = { ...process.env };

	afterEach(() => {
		process.env = { ...original_env };
		vi.restoreAllMocks();
	});

	it('rejects invalid key names', () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new Error(`exit:${code}`);
		});

		expect(() =>
			set_command('BAD;echo HACK', { value: 'secret', json: true }),
		).toThrow('exit:1');
	});

	it('rejects --value inside agent sessions', () => {
		process.env.PI_CODING_AGENT = 'true';
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new Error(`exit:${code}`);
		});

		expect(() =>
			set_command('SAFE', { value: 'secret', json: true }),
		).toThrow('exit:1');
	});
});

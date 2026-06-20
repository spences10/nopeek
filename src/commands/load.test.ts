import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { load_command } from './load.js';

const AGENT_ENV_KEYS = [
	'CLAUDE_ENV_FILE',
	'CLAUDECODE',
	'CLAUDE_CODE_ENTRYPOINT',
	'PI_CODING_AGENT',
	'PI_CODING_AGENT_SESSION_DIR',
	'MY_PI_RUNTIME_MODE',
	'CODEX_SANDBOX',
	'CURSOR_AGENT',
	'AIDER_MODEL',
];

function tmp_env(content: string): string {
	const dir = join(
		tmpdir(),
		`nopeek-load-test-${randomBytes(4).toString('hex')}`,
	);
	mkdirSync(dir, { recursive: true });
	const path = join(dir, '.env');
	writeFileSync(path, content);
	return path;
}

describe('load_command', () => {
	const original_env = { ...process.env };

	afterEach(() => {
		process.env = { ...original_env };
		vi.restoreAllMocks();
	});

	it('rejects invalid env keys before printing shell exports', () => {
		for (const key of AGENT_ENV_KEYS) delete process.env[key];
		const path = tmp_env('BAD;echo HACK=value\nSAFE=ok');
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new Error(`exit:${code}`);
		});

		expect(() => load_command(path, undefined, false, false)).toThrow(
			'exit:1',
		);
		expect(log).not.toHaveBeenCalledWith(
			expect.stringContaining('export BAD;echo HACK=value'),
		);
		rmSync(join(path, '..'), { recursive: true, force: true });
	});

	it('uses source-file mode inside Pi agent sessions', () => {
		for (const key of AGENT_ENV_KEYS) delete process.env[key];
		process.env.PI_CODING_AGENT = 'true';
		const path = tmp_env('SAFE=ok');
		const out = vi.spyOn(console, 'log').mockImplementation(() => {});

		load_command(path, undefined, false, true);

		const payload = JSON.parse(String(out.mock.calls[0][0])) as {
			method: string;
			source_path: string;
			available_to_future_commands: boolean;
			next_command: string;
		};
		expect(payload.method).toBe('source_file');
		expect(payload.available_to_future_commands).toBe(false);
		expect(payload.source_path).toContain('/nopeek/env-');
		expect(payload.next_command).toBe(
			`source ${payload.source_path}`,
		);
		rmSync(join(path, '..'), { recursive: true, force: true });
		rmSync(payload.source_path, { force: true });
	});

	it('explains export mode and returns an eval next command', () => {
		for (const key of AGENT_ENV_KEYS) delete process.env[key];
		const path = tmp_env('SAFE=ok');
		const out = vi.spyOn(console, 'log').mockImplementation(() => {});

		load_command(path, undefined, false, true);

		const payload = JSON.parse(String(out.mock.calls[0][0])) as {
			method: string;
			available_to_future_commands: boolean;
			next_command: string;
			message: string;
		};
		expect(payload.method).toBe('export');
		expect(payload.available_to_future_commands).toBe(false);
		expect(payload.next_command).toContain('eval "$(nopeek load ');
		expect(payload.next_command).toContain(' --no-json)"');
		expect(payload.message).toContain(
			'Shell exports were printed only',
		);
		rmSync(join(path, '..'), { recursive: true, force: true });
	});
});

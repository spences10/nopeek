import { randomBytes } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import load_cmd from './load.cmd.js';
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

	it('wires the allow-values option into citty help metadata', () => {
		const args = load_cmd.args as
			| Record<string, { type?: string; description?: string }>
			| undefined;
		const arg = args?.['allow-values'];
		expect(arg).toMatchObject({ type: 'boolean' });
		expect(arg?.description).toContain('secret values');
	});

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
		expect(payload.source_path).toContain(
			`/nopeek-${process.getuid?.()}/env-`,
		);
		expect(payload.next_command).toBe(
			`if source ${payload.source_path}; then :; else (status=$?; rm -f ${payload.source_path}; exit "$status"); fi`,
		);
		rmSync(join(path, '..'), { recursive: true, force: true });
		rmSync(payload.source_path, { force: true });
	});

	it('documents JSON+shell+allow as raw shell output, not JSON', () => {
		for (const key of AGENT_ENV_KEYS) delete process.env[key];
		const path = tmp_env('SAFE=hello world');
		const out = vi.spyOn(console, 'log').mockImplementation(() => {});
		const err = vi
			.spyOn(console, 'error')
			.mockImplementation(() => {});

		load_command(path, undefined, false, true, 'bash', true);

		expect(out).toHaveBeenCalledWith("export SAFE='hello world'");
		expect(err).toHaveBeenCalledWith(
			expect.stringContaining('Emitted bash shell assignments'),
		);
		rmSync(join(path, '..'), { recursive: true, force: true });
	});

	it('fails closed for shell output without explicit opt-in', () => {
		for (const key of AGENT_ENV_KEYS) delete process.env[key];
		const path = tmp_env('SAFE=secret-value');
		const out = vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new Error(`exit:${code}`);
		});

		expect(() =>
			load_command(path, undefined, false, true, 'bash'),
		).toThrow('exit:1');
		expect(String(out.mock.calls[0][0])).not.toContain(
			'secret-value',
		);
		expect(JSON.parse(String(out.mock.calls[0][0]))).toMatchObject({
			contains_values: false,
		});
		rmSync(join(path, '..'), { recursive: true, force: true });
	});

	it('rejects value output in known agent sessions despite opt-in', () => {
		for (const key of AGENT_ENV_KEYS) delete process.env[key];
		process.env.PI_CODING_AGENT = 'true';
		const path = tmp_env('SAFE=secret-value');
		const out = vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new Error(`exit:${code}`);
		});

		expect(() =>
			load_command(path, undefined, false, true, 'bash', true),
		).toThrow('exit:1');
		expect(String(out.mock.calls[0][0])).not.toContain(
			'secret-value',
		);
		rmSync(join(path, '..'), { recursive: true, force: true });
	});

	it('validates disclosure policy before persist side effects', () => {
		for (const key of AGENT_ENV_KEYS) delete process.env[key];
		const root = join(
			tmpdir(),
			`nopeek-persist-test-${randomBytes(4).toString('hex')}`,
		);
		process.env.XDG_CONFIG_HOME = root;
		const path = tmp_env('SENTINEL_DO_NOT_LEAK=secret-value');
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new Error(`exit:${code}`);
		});

		expect(() =>
			load_command(path, undefined, true, true, 'bash'),
		).toThrow('exit:1');
		expect(existsSync(join(root, 'nopeek', 'config.json'))).toBe(
			false,
		);
		rmSync(root, { recursive: true, force: true });
		rmSync(join(path, '..'), { recursive: true, force: true });
	});

	it('keeps regular non-JSON output name-only without opt-in', () => {
		for (const key of AGENT_ENV_KEYS) delete process.env[key];
		const path = tmp_env('SAFE=secret-value');
		const out = vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});

		load_command(path, undefined, false, false);

		expect(out).not.toHaveBeenCalled();
		rmSync(join(path, '..'), { recursive: true, force: true });
	});

	it('allows explicitly opted-in exports in an interactive shell', () => {
		for (const key of AGENT_ENV_KEYS) delete process.env[key];
		const path = tmp_env('SAFE=secret-value');
		const out = vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		Object.defineProperty(process.stdout, 'isTTY', {
			value: true,
			configurable: true,
		});

		load_command(path, undefined, false, false, undefined, true);

		expect(out).toHaveBeenCalledWith('export SAFE=secret-value');
		delete (process.stdout as { isTTY?: boolean }).isTTY;
		rmSync(join(path, '..'), { recursive: true, force: true });
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
		expect(payload.method).toBe('name_only');
		expect(payload.available_to_future_commands).toBe(false);
		expect(payload.next_command).toContain('eval "$(nopeek load ');
		expect(payload.next_command).toContain(
			' --shell bash --allow-values)"',
		);
		expect(payload.message).toContain('Name-only output was used');
		rmSync(join(path, '..'), { recursive: true, force: true });
	});
});

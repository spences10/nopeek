import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { write_config } from '../core/config.js';

const scan_all = vi.fn();
vi.mock('../detectors/index.js', () => ({ scan_all }));

const { status_command } = await import('./status.js');

const AGENT_ENV_KEYS = [
	'CLAUDE_ENV_FILE',
	'CLAUDECODE',
	'CLAUDE_CODE_ENTRYPOINT',
	'PI_CODING_AGENT',
	'PI_CODING_AGENT_SESSION_DIR',
	'MY_PI_RUNTIME_MODE',
	'CODEX_SANDBOX',
	'CODEX_THREAD_ID',
	'CODEX_SESSION_ID',
	'GEMINI_CLI',
	'CURSOR_AGENT',
	'AIDER_MODEL',
];

describe('status_command', () => {
	const original_env = { ...process.env };

	afterEach(() => {
		process.env = { ...original_env };
		vi.restoreAllMocks();
		scan_all.mockReset();
	});

	it('reports disabled injection and global-storage warnings even in Claude', async () => {
		scan_all.mockResolvedValue([]);
		const root = join(
			tmpdir(),
			`nopeek-status-test-${randomBytes(4).toString('hex')}`,
		);
		process.env.XDG_CONFIG_HOME = root;
		process.env.CLAUDE_ENV_FILE = join(root, 'session.env');
		write_config({
			keys: {
				TEST_KEY: { value: 'synthetic-canary', source: 'set' },
			},
			cli_profiles: {},
		});
		const out = vi.spyOn(console, 'log').mockImplementation(() => {});
		try {
			await status_command(true);
			const payload = JSON.parse(String(out.mock.calls[0][0]));
			expect(payload.session).toMatchObject({
				has_env_file_injection: false,
				future_commands_see_loaded_vars: false,
				load_method: 'source_file',
			});
			expect(payload.storage).toMatchObject({
				scope: 'user',
				automatic_loading: false,
			});
			expect(payload.storage.warning).toContain('not project-scoped');
			expect(String(out.mock.calls[0][0])).not.toContain(
				'synthetic-canary',
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('reports name_only and value-free output outside agent sessions', async () => {
		scan_all.mockResolvedValue([]);
		for (const key of AGENT_ENV_KEYS) delete process.env[key];
		const config_root = join(
			tmpdir(),
			`nopeek-status-test-${randomBytes(4).toString('hex')}`,
		);
		process.env.XDG_CONFIG_HOME = config_root;
		const out = vi.spyOn(console, 'log').mockImplementation(() => {});

		await status_command(true);

		const payload = JSON.parse(String(out.mock.calls[0][0])) as {
			contains_values: boolean;
			session: { load_method: string };
		};
		expect(payload.contains_values).toBe(false);
		expect(payload.session.load_method).toBe('name_only');
		rmSync(config_root, { recursive: true, force: true });
	});
});

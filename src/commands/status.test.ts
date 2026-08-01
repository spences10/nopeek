import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { status_command } from './status.js';

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

describe('status_command', () => {
	const original_env = { ...process.env };

	afterEach(() => {
		process.env = { ...original_env };
		vi.restoreAllMocks();
	});

	it('reports name_only and value-free output outside agent sessions', async () => {
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

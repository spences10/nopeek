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
		};
		expect(payload.method).toBe('source_file');
		expect(payload.source_path).toContain('/nopeek/env-');
		rmSync(join(path, '..'), { recursive: true, force: true });
		rmSync(payload.source_path, { force: true });
	});
});

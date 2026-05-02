import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { audit_command } from './audit.js';

function tmp_dir(): string {
	const dir = join(
		tmpdir(),
		`nopeek-audit-test-${randomBytes(4).toString('hex')}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe('audit_command', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('recursively scans env files and exits non-zero on findings', () => {
		const dir = tmp_dir();
		mkdirSync(join(dir, 'app'));
		writeFileSync(join(dir, '.gitignore'), '.env*\n');
		writeFileSync(
			join(dir, 'app', '.env.production'),
			`TOKEN=Bearer ${'a'.repeat(24)}\n`,
		);
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new Error(`exit:${code}`);
		});

		expect(() => audit_command(dir, true)).toThrow('exit:1');
		const payload = JSON.parse(String(log.mock.calls[0][0])) as {
			success: boolean;
			total_secrets: number;
			files: { file: string; patterns: string[] }[];
		};
		expect(payload.success).toBe(false);
		expect(payload.total_secrets).toBe(1);
		expect(payload.files[0].file).toBe('app/.env.production');
		expect(payload.files[0].patterns).toContain('Bearer Token');
		rmSync(dir, { recursive: true, force: true });
	});

	it('exits non-zero when env files are not ignored', () => {
		const dir = tmp_dir();
		writeFileSync(join(dir, '.env.local'), 'SAFE=value\n');
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new Error(`exit:${code}`);
		});

		expect(() => audit_command(dir, true)).toThrow('exit:1');
		const payload = JSON.parse(String(log.mock.calls[0][0])) as {
			missing_gitignore: string[];
		};
		expect(payload.missing_gitignore).toEqual(['.env.local']);
		rmSync(dir, { recursive: true, force: true });
	});
});

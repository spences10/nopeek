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
import { run_command } from './run.js';

function tmp_file(name: string, content: string): string {
	const dir = join(
		tmpdir(),
		`nopeek-run-test-${randomBytes(4).toString('hex')}`,
	);
	mkdirSync(dir, { recursive: true });
	const path = join(dir, name);
	writeFileSync(path, content);
	return path;
}

describe('run_command', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('runs a command with selected env keys and preserves exit code', () => {
		const path = tmp_file('.env', 'SECRET=value\nOTHER=ignored');
		vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new Error(`exit:${code}`);
		});

		expect(() =>
			run_command(path, 'SECRET', [
				process.execPath,
				'-e',
				'process.exit(process.env.SECRET === "value" && process.env.OTHER === undefined ? 7 : 1)',
			]),
		).toThrow('exit:7');
		rmSync(join(path, '..'), { recursive: true, force: true });
	});

	it('validates the whole file before --only or spawning a command', () => {
		const path = tmp_file(
			'prod.tfvars.json',
			'{"SAFE":"ok","nested":{"constructor":"sentinel-secret"}}',
		);
		const marker = join(join(path, '..'), 'spawned');

		expect(() =>
			run_command(path, 'SAFE', [
				process.execPath,
				'-e',
				`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'yes')`,
			]),
		).toThrow('unsupported output key "constructor"');
		expect(existsSync(marker)).toBe(false);
		rmSync(join(path, '..'), { recursive: true, force: true });
	});

	it('loads string values from tfvars json files', () => {
		const path = tmp_file(
			'prod.tfvars.json',
			JSON.stringify({ api_token: 'value' }),
		);
		vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new Error(`exit:${code}`);
		});

		expect(() =>
			run_command(path, 'api_token', [
				process.execPath,
				'-e',
				'process.exit(process.env.api_token === "value" ? 0 : 1)',
			]),
		).toThrow('exit:0');
		rmSync(join(path, '..'), { recursive: true, force: true });
	});
});

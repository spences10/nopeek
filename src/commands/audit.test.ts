import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
	mkdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { audit_command, read_candidate } from './audit.js';

function tmp_dir(): string {
	const dir = join(
		tmpdir(),
		`nopeek-audit-test-${randomBytes(4).toString('hex')}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function git(dir: string, ...args: string[]): void {
	const result = spawnSync('git', ['-C', dir, ...args], {
		encoding: 'utf-8',
	});
	if (result.status !== 0) throw new Error(result.stderr);
}

function json_result(
	dir: string,
	options: Parameters<typeof audit_command>[2] = {},
): {
	success: boolean;
	total_secrets: number;
	missing_gitignore: string[];
	repository: boolean;
	git_available: boolean;
	git_status: string;
	heuristic: boolean;
	bounded: boolean;
	incomplete_files: number;
	skipped_paths: { path: string; reason: string }[];
	limits: { max_file_bytes: number };
	files: {
		file: string;
		format: string;
		status: string;
		secrets_found: number;
		patterns: string[];
		git_state: string;
		in_gitignore: boolean;
		example: boolean;
		example_assessment?: string;
		error?: string;
		skipped_reason?: string;
	}[];
} {
	const log = vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(process, 'exit').mockImplementation((code) => {
		throw new Error(`exit:${code}`);
	});
	try {
		audit_command(dir, true, options);
	} catch (error) {
		if (!(error instanceof Error) || error.message !== 'exit:1')
			throw error;
	}
	return JSON.parse(String(log.mock.calls[0][0]));
}

describe('audit_command', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('uses nested Git ignore rules and negation with real Git semantics', () => {
		const dir = tmp_dir();
		git(dir, 'init', '-q');
		mkdirSync(join(dir, 'app'));
		writeFileSync(join(dir, '.gitignore'), '.env*\n*.tfvars\n');
		writeFileSync(join(dir, 'app', '.gitignore'), '!.env.keep\n');
		writeFileSync(join(dir, '.env.local'), 'SAFE=value\n');
		writeFileSync(
			join(dir, 'app', '.env.production'),
			'SAFE=value\n',
		);
		writeFileSync(join(dir, 'app', '.env.keep'), 'SAFE=value\n');
		writeFileSync(
			join(dir, 'app', 'prod.tfvars'),
			'SAFE = "value"\n',
		);

		const payload = json_result(dir);
		expect(payload.repository).toBe(true);
		expect(payload.heuristic).toBe(true);
		expect(payload.bounded).toBe(true);
		expect(
			Object.fromEntries(
				payload.files.map((file) => [file.file, file.git_state]),
			),
		).toEqual({
			'.env.local': 'ignored',
			'app/.env.keep': 'untracked',
			'app/.env.production': 'ignored',
			'app/prod.tfvars': 'ignored',
		});
		expect(payload.missing_gitignore).toEqual(['app/.env.keep']);
		rmSync(dir, { recursive: true, force: true });
	});

	it('honors anchored ignore patterns relative to their Git directory', () => {
		const dir = tmp_dir();
		git(dir, 'init', '-q');
		mkdirSync(join(dir, 'nested'));
		writeFileSync(join(dir, '.gitignore'), '/.env\n');
		writeFileSync(join(dir, '.env'), 'SAFE=value\n');
		writeFileSync(join(dir, 'nested', '.env'), 'SAFE=value\n');

		const payload = json_result(dir);
		expect(
			Object.fromEntries(
				payload.files.map((file) => [file.file, file.git_state]),
			),
		).toEqual({
			'.env': 'ignored',
			'nested/.env': 'untracked',
		});
		rmSync(dir, { recursive: true, force: true });
	});

	it('reports tracked, untracked, and ignored source states', () => {
		const dir = tmp_dir();
		git(dir, 'init', '-q');
		writeFileSync(
			join(dir, '.gitignore'),
			'.env.ignored\n.env.tracked\n',
		);
		writeFileSync(join(dir, '.env.tracked'), 'SAFE=value\n');
		writeFileSync(join(dir, '.env.untracked'), 'SAFE=value\n');
		writeFileSync(join(dir, '.env.ignored'), 'SAFE=value\n');
		git(dir, 'add', '-f', '.env.tracked');

		const payload = json_result(dir);
		expect(
			Object.fromEntries(
				payload.files.map((file) => [file.file, file.git_state]),
			),
		).toEqual({
			'.env.ignored': 'ignored',
			'.env.tracked': 'tracked',
			'.env.untracked': 'untracked',
		});
		expect(payload.missing_gitignore).toEqual([
			'.env.tracked',
			'.env.untracked',
		]);
		rmSync(dir, { recursive: true, force: true });
	});

	it('scans tfvars formats and never includes secret values in output', () => {
		const dir = tmp_dir();
		git(dir, 'init', '-q');
		writeFileSync(
			join(dir, '.gitignore'),
			'*.tfvars\n*.tfvars.json\n',
		);
		const secret = `Bearer ${'a'.repeat(24)}`;
		writeFileSync(join(dir, 'prod.tfvars'), `TOKEN = "${secret}"\n`);
		writeFileSync(
			join(dir, 'prod.tfvars.json'),
			JSON.stringify({ TOKEN: secret }),
		);

		const payload = json_result(dir);
		expect(payload.total_secrets).toBe(2);
		expect(payload.files.map((file) => file.file)).toEqual([
			'prod.tfvars',
			'prod.tfvars.json',
		]);
		expect(
			payload.files.every((file) => file.git_state === 'ignored'),
		).toBe(true);
		expect(payload.files[0].patterns).toContain('Bearer Token');
		expect(JSON.stringify(payload)).not.toContain(secret);
		rmSync(dir, { recursive: true, force: true });
	});

	it('flags live-looking examples but avoids placeholder false positives', () => {
		const dir = tmp_dir();
		git(dir, 'init', '-q');
		writeFileSync(join(dir, '.env.example'), 'TOKEN=replace-me\n');
		writeFileSync(
			join(dir, 'prod.example.tfvars'),
			`TOKEN = "Bearer ${'b'.repeat(24)}"\n`,
		);

		const payload = json_result(dir);
		const safe = payload.files.find(
			(file) => file.file === '.env.example',
		);
		const live = payload.files.find(
			(file) => file.file === 'prod.example.tfvars',
		);
		expect(safe).toMatchObject({
			example: true,
			example_assessment: 'placeholder',
			secrets_found: 0,
		});
		expect(live).toMatchObject({
			example: true,
			example_assessment: 'live-looking',
			secrets_found: 1,
		});
		expect(payload.missing_gitignore).toEqual([
			'prod.example.tfvars',
		]);
		rmSync(dir, { recursive: true, force: true });
	});

	it('reports bounded heuristic results outside a Git repository', () => {
		const dir = tmp_dir();
		writeFileSync(join(dir, '.env.local'), 'SAFE=value\n');

		const payload = json_result(dir);
		expect(payload).toMatchObject({
			repository: false,
			heuristic: true,
			bounded: true,
			missing_gitignore: ['.env.local'],
		});
		expect(payload).toMatchObject({ git_available: true });
		expect(payload.files[0]).toMatchObject({
			file: '.env.local',
			git_state: 'unknown',
			in_gitignore: false,
		});
		rmSync(dir, { recursive: true, force: true });
	});

	it('reports missing Git explicitly without attempting ignore semantics', () => {
		const dir = tmp_dir();
		writeFileSync(join(dir, '.env.local'), 'SAFE=value\n');
		const payload = json_result(dir, {
			git_runner: () => ({
				status: null,
				stdout: '',
				error_code: 'ENOENT',
			}),
		});
		expect(payload).toMatchObject({
			git_available: false,
			git_status: 'unavailable',
			repository: false,
		});
		expect(payload.files[0].git_state).toBe('unknown');
		rmSync(dir, { recursive: true, force: true });
	});

	it('distinguishes Git operational failure from a non-repository', () => {
		const dir = tmp_dir();
		writeFileSync(join(dir, '.env.local'), 'SAFE=value\n');
		const payload = json_result(dir, {
			git_runner: () => ({ status: 2, stdout: '' }),
		});
		expect(payload).toMatchObject({
			git_available: true,
			git_status: 'error',
			repository: false,
		});
		expect(payload.files[0].git_state).toBe('unknown');
		rmSync(dir, { recursive: true, force: true });
	});

	it('fails closed on ambiguous status 128 inside a repository', () => {
		const dir = tmp_dir();
		git(dir, 'init', '-q');
		writeFileSync(join(dir, '.env.example'), 'TOKEN=example\n');
		const payload = json_result(dir, {
			git_runner: () => ({ status: 128, stdout: '' }),
		});
		expect(payload).toMatchObject({
			success: false,
			git_available: true,
			git_status: 'error',
			repository: false,
			missing_gitignore: [],
		});
		rmSync(dir, { recursive: true, force: true });
	});

	it('preserves primary read errors and sanitizes close-only failures', () => {
		const close_failure = read_candidate('/unused', {
			open: () => 1,
			stat: () => ({ isFile: () => true, size: 0 }),
			read: () => 0,
			close: () => {
				throw new Error('SENTINEL_CLOSE_SECRET');
			},
		});
		expect(close_failure).toEqual({
			error: 'file cannot be closed safely',
		});

		const primary_failure = read_candidate('/unused', {
			open: () => 1,
			stat: () => {
				throw new Error('SENTINEL_PRIMARY_SECRET');
			},
			read: () => 0,
			close: () => {
				throw new Error('SENTINEL_CLOSE_SECRET');
			},
		});
		expect(primary_failure).toEqual({
			error: 'file cannot be opened safely',
		});
		expect(
			JSON.stringify([close_failure, primary_failure]),
		).not.toContain('SENTINEL');
	});

	it('bounds reads even when a candidate grows after metadata inspection', () => {
		const growing = read_candidate('/unused', {
			open: () => 1,
			stat: () => ({ isFile: () => true, size: 0 }),
			read: (_fd, buffer, offset, length) => {
				buffer.fill(0x61, offset, offset + length);
				return length;
			},
			close: () => {},
		});
		expect(growing).toEqual({
			skipped_reason: expect.stringContaining('byte limit'),
		});
	});

	it('rejects a symlink or regular-file scan root', () => {
		const dir = tmp_dir();
		const target = join(dir, 'target');
		mkdirSync(target);
		const linked_root = join(dir, 'linked-root');
		symlinkSync(target, linked_root);
		const file_root = join(dir, '.env');
		writeFileSync(file_root, 'SAFE=value\n');
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new Error(`exit:${code}`);
		});

		expect(() => audit_command(linked_root, true)).toThrow('exit:1');
		expect(() => audit_command(file_root, true)).toThrow('exit:1');
		expect(
			log.mock.calls.map(([value]) => String(value)).join('\n'),
		).toContain('Cannot read directory');
		rmSync(dir, { recursive: true, force: true });
	});

	it('fails closed on malformed, oversized, and symlink candidates', () => {
		const dir = tmp_dir();
		git(dir, 'init', '-q');
		writeFileSync(
			join(dir, 'bad.tfvars.json'),
			'{"TOKEN":"SENTINEL_VALUE_123"',
		);
		writeFileSync(
			join(dir, '.env.large'),
			'x'.repeat(1024 * 1024 + 1),
		);
		writeFileSync(join(dir, 'target'), 'SAFE=value\n');
		symlinkSync(join(dir, 'target'), join(dir, '.env.link'));

		const payload = json_result(dir);
		expect(payload.success).toBe(false);
		expect(payload.incomplete_files).toBe(2);
		expect(payload.files).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					file: '.env.large',
					status: 'skipped',
					skipped_reason: expect.stringContaining('byte limit'),
				}),
				expect.objectContaining({
					file: 'bad.tfvars.json',
					status: 'error',
					error: expect.stringContaining(
						'Invalid tfvars.json at line',
					),
				}),
			]),
		);
		expect(payload.skipped_paths).toContainEqual({
			path: '.env.link',
			reason: 'symbolic link is not followed',
		});
		expect(JSON.stringify(payload)).not.toContain(
			'SENTINEL_VALUE_123',
		);
		rmSync(dir, { recursive: true, force: true });
	});
});

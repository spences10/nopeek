import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
	cleanup_stale_temp_env_files,
	ensure_private_temp_root,
	write_temp_env_file,
} from './temp-env.js';

const roots: string[] = [];

function test_root(): string {
	const root = join(
		tmpdir(),
		`nopeek-secure-test-${process.pid}-${roots.length}-${Date.now()}`,
	);
	roots.push(root);
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe('secure temp env lifecycle', () => {
	it('creates a private root and unique 0600 self-cleaning files', () => {
		const root = test_root();
		const first = write_temp_env_file(
			[{ key: 'SAFE', value: 'secret-value' }],
			{ root },
		);
		const second = write_temp_env_file(
			[{ key: 'SAFE', value: 'other-value' }],
			{ root },
		);

		expect(first.path).not.toBe(second.path);
		expect(lstatSync(root).mode & 0o777).toBe(0o700);
		expect(lstatSync(root).uid).toBe(process.getuid?.());
		expect(lstatSync(first.path).mode & 0o777).toBe(0o600);
		expect(readFileSync(first.path, 'utf-8')).toContain(
			`rm -f ${first.path}`,
		);
	});

	it('removes a file after it is consumed by a shell', async () => {
		const root = `${test_root()} with spaces`;
		roots[roots.length - 1] = root;
		const { path } = write_temp_env_file(
			[{ key: 'SAFE', value: 'secret-value' }],
			{ root },
		);
		const { spawnSync } = await import('node:child_process');
		const result = spawnSync('sh', ['-c', `. "${path}"`], {
			encoding: 'utf-8',
		});

		expect(result.status).toBe(0);
		expect(existsSync(path)).toBe(false);
		expect(result.stdout).not.toContain('secret-value');
		expect(result.stderr).not.toContain('secret-value');
	});

	it('removes itself and returns failure when an export fails', async () => {
		const root = test_root();
		const { path } = write_temp_env_file(
			[{ key: 'LOCKED', value: 'new-value' }],
			{ root },
		);
		const { spawnSync } = await import('node:child_process');
		const result = spawnSync(
			'bash',
			[
				'-c',
				'readonly LOCKED=old-value; source "$1"; code=$?; echo caller-alive; test ! -e "$1" || exit 99; exit "$code"',
				'--',
				path,
			],
			{ encoding: 'utf-8' },
		);

		expect(result.status).toBe(1);
		expect(existsSync(path)).toBe(false);
		expect(result.stdout).toContain('caller-alive');
		expect(result.stdout).not.toContain('new-value');
		expect(result.stderr).not.toContain('new-value');
	});

	it('cleans up before set -e exits on an export failure', async () => {
		const root = test_root();
		const { path } = write_temp_env_file(
			[{ key: 'LOCKED', value: 'new-value' }],
			{ root },
		);
		const { spawnSync } = await import('node:child_process');
		const result = spawnSync(
			'bash',
			[
				'-c',
				'set -e; readonly LOCKED=old-value; if source "$1"; then :; else (status=$?; rm -f "$1"; exit "$status"); fi; echo unreachable',
				'--',
				path,
			],
			{ encoding: 'utf-8' },
		);

		expect(result.status).toBe(1);
		expect(existsSync(path)).toBe(false);
		expect(result.stdout).not.toContain('unreachable');
	});

	it('short-circuits after the first failed export and removes the file', async () => {
		const root = test_root();
		const { path } = write_temp_env_file(
			[
				{ key: 'LOCKED', value: 'new-value' },
				{ key: 'SECOND', value: 'must-not-load' },
			],
			{ root },
		);
		const { spawnSync } = await import('node:child_process');
		const result = spawnSync(
			'bash',
			[
				'-c',
				'readonly LOCKED=old-value; source "$1"; code=$?; test -z "${SECOND+x}" || exit 98; test ! -e "$1" || exit 99; exit "$code"',
				'--',
				path,
			],
			{ encoding: 'utf-8' },
		);

		expect(result.status).toBe(1);
		expect(existsSync(path)).toBe(false);
		expect(result.stdout).not.toContain('must-not-load');
		expect(result.stderr).not.toContain('must-not-load');
	});

	it('preserves an existing collision without unlinking it', () => {
		const root = test_root();
		ensure_private_temp_root(root);
		const path = join(root, `env-${'a'.repeat(32)}.sh`);
		writeFileSync(path, 'existing sentinel', { mode: 0o600 });
		const random_bytes = (size: number) =>
			Buffer.alloc(size, size === 16 ? 0xaa : 0xbb);

		expect(() =>
			write_temp_env_file([{ key: 'SAFE', value: 'new-secret' }], {
				root,
				random_bytes,
			}),
		).toThrow(expect.objectContaining({ code: 'EEXIST' }));
		expect(readFileSync(path, 'utf-8')).toBe('existing sentinel');
	});

	it('removes a partial file and rethrows the original write error', () => {
		const root = test_root();
		const original = new Error(
			'simulated write failure without secret',
		);

		expect(() =>
			write_temp_env_file(
				[{ key: 'SAFE', value: 'sentinel-secret' }],
				{
					root,
					write_file(fd) {
						writeFileSync(fd, 'partial sentinel-secret');
						throw original;
					},
				},
			),
		).toThrow(original);
		expect(readdirSync(root)).toEqual([]);
		expect(original.message).not.toContain('sentinel-secret');
	});

	it('removes only stale regular env files', () => {
		const root = test_root();
		ensure_private_temp_root(root);
		const stale = join(root, `env-${'a'.repeat(32)}.sh`);
		const fresh = join(root, `env-${'b'.repeat(32)}.sh`);
		const boundary = join(root, `env-${'1'.repeat(32)}.sh`);
		const unrelated = join(root, 'env-stale.sh');
		writeFileSync(stale, 'old-secret', { mode: 0o600 });
		writeFileSync(fresh, 'fresh-secret', { mode: 0o600 });
		writeFileSync(boundary, 'boundary-secret', { mode: 0o600 });
		writeFileSync(unrelated, 'keep', { mode: 0o600 });
		utimesSync(stale, new Date(1_000), new Date(1_000));
		utimesSync(fresh, new Date(9_500), new Date(9_500));
		utimesSync(boundary, new Date(9_000), new Date(9_000));

		const removed = cleanup_stale_temp_env_files({
			root,
			now: () => 10_000,
			stale_age_ms: 1_000,
		});

		expect(removed).toBe(2);
		expect(existsSync(stale)).toBe(false);
		expect(existsSync(boundary)).toBe(false);
		expect(existsSync(fresh)).toBe(true);
		expect(existsSync(unrelated)).toBe(true);
	});

	it('preserves boundary-fresh, future, wrong-mode, and unknown files', () => {
		const root = test_root();
		ensure_private_temp_root(root);
		const boundary = join(root, `env-${'d'.repeat(32)}.sh`);
		const future = join(root, `env-${'e'.repeat(32)}.sh`);
		const wrong_mode = join(root, `env-${'f'.repeat(32)}.sh`);
		const unknown = join(root, 'env-not-allowlisted.sh');
		for (const path of [boundary, future, wrong_mode, unknown]) {
			writeFileSync(path, 'sentinel', { mode: 0o600 });
		}
		utimesSync(boundary, new Date(9_001), new Date(9_001));
		utimesSync(future, new Date(20_000), new Date(20_000));
		utimesSync(wrong_mode, new Date(1_000), new Date(1_000));
		chmodSync(wrong_mode, 0o644);
		utimesSync(unknown, new Date(1_000), new Date(1_000));

		expect(
			cleanup_stale_temp_env_files({
				root,
				now: () => 10_000,
				stale_age_ms: 1_000,
			}),
		).toBe(0);
		for (const path of [boundary, future, wrong_mode, unknown]) {
			expect(existsSync(path)).toBe(true);
		}
	});

	it('never follows or removes a symlink target', () => {
		const root = test_root();
		ensure_private_temp_root(root);
		const target = join(root, 'target');
		const link = join(root, `env-${'c'.repeat(32)}.sh`);
		writeFileSync(target, 'valuable');
		symlinkSync(target, link);

		expect(
			cleanup_stale_temp_env_files({
				root,
				now: () => Date.now() + 100_000,
				stale_age_ms: 0,
			}),
		).toBe(0);
		expect(readFileSync(target, 'utf-8')).toBe('valuable');
		expect(lstatSync(link).isSymbolicLink()).toBe(true);
	});

	it('rejects symlink, non-directory, and permissive roots', () => {
		const parent = test_root();
		mkdirSync(parent, { mode: 0o700 });
		const real = join(parent, 'real');
		mkdirSync(real, { mode: 0o700 });
		const link = join(parent, 'link');
		symlinkSync(real, link);
		expect(() => ensure_private_temp_root(link)).toThrow(
			'not a directory',
		);

		const file = join(parent, 'file');
		writeFileSync(file, 'x');
		expect(() => ensure_private_temp_root(file)).toThrow(
			'not a directory',
		);

		chmodSync(real, 0o755);
		expect(() => ensure_private_temp_root(real)).toThrow(
			'permissions must be 0700',
		);
	});

	it('creates unique fresh files safely across concurrent processes', async () => {
		const root = test_root();
		const module_url = pathToFileURL(
			join(process.cwd(), 'src/core/temp-env.ts'),
		).href;
		const { spawn } = await import('node:child_process');
		const children = Array.from(
			{ length: 8 },
			(_, index) =>
				new Promise<void>((resolve, reject) => {
					const script = `import { write_temp_env_file } from ${JSON.stringify(module_url)}; write_temp_env_file([{ key: 'KEY_${index}', value: 'value-${index}' }], { root: ${JSON.stringify(root)} });`;
					const child = spawn(
						process.execPath,
						[
							'--experimental-strip-types',
							'--input-type=module',
							'-e',
							script,
						],
						{ stdio: 'ignore' },
					);
					child.once('error', reject);
					child.once('exit', (code) => {
						if (code === 0) resolve();
						else reject(new Error(`child exited ${code}`));
					});
				}),
		);
		await Promise.all(children);
		const files = readdirSync(root).filter((name) =>
			name.startsWith('env-'),
		);
		expect(new Set(files).size).toBe(8);
		expect(files).toHaveLength(8);
	});
});

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const cli =
	process.env.NOPEEK_TEST_CLI ??
	join(process.cwd(), 'dist', 'index.js');
const agent_keys = [
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
const roots: string[] = [];

interface Harness {
	root: string;
	env: NodeJS.ProcessEnv;
	canary: string;
	env_file: string;
	run(
		args: string[],
		env?: NodeJS.ProcessEnv,
	): ReturnType<typeof spawnSync>;
}

function harness(): Harness {
	const root = mkdtempSync(join(tmpdir(), 'nopeek-integration-'));
	roots.push(root);
	const canary = `NOPEEK_CANARY_${randomBytes(12).toString('hex')}`;
	const env_file = join(root, '.env');
	mkdirSync(join(root, 'home'));
	mkdirSync(join(root, 'tmp'));
	writeFileSync(
		env_file,
		`NOPEEK_TEST_VALUE=${canary}\nSAFE=ok\nUNSELECTED=omit-me\n`,
	);
	const env = { ...process.env };
	for (const key of [
		...agent_keys,
		'BASH_ENV',
		'ENV',
		'ZDOTDIR',
		'NODE_OPTIONS',
		'NOPEEK_TEST_VALUE',
		'NOPEEK_INHERITED_VALUE',
		'SAFE',
		'UNSELECTED',
	])
		delete env[key];
	Object.assign(env, {
		HOME: join(root, 'home'),
		XDG_CONFIG_HOME: join(root, 'config'),
		TMPDIR: join(root, 'tmp'),
		TMP: join(root, 'tmp'),
		TEMP: join(root, 'tmp'),
	});
	return {
		root,
		env,
		canary,
		env_file,
		run: (args, override = env) =>
			spawnSync(process.execPath, [cli, ...args], {
				cwd: root,
				env: override,
				encoding: 'utf-8',
				timeout: 10_000,
				shell: false,
			}),
	};
}

function output(result: ReturnType<typeof spawnSync>): string {
	expect(result.error).toBeUndefined();
	expect(result.signal).toBeNull();
	return `${String(result.stdout ?? '')}${String(result.stderr ?? '')}`;
}

function snapshot(
	root: string,
): Record<string, { type: string; mode: number; hash?: string }> {
	const entries: ReturnType<typeof snapshot> = {};
	const visit = (directory: string): void => {
		for (const name of readdirSync(directory).sort()) {
			const path = join(directory, name);
			const stat = lstatSync(path);
			const key = relative(root, path);
			const type = stat.isSymbolicLink()
				? 'symlink'
				: stat.isDirectory()
					? 'directory'
					: 'file';
			entries[key] = {
				type,
				mode: stat.mode,
				...(stat.isFile()
					? {
							hash: createHash('sha256')
								.update(readFileSync(path))
								.digest('hex'),
						}
					: {}),
			};
			if (stat.isDirectory()) visit(path);
		}
	};
	visit(root);
	return entries;
}

function run_probe(
	h: Harness,
	script: string,
	env = h.env,
): ReturnType<typeof spawnSync> {
	return h.run(
		[
			'run',
			h.env_file,
			'--only',
			'NOPEEK_TEST_VALUE',
			'--',
			process.execPath,
			'-e',
			script,
		],
		env,
	);
}

afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

describe('built CLI run-only security boundaries', () => {
	it.each([{ args: [] }, { args: ['--help'] }])(
		'advertises only stateless commands ($args)',
		({ args }) => {
			const h = harness();
			const before = snapshot(h.root);
			const result = h.run(args);
			expect(result.status).toBe(0);
			const text = output(result);
			for (const command of ['run', 'init', 'audit'])
				expect(text).toMatch(new RegExp(`\\b${command}\\b`));
			expect(text).not.toMatch(
				/nopeek (load|set|list|remove|status|template)\b/,
			);
			expect(text).not.toContain(h.canary);
			expect(snapshot(h.root)).toEqual(before);
		},
	);

	it.each(['load', 'set', 'list', 'remove', 'status', 'template'])(
		'rejects retired %s without reading or writing stored credentials',
		(command) => {
			const h = harness();
			const config_dir = join(h.root, 'config', 'nopeek');
			mkdirSync(config_dir, { recursive: true });
			writeFileSync(
				join(config_dir, 'config.json'),
				`{ "legacy": "${h.canary}"`,
			);
			const before = snapshot(h.root);
			const result = h.run(
				[
					command,
					h.env_file,
					'--persist',
					'--only',
					'NOPEEK_TEST_VALUE',
					'--value',
					h.canary,
				],
				{
					...h.env,
					PI_CODING_AGENT: 'true',
					CLAUDE_ENV_FILE: join(h.root, 'session.env'),
				},
			);
			expect(result.status).toBe(1);
			expect(output(result)).toContain(
				`The ${command} command has been removed`,
			);
			expect(output(result)).toContain('nopeek run');
			expect(output(result)).not.toContain(h.canary);
			expect(snapshot(h.root)).toEqual(before);
		},
	);

	it.each(['--persist', '--allow-values', '--shell'])(
		'rejects obsolete run option %s before spawning a child',
		(option) => {
			const h = harness();
			const before = snapshot(h.root);
			const result = h.run([
				'run',
				h.env_file,
				option,
				'--',
				process.execPath,
				'-e',
				'process.exit(99)',
			]);
			expect(result.status).toBe(1);
			expect(output(result)).toContain('Unknown run option');
			expect(output(result)).not.toContain(h.canary);
			expect(snapshot(h.root)).toEqual(before);
		},
	);

	it.each(['unknown', ...agent_keys])(
		'creates no secret copies or session state for %s',
		(marker) => {
			const h = harness();
			const env = { ...h.env };
			if (marker !== 'unknown')
				env[marker] =
					marker === 'CLAUDE_ENV_FILE'
						? join(h.root, 'session.env')
						: '1';
			const before = snapshot(h.root);
			const child = run_probe(
				h,
				'process.exit(process.env.NOPEEK_TEST_VALUE?.startsWith("NOPEEK_CANARY_") && process.env.UNSELECTED === undefined ? 7 : 1)',
				env,
			);
			expect(child.status).toBe(7);
			expect(output(child)).not.toContain(h.canary);
			expect(snapshot(h.root)).toEqual(before);
			expect(existsSync(join(h.root, 'config'))).toBe(false);
		},
	);

	it('does not read, migrate, or delete legacy plaintext files', () => {
		const h = harness();
		const config_dir = join(h.root, 'config', 'nopeek');
		const old_temp_dir = join(h.root, 'tmp', 'nopeek');
		const temp_dir = join(
			h.root,
			'tmp',
			`nopeek-${process.getuid?.()}`,
		);
		for (const directory of [config_dir, old_temp_dir, temp_dir])
			mkdirSync(directory, { recursive: true });
		writeFileSync(
			join(config_dir, 'config.json'),
			`{ "legacy": "${h.canary}"`,
		);
		writeFileSync(join(old_temp_dir, 'env.sh'), h.canary);
		writeFileSync(
			join(temp_dir, `env-${'a'.repeat(32)}.sh`),
			h.canary,
		);
		const session_env = join(h.root, 'session.env');
		writeFileSync(session_env, 'EXISTING=yes\n');
		const before = snapshot(h.root);

		const child = run_probe(
			h,
			'process.exit(process.env.NOPEEK_TEST_VALUE && process.env.LEGACY_VALUE === undefined ? 0 : 1)',
			{ ...h.env, CLAUDE_ENV_FILE: session_env },
		);

		expect(child.status).toBe(0);
		expect(output(child)).not.toContain(h.canary);
		expect(snapshot(h.root)).toEqual(before);
	});

	it.skipIf(process.platform === 'win32')(
		'ignores symlinked legacy storage without touching its target',
		() => {
			const h = harness();
			mkdirSync(join(h.root, 'config'));
			const target = join(h.root, 'legacy-target');
			mkdirSync(target);
			writeFileSync(join(target, 'config.json'), h.canary);
			symlinkSync(target, join(h.root, 'config', 'nopeek'));
			const before = snapshot(h.root);

			const child = run_probe(
				h,
				'process.exit(process.env.NOPEEK_TEST_VALUE ? 0 : 1)',
			);

			expect(child.status).toBe(0);
			expect(output(child)).not.toContain(h.canary);
			expect(snapshot(h.root)).toEqual(before);
		},
	);

	it.each([
		{ command: 'init', args: [], status: 0 },
		{ command: 'audit', args: ['scan'], status: 1 },
	])(
		'keeps $command advisory without touching legacy storage',
		({ command, args, status }) => {
			const h = harness();
			const config_dir = join(h.root, 'config', 'nopeek');
			mkdirSync(config_dir, { recursive: true });
			writeFileSync(
				join(config_dir, 'config.json'),
				`{ "legacy": "${h.canary}"`,
			);
			mkdirSync(join(h.root, 'scan'));
			mkdirSync(join(h.root, 'empty-path'));
			const before = snapshot(h.root);

			const result = h.run([command, ...args], {
				...h.env,
				PATH: join(h.root, 'empty-path'),
			});

			expect(result.status).toBe(status);
			expect(output(result)).not.toContain(h.canary);
			const payload = JSON.parse(String(result.stdout));
			expect(payload).toMatchObject(
				command === 'init'
					? { advisory: true, detected: [] }
					: { bounded: true, git_status: 'unavailable' },
			);
			expect(snapshot(h.root)).toEqual(before);
		},
	);

	it('does not leave values in a later command environment', () => {
		const h = harness();
		expect(
			run_probe(
				h,
				'process.exit(process.env.NOPEEK_TEST_VALUE ? 0 : 1)',
			).status,
		).toBe(0);
		const sibling = h.run([
			'run',
			h.env_file,
			'--only',
			'SAFE',
			'--',
			process.execPath,
			'-e',
			'process.exit(process.env.SAFE === "ok" && process.env.NOPEEK_TEST_VALUE === undefined ? 0 : 1)',
		]);
		expect(sibling.status).toBe(0);
		expect(output(sibling)).not.toContain(h.canary);
	});

	it('preserves inherited credentials: --only filters the file, not the parent', () => {
		const h = harness();
		const child = h.run(
			[
				'run',
				h.env_file,
				'--only',
				'SAFE',
				'--',
				process.execPath,
				'-e',
				'process.exit(process.env.NOPEEK_INHERITED_VALUE && process.env.SAFE === "ok" && process.env.NOPEEK_TEST_VALUE === undefined ? 0 : 1)',
			],
			{ ...h.env, NOPEEK_INHERITED_VALUE: h.canary },
		);
		expect(child.status).toBe(0);
		expect(output(child)).not.toContain(h.canary);
	});

	it.skipIf(process.platform !== 'linux')(
		'keeps credentials out of nopeek and child argv, with a positive control',
		() => {
			const h = harness();
			const inspect = `const fs = require('node:fs');
const value = process.env.NOPEEK_TEST_VALUE;
const args = [process.pid, process.ppid].map(pid => fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8'));
process.exit(value && args.every(arg => !arg.includes(value)) ? 0 : 1);`;
			const child = run_probe(h, inspect);
			expect(child.status).toBe(0);
			expect(output(child)).not.toContain(h.canary);
			const exposed = h.run([
				'run',
				h.env_file,
				'--only',
				'NOPEEK_TEST_VALUE',
				'--',
				process.execPath,
				'-e',
				inspect,
				h.canary,
			]);
			expect(exposed.status).toBe(1);
			expect(output(exposed)).not.toContain(h.canary);
		},
	);

	it('preserves literal command arguments and the child exit code', () => {
		const h = harness();
		const before = snapshot(h.root);
		const child = h.run([
			'run',
			h.env_file,
			'--only',
			'NOPEEK_TEST_VALUE',
			'--',
			process.execPath,
			'-e',
			'process.exit(process.env.NOPEEK_TEST_VALUE && process.argv[1] === "a;touch injected" ? 7 : 1)',
			'a;touch injected',
		]);
		expect(child.status).toBe(7);
		expect(output(child)).not.toContain(h.canary);
		expect(snapshot(h.root)).toEqual(before);
	});

	it.each(['stdout', 'stderr'] as const)(
		'does not pretend to redact child-controlled %s',
		(stream) => {
			const h = harness();
			const child = run_probe(
				h,
				`process.${stream}.write(process.env.NOPEEK_TEST_VALUE ?? "")`,
			);
			expect(child.status).toBe(0);
			output(child);
			expect(String(child[stream])).toBe(h.canary);
			expect(
				String(child[stream === 'stdout' ? 'stderr' : 'stdout']),
			).not.toContain(h.canary);
		},
	);

	it.each([
		['production.tfvars', 'api_value = "fixture"\n'],
		['production.tfvars.json', '{"api_value":"fixture"}'],
	])('supports %s without storage side effects', (name, content) => {
		const h = harness();
		const source = join(h.root, name);
		writeFileSync(source, content);
		const before = snapshot(h.root);
		const child = h.run([
			'run',
			source,
			'--only',
			'api_value',
			'--',
			process.execPath,
			'-e',
			'process.exit(process.env.api_value === "fixture" ? 0 : 1)',
		]);
		expect(child.status).toBe(0);
		expect(output(child)).not.toContain(h.canary);
		expect(snapshot(h.root)).toEqual(before);
	});

	it('rejects malformed input before spawning a child or creating files', () => {
		const h = harness();
		writeFileSync(h.env_file, `SAFE=ok\nBROKEN="${h.canary}\n`);
		const before = snapshot(h.root);
		const child = h.run([
			'run',
			h.env_file,
			'--only',
			'SAFE',
			'--',
			process.execPath,
			'-e',
			'process.exit(99)',
		]);
		expect(child.status).not.toBe(0);
		expect(child.status).not.toBe(99);
		expect(output(child)).not.toContain(h.canary);
		expect(snapshot(h.root)).toEqual(before);
	});

	it('rejects flattened parser collisions before child execution', () => {
		const h = harness();
		const source = join(h.root, 'collision.tfvars.json');
		writeFileSync(
			source,
			JSON.stringify({
				NOPEEK_TEST_VALUE: h.canary,
				nested: { NOPEEK_TEST_VALUE: 'other-value' },
			}),
		);
		const before = snapshot(h.root);
		const child = h.run([
			'run',
			source,
			'--only',
			'NOPEEK_TEST_VALUE',
			'--',
			process.execPath,
			'-e',
			'process.exit(99)',
		]);
		expect(child.status).not.toBe(0);
		expect(child.status).not.toBe(99);
		expect(output(child)).not.toContain(h.canary);
		expect(snapshot(h.root)).toEqual(before);
	});

	it('reports a missing executable without writing credentials', () => {
		const h = harness();
		const before = snapshot(h.root);
		const child = h.run([
			'run',
			h.env_file,
			'--',
			join(h.root, 'missing-executable'),
		]);
		expect(child.status).toBe(127);
		expect(output(child)).not.toContain(h.canary);
		expect(snapshot(h.root)).toEqual(before);
	});
});

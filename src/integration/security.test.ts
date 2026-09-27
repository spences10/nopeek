import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const CLI = join(process.cwd(), 'dist', 'index.js');
const TIMEOUT_MS = 10_000;
const AGENT_KEYS = [
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
	'BASH_ENV',
	'ENV',
	'ZDOTDIR',
];
const isolations: { root: string; canary: string }[] = [];

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
	const canary = `NOPEEK_CANARY_${randomBytes(12).toString('hex')}`;
	isolations.push({ root, canary });
	const env_file = join(root, '.env');
	mkdirSync(join(root, 'home'));
	mkdirSync(join(root, 'tmp'));
	writeFileSync(env_file, `SECRET=${canary}\nSAFE=ok\n`);
	const env = { ...process.env };
	for (const key of AGENT_KEYS) delete env[key];
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
			spawnSync(process.execPath, [CLI, ...args], {
				cwd: root,
				env: override,
				encoding: 'utf-8',
				timeout: TIMEOUT_MS,
				shell: false,
			}),
	};
}

function output(result: ReturnType<typeof spawnSync>): string {
	return `${String(result.stdout ?? '')}${String(result.stderr ?? '')}${String(result.error?.message ?? '')}`;
}

function expect_canary_absent(
	result: ReturnType<typeof spawnSync>,
	canary: string,
): void {
	expect(output(result)).not.toContain(canary);
}

function expect_no_unexpected_canary(
	root: string,
	canary: string,
): void {
	const allowed = new Set([
		'.env',
		'collision.tfvars.json',
		'config.json',
	]);
	const visit = (dir: string): void => {
		if (!existsSync(dir)) return;
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			const stat = lstatSync(path);
			if (stat.isSymbolicLink()) continue;
			if (stat.isDirectory()) {
				visit(path);
				continue;
			}
			if (!stat.isFile() || allowed.has(name)) continue;
			expect(readFileSync(path, 'utf-8')).not.toContain(canary);
		}
	};
	visit(root);
}

function shell_available(shell: string): boolean {
	return (
		spawnSync(shell, ['--version'], {
			stdio: 'ignore',
			timeout: TIMEOUT_MS,
			shell: false,
		}).status === 0
	);
}

function assignment_round_trip(shell: 'bash' | 'zsh' | 'fish'): void {
	const h = harness();
	const value = `${h.canary} space $HOME \`tick\` "quote" \\ slash`;
	writeFileSync(h.env_file, `SECRET='${value}'\n`);
	const emitted = h.run([
		'load',
		h.env_file,
		'--shell',
		shell,
		'--allow-values',
	]);
	expect(emitted.status).toBe(0);
	expect(String(emitted.stdout)).toContain(h.canary);
	const script =
		shell === 'fish'
			? `${String(emitted.stdout)}\ntest "$SECRET" = "$argv[1]"`
			: `${String(emitted.stdout)}\ntest "$SECRET" = "$1"`;
	const evaluated = spawnSync(shell, ['-c', script, '--', value], {
		cwd: h.root,
		env: h.env,
		encoding: 'utf-8',
		timeout: TIMEOUT_MS,
		shell: false,
	});
	expect(evaluated.status).toBe(0);
	expect(String(evaluated.stderr)).not.toContain(h.canary);
	expect(process.env.SECRET).not.toBe(h.canary);
	const sibling = spawnSync(shell, ['-c', 'test -z "$SECRET"'], {
		env: h.env,
		encoding: 'utf-8',
		timeout: TIMEOUT_MS,
		shell: false,
	});
	expect(sibling.status).toBe(0);
}

afterEach(() => {
	for (const { root, canary } of isolations.splice(0)) {
		expect_no_unexpected_canary(root, canary);
		rmSync(root, { recursive: true, force: true });
	}
});

describe('built CLI security boundaries', () => {
	it('fails closed to name-only JSON in an unknown non-TTY harness', () => {
		const h = harness();
		const loaded = h.run(['load', h.env_file]);

		expect(loaded.status).toBe(0);
		expect_canary_absent(loaded, h.canary);
		const payload = JSON.parse(String(loaded.stdout)) as {
			method: string;
			contains_values: boolean;
			available_to_future_commands: boolean;
			persisted: boolean;
		};
		expect(payload).toMatchObject({
			method: 'name_only',
			contains_values: false,
			available_to_future_commands: false,
			persisted: false,
		});
		expect(existsSync(join(h.root, 'config'))).toBe(false);
		expect(readdirSync(join(h.root, 'tmp'))).toEqual([]);
	});

	it('fails closed to name-only text in an unknown non-TTY harness', () => {
		const h = harness();
		const loaded = h.run(['load', h.env_file, '--no-json']);

		expect(loaded.status).toBe(0);
		expect(String(loaded.stdout)).toBe('');
		expect(String(loaded.stderr)).toContain('SECRET');
		expect(String(loaded.stderr)).toContain(
			'not available to future commands',
		);
		expect_canary_absent(loaded, h.canary);
		expect(existsSync(join(h.root, 'config'))).toBe(false);
		expect(readdirSync(join(h.root, 'tmp'))).toEqual([]);
	});

	it('requires assignment opt-in and rejects it in detected agents', () => {
		const h = harness();
		const denied = h.run(['load', h.env_file, '--shell', 'bash']);
		expect(denied.status).not.toBe(0);
		expect_canary_absent(denied, h.canary);

		const agent = h.run(
			['load', h.env_file, '--shell', 'bash', '--allow-values'],
			{ ...h.env, PI_CODING_AGENT: 'true' },
		);
		expect(agent.status).not.toBe(0);
		expect_canary_absent(agent, h.canary);
		expect(existsSync(join(h.root, 'config'))).toBe(false);
	});

	it('round-trips explicitly disclosed assignments in bash', () => {
		expect(shell_available('bash')).toBe(true);
		assignment_round_trip('bash');
	});

	it.skipIf(!shell_available('zsh'))(
		'round-trips explicitly disclosed assignments in zsh (optional)',
		() => assignment_round_trip('zsh'),
	);

	it.skipIf(!shell_available('fish'))(
		'round-trips explicitly disclosed assignments in fish (optional)',
		() => assignment_round_trip('fish'),
	);

	it.each([false, true])(
		'never writes CLAUDE_ENV_FILE (persist=%s)',
		(persist) => {
			const h = harness();
			const session_env = join(h.root, 'session.env');
			writeFileSync(session_env, 'EXISTING=yes\n');
			const loaded = h.run(
				[
					'load',
					h.env_file,
					'--only',
					'SECRET',
					...(persist ? ['--persist'] : []),
				],
				{ ...h.env, CLAUDE_ENV_FILE: session_env },
			);
			expect(loaded.status).toBe(0);
			expect_canary_absent(loaded, h.canary);
			expect(readFileSync(session_env, 'utf-8')).toBe(
				'EXISTING=yes\n',
			);
			const payload = JSON.parse(String(loaded.stdout));
			expect(payload).toMatchObject({
				method: 'source_file',
				available_to_future_commands: false,
				contains_values: false,
			});
			expect(payload.message).toContain('disabled');
			const sourced = spawnSync(
				'bash',
				['-c', `${payload.next_command} && test -n "$SECRET"`],
				{
					env: h.env,
					encoding: 'utf-8',
					timeout: TIMEOUT_MS,
				},
			);
			expect(sourced.status).toBe(0);
			expect_canary_absent(sourced, h.canary);
			expect(existsSync(payload.source_path)).toBe(false);
		},
	);

	it('does not create an absent session env target', () => {
		const h = harness();
		const target = join(h.root, 'absent', 'session.env');
		const loaded = h.run(['load', h.env_file], {
			...h.env,
			CLAUDE_ENV_FILE: target,
		});
		expect(loaded.status).toBe(0);
		expect(existsSync(target)).toBe(false);
		expect_canary_absent(loaded, h.canary);
		rmSync(JSON.parse(String(loaded.stdout)).source_path);
	});

	it.each([undefined, '', ' , '])(
		'requires explicit --only for persistence (%s)',
		(only) => {
			const h = harness();
			const failed = h.run([
				'load',
				h.env_file,
				'--persist',
				...(only === undefined ? [] : ['--only', only]),
			]);
			expect(failed.status).toBe(1);
			expect(output(failed)).toContain('--persist requires --only');
			expect(
				existsSync(
					join(h.env.XDG_CONFIG_HOME!, 'nopeek', 'config.json'),
				),
			).toBe(false);
			expect_canary_absent(failed, h.canary);
		},
	);

	it('does not load globally persisted keys into another project', () => {
		const h = harness();
		const persisted = h.run([
			'load',
			h.env_file,
			'--only',
			'SECRET',
			'--persist',
		]);
		expect(persisted.status).toBe(0);
		expect(
			JSON.parse(String(persisted.stdout)).persistence_warning,
		).toContain('not project-scoped');
		const project_b = join(h.root, 'project-b');
		mkdirSync(project_b);
		const source_b = join(project_b, '.env');
		writeFileSync(source_b, 'SAFE=project-b\n');
		const child = spawnSync(
			process.execPath,
			[
				CLI,
				'run',
				source_b,
				'--only',
				'SAFE',
				'--',
				process.execPath,
				'-e',
				'process.exit(process.env.SECRET === undefined && process.env.SAFE === "project-b" ? 0 : 1)',
			],
			{
				cwd: project_b,
				env: { ...h.env, SECRET: undefined },
				encoding: 'utf-8',
				timeout: TIMEOUT_MS,
			},
		);
		expect(child.status).toBe(0);
		expect_canary_absent(child, h.canary);
	});

	it.skipIf(process.platform !== 'linux')(
		'keeps run credentials out of child and nopeek process arguments',
		() => {
			const h = harness();
			const inspect = `const fs = require('node:fs');
			const value = process.env.SECRET;
			const args = [process.pid, process.ppid].map(pid => fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8'));
			process.exit(value && args.every(arg => !arg.includes(value)) ? 0 : 1);`;
			const child = h.run([
				'run',
				h.env_file,
				'--only',
				'SECRET',
				'--',
				process.execPath,
				'-e',
				inspect,
			]);
			expect(child.status).toBe(0);
			expect_canary_absent(child, h.canary);
			// Positive control: the same probe must catch deliberate child argv exposure.
			const exposed = h.run([
				'run',
				h.env_file,
				'--only',
				'SECRET',
				'--',
				process.execPath,
				'-e',
				inspect,
				h.canary,
			]);
			expect(exposed.status).toBe(1);
		},
	);

	it.skipIf(process.platform !== 'linux')(
		'keeps sourced credentials out of the shell and child arguments',
		() => {
			const h = harness();
			const loaded = h.run(['load', h.env_file, '--only', 'SECRET'], {
				...h.env,
				CLAUDE_ENV_FILE: join(h.root, 'session.env'),
			});
			expect(loaded.status).toBe(0);
			const payload = JSON.parse(String(loaded.stdout));
			const probe = join(h.root, 'probe.cjs');
			writeFileSync(
				probe,
				`const fs = require('node:fs');
			const value = process.env.SECRET;
			const args = [process.pid, process.ppid].map(pid => fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8'));
			process.exit(value && args.every(arg => !arg.includes(value)) ? 0 : 1);`,
			);
			const child = spawnSync(
				'bash',
				[
					'--noprofile',
					'--norc',
					'-c',
					`${payload.next_command} && "$1" "$2"; exit $?`,
					'--',
					process.execPath,
					probe,
				],
				{
					env: h.env,
					encoding: 'utf-8',
					timeout: TIMEOUT_MS,
				},
			);
			expect(child.status).toBe(0);
			expect_canary_absent(child, h.canary);
			expect(existsSync(payload.source_path)).toBe(false);
			expect(existsSync(join(h.root, 'session.env'))).toBe(false);
		},
	);

	it('preserves inherited environment: --only filters the file, not the parent', () => {
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
				'process.exit(process.env.INHERITED_CANARY && process.env.SAFE === "ok" ? 0 : 1)',
			],
			{ ...h.env, INHERITED_CANARY: h.canary },
		);
		expect(child.status).toBe(0);
		expect_canary_absent(child, h.canary);
	});

	it.each([
		'CLAUDECODE',
		'CLAUDE_CODE_ENTRYPOINT',
		'PI_CODING_AGENT',
		'MY_PI_RUNTIME_MODE',
		'CODEX_SANDBOX',
		'CODEX_THREAD_ID',
		'CODEX_SESSION_ID',
		'GEMINI_CLI',
		'CURSOR_AGENT',
		'AIDER_MODEL',
	])('refuses value-emitting modes for %s', (marker) => {
		const h = harness();
		const env = { ...h.env, [marker]: '1', SYNTHETIC_KEY: h.canary };
		for (const args of [
			['load', h.env_file, '--shell', 'bash', '--allow-values'],
			['set', 'SYNTHETIC_KEY', '--value', h.canary],
		]) {
			const denied = h.run(args, env);
			expect(denied.status).toBe(1);
			expect_canary_absent(denied, h.canary);
		}
	});

	it('creates a private self-removing source fallback with no early inheritance', () => {
		const h = harness();
		const loaded = h.run(['load', h.env_file], {
			...h.env,
			PI_CODING_AGENT: 'true',
		});
		expect(loaded.status).toBe(0);
		expect_canary_absent(loaded, h.canary);
		const payload = JSON.parse(String(loaded.stdout)) as {
			method: string;
			source_path: string;
		};
		expect(payload.method).toBe('source_file');
		expect(process.env.SECRET).not.toBe(h.canary);
		const file_stat = lstatSync(payload.source_path);
		const root_stat = lstatSync(join(payload.source_path, '..'));
		expect(file_stat.mode & 0o777).toBe(0o600);
		expect(root_stat.mode & 0o777).toBe(0o700);
		const sourced = spawnSync(
			'bash',
			[
				'-c',
				`source "$1"; status=$?; test "$SECRET" = "$2" && test ! -e "$1" && ! compgen -A function | grep -q '^_nopeek_'; exit $status`,
				'--',
				payload.source_path,
				h.canary,
			],
			{ env: h.env, encoding: 'utf-8', timeout: TIMEOUT_MS },
		);
		expect(sourced.status).toBe(0);
		expect(existsSync(payload.source_path)).toBe(false);
	});

	it('keeps run argv and environment boundaries while preserving child exit', () => {
		const h = harness();
		const marker = join(h.root, 'injected');
		const child = h.run([
			'run',
			h.env_file,
			'--only',
			'SECRET',
			'--',
			process.execPath,
			'-e',
			'process.exit(process.env.SECRET === process.argv[1] && process.argv[2] === "a;touch injected" ? 7 : 1)',
			h.canary,
			'a;touch injected',
		]);
		expect(child.status).toBe(7);
		expect_canary_absent(child, h.canary);
		expect(existsSync(marker)).toBe(false);
		expect(process.env.SECRET).not.toBe(h.canary);
	});

	it('confines deliberate child env disclosure to child-controlled stdout', () => {
		const h = harness();
		const child = h.run([
			'run',
			h.env_file,
			'--only',
			'SECRET',
			'--',
			process.execPath,
			'-e',
			'process.stdout.write(process.env.SECRET ?? "")',
		]);
		expect(child.status).toBe(0);
		expect(String(child.stdout)).toBe(h.canary);
		expect(String(child.stderr)).not.toContain(h.canary);
	});

	it('fails malformed input before output, persistence, or child spawn', () => {
		const h = harness();
		const marker = join(h.root, 'spawned');
		writeFileSync(
			h.env_file,
			`SAFE=ok\nSAFE=duplicate\nBROKEN="${h.canary}\n`,
		);
		const failed = h.run([
			'run',
			h.env_file,
			'--only',
			'SAFE',
			'--',
			process.execPath,
			'-e',
			`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'yes')`,
		]);
		expect(failed.status).not.toBe(0);
		expect_canary_absent(failed, h.canary);
		expect(existsSync(marker)).toBe(false);
		expect(existsSync(join(h.root, 'config'))).toBe(false);
	});

	it('rejects flattened parser collisions before child execution', () => {
		const h = harness();
		const tfvars = join(h.root, 'collision.tfvars.json');
		const marker = join(h.root, 'spawned');
		writeFileSync(
			tfvars,
			JSON.stringify({
				TOKEN: h.canary,
				nested: { TOKEN: 'collision' },
			}),
		);
		const failed = h.run([
			'run',
			tfvars,
			'--only',
			'TOKEN',
			'--',
			process.execPath,
			'-e',
			`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'yes')`,
		]);
		expect(failed.status).not.toBe(0);
		expect_canary_absent(failed, h.canary);
		expect(existsSync(marker)).toBe(false);
	});

	it('rejects symlinked config without touching its target', () => {
		const h = harness();
		const config_parent = join(h.root, 'config');
		const target = join(h.root, 'config-target');
		mkdirSync(config_parent, { recursive: true });
		mkdirSync(target, { mode: 0o700 });
		writeFileSync(join(target, 'sentinel'), 'untouched', {
			mode: 0o600,
		});
		symlinkSync(target, join(config_parent, 'nopeek'));

		const failed = h.run(['status']);
		expect(failed.status).not.toBe(0);
		expect_canary_absent(failed, h.canary);
		expect(readFileSync(join(target, 'sentinel'), 'utf-8')).toBe(
			'untouched',
		);
	});

	it('fails corrupt config and unsafe temp roots without value disclosure', () => {
		const h = harness();
		const config_dir = join(h.root, 'config', 'nopeek');
		const temp_root = join(
			h.root,
			'tmp',
			`nopeek-${process.getuid?.()}`,
		);
		mkdirSync(config_dir, { recursive: true });
		writeFileSync(
			join(config_dir, 'config.json'),
			`{ "value": "${h.canary}"`,
			{ mode: 0o600 },
		);
		const corrupt = h.run(['status']);
		expect(corrupt.status).not.toBe(0);
		expect_canary_absent(corrupt, h.canary);
		expect(existsSync(config_dir)).toBe(true);

		rmSync(join(h.root, 'tmp'), { recursive: true, force: true });
		mkdirSync(join(h.root, 'tmp'), { recursive: true });
		writeFileSync(temp_root, 'not a directory');
		const unsafe = h.run(['load', h.env_file], {
			...h.env,
			PI_CODING_AGENT: 'true',
		});
		expect(unsafe.status).not.toBe(0);
		expect_canary_absent(unsafe, h.canary);
	});
});

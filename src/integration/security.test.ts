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
		'session.env',
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

	it('injects an isolated env file without parent or output disclosure', () => {
		const h = harness();
		const session_env = join(h.root, 'session.env');
		writeFileSync(session_env, 'EXISTING=yes\n');
		const loaded = h.run(['load', h.env_file], {
			...h.env,
			CLAUDE_ENV_FILE: session_env,
			PI_CODING_AGENT: 'true',
		});
		expect(loaded.status).toBe(0);
		expect_canary_absent(loaded, h.canary);
		expect(process.env.SECRET).not.toBe(h.canary);
		const content = readFileSync(session_env, 'utf-8');
		expect(content).toContain(h.canary);
		const sourced = spawnSync(
			'bash',
			[
				'-c',
				`source "$1"; test "$SECRET" = "$2"`,
				'--',
				session_env,
				h.canary,
			],
			{ env: h.env, encoding: 'utf-8', timeout: TIMEOUT_MS },
		);
		expect(sourced.status).toBe(0);
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

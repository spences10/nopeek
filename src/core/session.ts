import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function has_claude_env_file(): boolean {
	return !!process.env.CLAUDE_ENV_FILE;
}

export function is_claude_code(): boolean {
	return (
		!!process.env.CLAUDECODE || !!process.env.CLAUDE_CODE_ENTRYPOINT
	);
}

export function validate_key(key: string): boolean {
	return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key);
}

export function inject_env(key: string, value: string): void {
	if (!validate_key(key)) {
		throw new Error(`Invalid env key: ${key}`);
	}
	const env_file = process.env.CLAUDE_ENV_FILE;
	if (env_file) {
		appendFileSync(
			env_file,
			`export ${key}=${shell_escape(value)}\n`,
		);
	}
}

export function write_nopeek_env(
	exports: { key: string; value: string }[],
): string {
	for (const { key } of exports) {
		if (!validate_key(key)) {
			throw new Error(`Invalid env key: ${key}`);
		}
	}
	const dir = join(tmpdir(), 'nopeek');
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const path = join(dir, `env-${randomBytes(4).toString('hex')}.sh`);
	const content = exports
		.map(({ key, value }) => `export ${key}=${shell_escape(value)}`)
		.join('\n');
	writeFileSync(path, content + '\n', {
		encoding: 'utf-8',
		mode: 0o600,
	});
	return path;
}

export function shell_escape(value: string): string {
	if (!/[^a-zA-Z0-9_./:@=-]/.test(value)) return value;
	return `'${value.replace(/'/g, "'\\''")}'`;
}

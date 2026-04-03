import { appendFileSync } from 'node:fs';

export function is_claude_session(): boolean {
	return !!process.env.CLAUDE_ENV_FILE;
}

export function inject_env(key: string, value: string): void {
	const env_file = process.env.CLAUDE_ENV_FILE;
	if (env_file) {
		appendFileSync(
			env_file,
			`export ${key}=${shell_escape(value)}\n`,
		);
	}
}

function shell_escape(value: string): string {
	if (!/[^a-zA-Z0-9_./:@=-]/.test(value)) return value;
	return `'${value.replace(/'/g, "'\\''")}'`;
}

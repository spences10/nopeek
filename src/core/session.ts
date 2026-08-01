import { appendFileSync } from 'node:fs';
import {
	type TempEnvFile,
	type TempEnvOptions,
	write_temp_env_file,
} from './temp-env.js';

const AGENT_MARKERS = [
	'CLAUDE_ENV_FILE',
	'CLAUDECODE',
	'CLAUDE_CODE_ENTRYPOINT',
	'PI_CODING_AGENT',
	'PI_CODING_AGENT_SESSION_DIR',
	'MY_PI_RUNTIME_MODE',
	'CODEX_SANDBOX',
	'CURSOR_AGENT',
	'AIDER_MODEL',
];

export function has_session_env_file(): boolean {
	return !!process.env.CLAUDE_ENV_FILE;
}

export function is_llm_agent_session(): boolean {
	return AGENT_MARKERS.some((key) => !!process.env[key]);
}

export function validate_key(key: string): boolean {
	return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key);
}

export function assert_valid_key(key: string): void {
	if (!validate_key(key)) {
		throw new Error(`Invalid env key: ${key}`);
	}
}

export function inject_env(key: string, value: string): void {
	assert_valid_key(key);
	const env_file = process.env.CLAUDE_ENV_FILE;
	if (env_file) {
		appendFileSync(
			env_file,
			`export ${key}=${shell_escape(value)}\n`,
			{ mode: 0o600 },
		);
	}
}

export function write_nopeek_env(
	exports: { key: string; value: string }[],
	options?: TempEnvOptions,
): TempEnvFile {
	for (const { key } of exports) {
		assert_valid_key(key);
	}
	return write_temp_env_file(exports, options);
}

export type Shell = 'bash' | 'zsh' | 'fish';

export function shell_export_line(
	key: string,
	value: string,
	shell: Shell,
): string {
	assert_valid_key(key);
	if (shell === 'fish') return `set -gx ${key} ${fish_escape(value)}`;
	return `export ${key}=${shell_escape(value)}`;
}

export function shell_escape(value: string): string {
	if (!/[^a-zA-Z0-9_./:@=-]/.test(value)) return value;
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function fish_escape(value: string): string {
	if (value === '') return "''";
	return value.replace(/[^a-zA-Z0-9_./:@=-]/g, (ch) => {
		if (ch === '\n') return '\\n';
		if (ch === '\r') return '\\r';
		if (ch === '\t') return '\\t';
		return `\\${ch}`;
	});
}

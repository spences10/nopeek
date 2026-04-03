import { existsSync } from 'node:fs';
import { parse_env_file } from '../core/env-file.js';
import {
	has_claude_env_file,
	inject_env,
	is_claude_code,
	write_nopeek_env,
} from '../core/session.js';
import { error, info, success } from '../utils/output.js';

export function load_command(file: string, only?: string): void {
	if (!existsSync(file)) {
		error(`File not found: ${file}`);
		process.exit(1);
	}

	const entries = parse_env_file(file);
	if (entries.length === 0) {
		error(`No keys found in ${file}`);
		process.exit(1);
	}

	const filter = only
		? new Set(only.split(',').map((k) => k.trim()))
		: null;

	const selected = entries.filter(
		({ key }) => !filter || filter.has(key),
	);

	if (selected.length === 0) {
		error('No matching keys found');
		process.exit(1);
	}

	if (has_claude_env_file()) {
		// Best case: CLAUDE_ENV_FILE exists (hook-based setup)
		for (const { key, value } of selected) {
			inject_env(key, value);
		}
		info(`Loaded ${selected.length} keys from ${file}:`);
		for (const { key } of selected) {
			info(`  ${key}`);
		}
		success('Keys are now available as environment variables.');
	} else if (is_claude_code()) {
		// Inside Claude Code but no CLAUDE_ENV_FILE
		// Write to temp file, print source command only
		const path = write_nopeek_env(selected);
		// stdout: only the source command (Claude runs this)
		console.log(`source ${path}`);
		// stderr: key names for Claude to see
		info(`Loaded ${selected.length} keys from ${file}:`);
		for (const { key } of selected) {
			info(`  ${key}`);
		}
		success('Run the source command above to load into session.');
	} else {
		// Outside Claude Code — print eval-able exports
		for (const { key, value } of selected) {
			console.log(`export ${key}=${shell_escape(value)}`);
		}
		info(`Loaded ${selected.length} keys from ${file}:`);
		for (const { key } of selected) {
			info(`  ${key}`);
		}
	}
}

function shell_escape(value: string): string {
	if (!/[^a-zA-Z0-9_./:@=-]/.test(value)) return value;
	return `'${value.replace(/'/g, "'\\''")}'`;
}

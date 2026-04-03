import { existsSync } from 'node:fs';
import { parse_env_file } from '../core/env-file.js';
import { inject_env, is_claude_session } from '../core/session.js';
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

	const loaded: string[] = [];

	for (const { key, value } of entries) {
		if (filter && !filter.has(key)) continue;

		if (is_claude_session()) {
			inject_env(key, value);
		} else {
			// Outside Claude Code — print eval-able exports to stdout
			console.log(`export ${key}=${shell_escape(value)}`);
		}
		loaded.push(key);
	}

	if (loaded.length === 0) {
		error('No matching keys found');
		process.exit(1);
	}

	// Key names go to stderr so Claude sees them but not values
	info(`Loaded ${loaded.length} keys from ${file}:`);
	for (const key of loaded) {
		info(`  ${key}`);
	}

	if (is_claude_session()) {
		success(
			'Keys are now available as environment variables in this session.',
		);
	}
}

function shell_escape(value: string): string {
	if (!/[^a-zA-Z0-9_./:@=-]/.test(value)) return value;
	return `'${value.replace(/'/g, "'\\''")}'`;
}

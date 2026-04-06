import { existsSync } from 'node:fs';
import { read_config, write_config } from '../core/config.js';
import { parse_file } from '../core/env-file.js';
import {
	has_claude_env_file,
	inject_env,
	is_claude_code,
	shell_escape,
	write_nopeek_env,
} from '../core/session.js';
import { error, info, success } from '../utils/output.js';

export function load_command(
	file: string,
	only?: string,
	persist?: boolean,
): void {
	if (!existsSync(file)) {
		error(`File not found: ${file}`);
		process.exit(1);
	}

	const entries = parse_file(file);
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

	// Persist to config if requested
	if (persist) {
		const config = read_config();
		for (const { key, value } of selected) {
			config.keys[key] = { value, source: 'load' };
		}
		write_config(config);
	}

	if (has_claude_env_file()) {
		for (const { key, value } of selected) {
			inject_env(key, value);
		}
		info(`Loaded ${selected.length} keys from ${file}:`);
		for (const { key } of selected) {
			info(`  ${key}`);
		}
		success('Keys are now available as environment variables.');
	} else if (is_claude_code()) {
		const path = write_nopeek_env(selected);
		console.log(`source ${path}`);
		info(`Loaded ${selected.length} keys from ${file}:`);
		for (const { key } of selected) {
			info(`  ${key}`);
		}
		success('Run the source command above to load into session.');
	} else {
		for (const { key, value } of selected) {
			console.log(`export ${key}=${shell_escape(value)}`);
		}
		info(`Loaded ${selected.length} keys from ${file}:`);
		for (const { key } of selected) {
			info(`  ${key}`);
		}
	}

	if (persist) {
		success(
			`${selected.length} key(s) saved to nopeek config for future sessions.`,
		);
	}
}

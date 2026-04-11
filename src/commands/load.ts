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
import { fail, info, output, success } from '../utils/output.js';

export function load_command(
	file: string,
	only?: string,
	persist?: boolean,
	json?: boolean,
): void {
	if (!existsSync(file)) {
		fail(`File not found: ${file}`, json);
	}

	const entries = parse_file(file);
	if (entries.length === 0) {
		fail(`No keys found in ${file}`, json);
	}

	const filter = only
		? new Set(only.split(',').map((k) => k.trim()))
		: null;

	const selected = entries.filter(
		({ key }) => !filter || filter.has(key),
	);

	if (selected.length === 0) {
		fail('No matching keys found', json);
	}

	// Persist to config if requested
	if (persist) {
		const config = read_config();
		for (const { key, value } of selected) {
			config.keys[key] = { value, source: 'load' };
		}
		write_config(config);
	}

	const keys = selected.map(({ key }) => key);
	let method: string;
	let source_path: string | undefined;

	if (has_claude_env_file()) {
		for (const { key, value } of selected) {
			inject_env(key, value);
		}
		method = 'claude_env_file';
	} else if (is_claude_code()) {
		source_path = write_nopeek_env(selected);
		method = 'source_file';
	} else {
		method = 'export';
	}

	if (!json) {
		if (method === 'source_file') {
			console.log(`source ${source_path}`);
		} else if (method === 'export') {
			for (const { key, value } of selected) {
				console.log(`export ${key}=${shell_escape(value)}`);
			}
		}
		info(`Loaded ${selected.length} keys from ${file}:`);
		for (const key of keys) {
			info(`  ${key}`);
		}
		if (method === 'claude_env_file') {
			success('Keys are now available as environment variables.');
		} else if (method === 'source_file') {
			success('Run the source command above to load into session.');
		}
		if (persist) {
			success(
				`${selected.length} key(s) saved to nopeek config for future sessions.`,
			);
		}
		return;
	}

	const result: Record<string, unknown> = {
		success: true,
		keys,
		method,
		persisted: !!persist,
		file,
	};
	if (source_path) {
		result.source_path = source_path;
	}
	output(result, true);
}

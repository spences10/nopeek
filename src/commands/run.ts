import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
	duplicate_key_message,
	parse_file,
	type DuplicateKey,
	type EnvEntry,
} from '../core/env-file.js';
import { validate_key } from '../core/session.js';
import { error, fail, warning } from '../utils/output.js';

export function run_command(
	file: string,
	only: string | undefined,
	command: string[],
): void {
	if (!existsSync(file)) {
		fail(`File not found: ${file}`, false);
	}
	if (command.length === 0) {
		fail('Missing command after --', false);
	}

	const duplicates: DuplicateKey[] = [];
	const entries = parse_file(file, duplicates);
	if (entries.length === 0) {
		fail(`No keys found in ${file}`, false);
	}

	const selected = select_entries(entries, only);
	if (selected.length === 0) {
		fail('No matching keys found', false);
	}

	const selected_keys = new Set(selected.map(({ key }) => key));
	for (const duplicate of duplicates) {
		if (selected_keys.has(duplicate.key))
			warning(duplicate_key_message(file, duplicate));
	}

	const invalid_keys = [
		...new Set(
			selected
				.map(({ key }) => key)
				.filter((key) => !validate_key(key)),
		),
	];
	if (invalid_keys.length > 0) {
		fail('Invalid env key name(s)', false);
	}

	const env = { ...process.env };
	for (const { key, value } of selected) {
		env[key] = value;
	}

	const result = spawnSync(command[0], command.slice(1), {
		env,
		stdio: 'inherit',
		shell: false,
	});

	if (result.error) {
		error(`Failed to run command: ${result.error.message}`);
		process.exit(127);
	}
	if (result.status !== null) {
		process.exit(result.status);
	}
	if (result.signal) {
		error(`Command terminated by signal: ${result.signal}`);
		process.exit(1);
	}
	process.exit(1);
}

function select_entries(
	entries: EnvEntry[],
	only?: string,
): EnvEntry[] {
	const filter = only
		? new Set(
				only
					.split(',')
					.map((k) => k.trim())
					.filter(Boolean),
			)
		: null;
	return entries.filter(({ key }) => !filter || filter.has(key));
}

import { existsSync } from 'node:fs';
import {
	PERSISTENCE_WARNING,
	read_config,
	write_config,
} from '../core/config.js';
import { parse_file, type EnvEntry } from '../core/env-file.js';
import {
	is_llm_agent_session,
	shell_escape,
	shell_export_line,
	validate_key,
	write_nopeek_env,
	type Shell,
} from '../core/session.js';
import {
	fail,
	info,
	output,
	success,
	warning,
} from '../utils/output.js';

export function load_command(
	file: string,
	only?: string,
	persist?: boolean,
	json?: boolean,
	shell?: Shell,
	allow_values?: boolean,
): void {
	if (!existsSync(file)) {
		fail(`File not found: ${file}`, json);
	}

	const entries = parse_file(file);
	if (entries.length === 0) {
		fail(`No keys found in ${file}`, json);
	}

	const filter = only
		? new Set(
				only
					.split(',')
					.map((k) => k.trim())
					.filter(Boolean),
			)
		: null;

	if (persist && (!filter || filter.size === 0)) {
		fail(
			'--persist requires --only with explicit key names; stored keys are global, not project-scoped.',
			json,
		);
	}

	const selected = entries.filter(
		({ key }) => !filter || filter.has(key),
	);

	if (selected.length === 0) {
		fail('No matching keys found', json);
	}

	const invalid_keys = invalid_keys_for(selected);
	if (invalid_keys.length > 0) {
		fail('Invalid env key name(s)', json, { invalid_keys });
	}

	const keys = selected.map(({ key }) => key);
	const in_agent_session = is_llm_agent_session();

	if (allow_values && in_agent_session) {
		fail(
			'Value-emitting output is disabled inside detected LLM agent sessions.',
			json,
			{ contains_values: false },
		);
	}

	if (shell && !allow_values) {
		fail(
			'--shell emits secret values and requires explicit --allow-values opt-in.',
			json,
			{ contains_values: false },
		);
	}

	// Validate disclosure policy before persistence or any other side effect.
	if (persist) {
		const config = read_config();
		for (const { key, value } of selected) {
			config.keys[key] = { value, source: 'load' };
		}
		write_config(config);
	}

	if (shell) {
		warning(
			'Secret values are being emitted to stdout. Consume this output only in a trusted shell.',
		);
		for (const { key, value } of selected) {
			console.log(shell_export_line(key, value, shell));
		}
		info(
			`Emitted ${shell} shell assignments for ${selected.length} key(s) from ${file}.`,
		);
		if (persist) {
			success(
				`${selected.length} key(s) saved to plaintext nopeek config.`,
			);
			warning(PERSISTENCE_WARNING);
		}
		return;
	}

	let method: string;
	let source_path: string | undefined;
	let stale_files_removed = 0;

	if (in_agent_session) {
		const temp_env = write_nopeek_env(selected);
		source_path = temp_env.path;
		stale_files_removed = temp_env.stale_files_removed;
		method = 'source_file';
	} else {
		method = allow_values && !json ? 'export' : 'name_only';
	}

	const next_command = next_command_for(
		method,
		file,
		only,
		persist,
		source_path,
	);
	const availability = availability_message_for(
		method,
		!!allow_values,
	);

	if (!json) {
		if (method === 'source_file' && source_path) {
			console.log(source_command_for(source_path));
		} else if (method === 'export') {
			warning(
				'Secret values are being emitted to stdout. Consume this output only in a trusted shell.',
			);
			for (const { key, value } of selected) {
				console.log(`export ${key}=${shell_escape(value)}`);
			}
		}
		info(`Found ${selected.length} key(s) in ${file}:`);
		for (const key of keys) {
			info(`  ${key}`);
		}
		warning(availability);
		if (next_command) {
			info(`Next step: ${next_command}`);
		}
		if (stale_files_removed > 0) {
			info(`Removed ${stale_files_removed} stale temp env file(s).`);
		}
		if (persist) {
			success(
				`${selected.length} key(s) saved to plaintext nopeek config.`,
			);
			warning(PERSISTENCE_WARNING);
		}
		return;
	}

	const result: Record<string, unknown> = {
		success: true,
		keys,
		method,
		persisted: !!persist,
		plaintext_config: !!persist,
		file,
		available_to_future_commands: false,
		contains_values: false,
		stale_files_removed,
		message: availability,
	};
	result.warning = availability;
	if (persist) {
		result.persistence_warning = PERSISTENCE_WARNING;
	}
	if (next_command) {
		result.next_command = next_command;
	}
	if (source_path) {
		result.source_path = source_path;
	}
	output(result, true);
}

function next_command_for(
	method: string,
	file: string,
	only?: string,
	persist?: boolean,
	source_path?: string,
): string | undefined {
	if (method === 'export') return undefined;
	if (method === 'source_file' && source_path)
		return source_command_for(source_path);

	const args = [shell_escape(file)];
	if (only) args.push('--only', shell_escape(only));
	if (persist) args.push('--persist');
	args.push('--shell', 'bash', '--allow-values');
	return `eval "$(nopeek load ${args.join(' ')})"`;
}

function source_command_for(path: string): string {
	const escaped = shell_escape(path);
	return `if source ${escaped}; then :; else (status=$?; rm -f ${escaped}; exit "$status"); fi`;
}

function availability_message_for(
	method: string,
	contains_values: boolean,
): string {
	if (method === 'source_file') {
		return 'Session-wide env-file injection is disabled for secret safety. Prefer nopeek run. Keys are available only after sourcing the generated file in the shell running your command; never copy its contents into a command or session env file.';
	}
	if (method === 'export' && contains_values) {
		return 'Shell exports were printed only; keys are not available to future commands unless you evaluate them in your current shell.';
	}
	return 'Name-only output was used; no secret values were printed and keys are not available to future commands.';
}

function invalid_keys_for(entries: EnvEntry[]): string[] {
	return [
		...new Set(
			entries
				.map(({ key }) => key)
				.filter((key) => !validate_key(key)),
		),
	];
}

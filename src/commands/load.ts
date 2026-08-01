import { existsSync } from 'node:fs';
import { read_config, write_config } from '../core/config.js';
import { parse_file, type EnvEntry } from '../core/env-file.js';
import {
	has_session_env_file,
	inject_env,
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
				`${selected.length} key(s) saved to plaintext nopeek config for future sessions.`,
			);
		}
		return;
	}

	let method: string;
	let source_path: string | undefined;

	if (has_session_env_file()) {
		for (const { key, value } of selected) {
			inject_env(key, value);
		}
		method = 'env_file';
	} else if (in_agent_session) {
		source_path = write_nopeek_env(selected);
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
		if (method === 'source_file') {
			console.log(`source ${source_path}`);
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
		if (method === 'env_file') {
			success(availability);
		} else {
			warning(availability);
			if (next_command) {
				info(`Next step: ${next_command}`);
			}
		}
		if (persist) {
			success(
				`${selected.length} key(s) saved to plaintext nopeek config for future sessions.`,
			);
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
		available_to_future_commands: method === 'env_file',
		contains_values: false,
		message: availability,
	};
	if (method !== 'env_file') {
		result.warning = availability;
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
	if (method === 'env_file' || method === 'export') return undefined;
	if (method === 'source_file' && source_path)
		return `source ${shell_escape(source_path)}`;

	const args = [shell_escape(file)];
	if (only) args.push('--only', shell_escape(only));
	if (persist) args.push('--persist');
	args.push('--shell', 'bash', '--allow-values');
	return `eval "$(nopeek load ${args.join(' ')})"`;
}

function availability_message_for(
	method: string,
	contains_values: boolean,
): string {
	if (method === 'env_file') {
		return 'Keys were injected into the session env file and are available to future commands.';
	}
	if (method === 'source_file') {
		return 'Env-file injection is unavailable; keys were written to a source file only and are not available until sourced in the shell that runs your command.';
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

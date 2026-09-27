import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PERSISTENCE_WARNING, read_config } from '../core/config.js';
import { parse_file } from '../core/env-file.js';
import { is_llm_agent_session } from '../core/session.js';
import { scan_all } from '../detectors/index.js';
import { info, label, output } from '../utils/output.js';

export async function status_command(json?: boolean): Promise<void> {
	const config = read_config();
	const in_agent_session = is_llm_agent_session();
	const load_method = in_agent_session ? 'source_file' : 'name_only';
	const keys = Object.keys(config.keys);
	const profiles = Object.entries(config.cli_profiles);
	const results = await scan_all();

	// .env file detection
	const cwd = process.cwd();
	const env_files: { name: string; key_count: number }[] = [];
	try {
		const files = readdirSync(cwd);
		for (const f of files) {
			if (
				f === '.env' ||
				(f.startsWith('.env.') && !f.endsWith('.example'))
			) {
				try {
					const entries = parse_file(join(cwd, f));
					env_files.push({ name: f, key_count: entries.length });
				} catch {
					// skip unparseable files
				}
			}
		}
	} catch {
		// can't read cwd, skip
	}

	const data = {
		contains_values: false,
		session: {
			in_llm_agent_session: in_agent_session,
			has_env_file_injection: false,
			load_method,
			future_commands_see_loaded_vars: false,
			message: status_message(in_agent_session),
		},
		storage: {
			scope: 'user',
			automatic_loading: false,
			warning: keys.length > 0 ? PERSISTENCE_WARNING : undefined,
		},
		keys: keys.map((key) => ({
			name: key,
			source: config.keys[key].source,
		})),
		cli_profiles: profiles.map(([cli, prof]) => ({
			cli,
			profile: prof.profile,
		})),
		detected_clis: results.map((r) => ({
			name: r.name,
			version: r.version,
			status: r.status,
			detail: r.detail,
		})),
		env_files,
	};

	if (!json) {
		info(
			'Session: ' +
				(in_agent_session
					? 'Inside LLM agent session'
					: 'Outside LLM agent session'),
		);
		info(
			'Future commands: will not see variables loaded by nopeek load automatically',
		);
		info(status_message(in_agent_session));
		if (keys.length > 0) info(PERSISTENCE_WARNING);

		console.error('');
		info(`Stored keys: ${keys.length}`);
		for (const key of keys) {
			label(`  ${key} [${config.keys[key].source}]`);
		}

		console.error('');
		info(`CLI profiles: ${profiles.length}`);
		for (const [cli, prof] of profiles) {
			label(`  ${cli} → ${prof.profile}`);
		}

		console.error('');
		info('Detected CLIs:');
		if (results.length === 0) {
			label('  None found');
		} else {
			for (const r of results) {
				const status_tag =
					r.status === 'ok'
						? '[OK]'
						: r.status === 'migrate'
							? '[MIGRATE]'
							: '[SKIP]';
				label(`  ${r.name} v${r.version} ${status_tag}`);
			}
		}

		if (env_files.length > 0) {
			console.error('');
			info(`.env files in ${cwd}:`);
			for (const { name, key_count } of env_files) {
				label(
					`  ${name} (${key_count} key${key_count !== 1 ? 's' : ''})`,
				);
			}
			if (keys.length === 0) {
				label(
					'  Tip: npx nopeek run .env --only KEY -- your-command',
				);
			}
		}
		return;
	}

	output(data, true);
}

function status_message(in_agent_session: boolean): string {
	if (in_agent_session) {
		return 'Session-wide env-file injection is disabled for secret safety. Prefer nopeek run; nopeek load provides a source file for use only in the shell running your command.';
	}
	return 'Prefer nopeek run. nopeek load defaults to name-only output; use --shell with explicit --allow-values only in a trusted interactive shell.';
}

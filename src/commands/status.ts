import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { read_config } from '../core/config.js';
import { parse_file } from '../core/env-file.js';
import { is_llm_agent_session } from '../core/session.js';
import { scan_all } from '../detectors/index.js';
import { info, label, output } from '../utils/output.js';

export async function status_command(json?: boolean): Promise<void> {
	const config = read_config();
	const in_agent_session = is_llm_agent_session();
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
		session: {
			in_llm_agent_session: in_agent_session,
			has_env_file_injection: !!process.env.CLAUDE_ENV_FILE,
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
				label('  Tip: npx nopeek load .env');
			}
		}
		return;
	}

	output(data, true);
}

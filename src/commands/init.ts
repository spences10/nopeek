import { read_config, write_config } from '../core/config.js';
import { scan_all } from '../detectors/index.js';
import { found, info, output, success } from '../utils/output.js';

export async function init_command(json?: boolean): Promise<void> {
	if (!json) {
		info('Scanning for cloud CLIs...\n');
	}

	const results = await scan_all();

	// Store detected profiles in config
	const config = read_config();
	let stored = 0;

	for (const r of results) {
		if (r.status === 'ok' && r.profile && r.env_var) {
			config.cli_profiles[r.name] = { profile: r.profile };
			stored++;
		}
	}

	if (stored > 0) {
		write_config(config);
	}

	const migrations = results
		.filter((r) => r.status === 'migrate')
		.map((r) => ({ cli: r.name, detail: r.detail }));

	const data = {
		detected: results.map((r) => ({
			name: r.name,
			version: r.version,
			status: r.status,
			detail: r.detail,
			profile: r.profile || null,
		})),
		stored,
		migrations,
	};

	if (!json) {
		if (results.length === 0) {
			info('No supported cloud CLIs found.');
			return;
		}

		for (const r of results) {
			const version_str = r.version ? ` (v${r.version})` : '';
			const status_tag =
				r.status === 'ok'
					? '[OK]'
					: r.status === 'migrate'
						? '[MIGRATE]'
						: '[SKIP]';
			found(`${r.name}${version_str} — ${r.detail} ${status_tag}`);
		}

		if (stored > 0) {
			console.error('');
			success(`${stored} CLI profile(s) saved to nopeek config`);
		}

		if (migrations.length > 0) {
			console.error('');
			info('Migrations needed:');
			for (const m of migrations) {
				info(
					`  ${m.cli} — move inline credentials to profile-based auth`,
				);
			}
			info(
				'\n  Run the CLI-specific commands to configure profiles,',
			);
			info('  then re-run "nopeek init" to detect them.');
		}
		return;
	}

	output(data, true);
}

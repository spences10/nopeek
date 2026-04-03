import chalk from 'chalk';
import { read_config, write_config } from '../core/config.js';
import { scan_all } from '../detectors/index.js';
import { found, info, success } from '../utils/output.js';

export async function init_command(): Promise<void> {
	info('Scanning for cloud CLIs...\n');

	const results = await scan_all();

	if (results.length === 0) {
		info('No supported cloud CLIs found.');
		return;
	}

	for (const r of results) {
		const version_str = r.version ? ` (v${r.version})` : '';
		const status_color =
			r.status === 'ok'
				? chalk.green
				: r.status === 'migrate'
					? chalk.yellow
					: chalk.dim;
		found(`${r.name}${version_str} — ${status_color(r.detail)}`);
	}

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
		console.error('');
		success(`${stored} CLI profile(s) saved to nopeek config`);
	}

	const migrations = results.filter((r) => r.status === 'migrate');
	if (migrations.length > 0) {
		console.error('');
		info(chalk.yellow('Migrations needed:'));
		for (const m of migrations) {
			info(
				`  ${m.name} — move inline credentials to profile-based auth`,
			);
		}
		info(
			chalk.dim(
				'\n  Run the CLI-specific commands to configure profiles,',
			),
		);
		info(chalk.dim('  then re-run "nopeek init" to detect them.'));
	}
}

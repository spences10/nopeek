import chalk from 'chalk';
import { read_config } from '../core/config.js';
import { info } from '../utils/output.js';

export function list_command(): void {
	const config = read_config();
	const keys = Object.keys(config.keys);
	const profiles = Object.entries(config.cli_profiles);

	if (keys.length === 0 && profiles.length === 0) {
		info('No keys or profiles stored.');
		info('Use "nopeek set <KEY>" or "nopeek load .env" first.');
		return;
	}

	if (keys.length > 0) {
		for (const key of keys) {
			const source = config.keys[key].source;
			console.log(
				`  ${chalk.white(key.padEnd(25))} ${chalk.dim(`[${source}]`)}`,
			);
		}
	}

	if (profiles.length > 0) {
		for (const [cli, prof] of profiles) {
			const env_var =
				cli === 'aws'
					? 'AWS_PROFILE'
					: cli === 'hcloud'
						? 'HCLOUD_CONTEXT'
						: `${cli.toUpperCase()}_PROFILE`;
			console.log(
				`  ${chalk.white(env_var.padEnd(25))} ${chalk.dim(`[cli profile: "${prof.profile}"]`)}`,
			);
		}
	}
}

import { read_config } from '../core/config.js';
import { info, output } from '../utils/output.js';

export function list_command(json?: boolean): void {
	const config = read_config();
	const keys = Object.keys(config.keys);
	const profiles = Object.entries(config.cli_profiles);

	const data = {
		keys: keys.map((key) => ({
			name: key,
			source: config.keys[key].source,
		})),
		cli_profiles: profiles.map(([cli, prof]) => ({
			cli,
			profile: prof.profile,
			env_var:
				cli === 'aws'
					? 'AWS_PROFILE'
					: cli === 'hcloud'
						? 'HCLOUD_CONTEXT'
						: `${cli.toUpperCase()}_PROFILE`,
		})),
	};

	if (!json) {
		if (keys.length === 0 && profiles.length === 0) {
			info('No keys or profiles stored.');
			info('Use "nopeek set <KEY>" or "nopeek load .env" first.');
			return;
		}
		for (const k of data.keys) {
			console.log(`  ${k.name.padEnd(25)} [${k.source}]`);
		}
		for (const p of data.cli_profiles) {
			console.log(
				`  ${p.env_var.padEnd(25)} [cli profile: "${p.profile}"]`,
			);
		}
		return;
	}

	output(data, true);
}

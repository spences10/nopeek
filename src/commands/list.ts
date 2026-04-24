import { read_config } from '../core/config.js';
import { info, output } from '../utils/output.js';

function cli_profile_env_var(cli: string): string {
	if (cli === 'aws') return 'AWS_PROFILE';
	if (cli === 'hcloud') return 'HCLOUD_CONTEXT';
	if (cli === 'gcloud') return 'CLOUDSDK_ACTIVE_CONFIG_NAME';
	if (cli === 'az') return 'AZURE_SUBSCRIPTION_ID';
	return `${cli.toUpperCase()}_PROFILE`;
}

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
			env_var: cli_profile_env_var(cli),
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

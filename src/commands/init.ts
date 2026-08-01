import { read_config, write_config } from '../core/config.js';
import { scan_all } from '../detectors/index.js';
import { found, info, output, success } from '../utils/output.js';

export async function init_command(json?: boolean): Promise<void> {
	if (!json) {
		info('Scanning for cloud CLIs...\n');
	}

	const results = await scan_all();

	// Profile mappings were persisted by older versions, but no command ever
	// consumed them. Keep config-file compatibility while removing that dead
	// state the next time the advisory scan runs.
	const config = read_config();
	const removed_legacy_profiles = Object.keys(
		config.cli_profiles,
	).length;
	if (removed_legacy_profiles > 0) {
		config.cli_profiles = {};
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
		advisory: true,
		removed_legacy_profiles,
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

		if (removed_legacy_profiles > 0) {
			console.error('');
			success(
				`${removed_legacy_profiles} obsolete CLI profile mapping(s) removed`,
			);
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

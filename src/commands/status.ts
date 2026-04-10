import chalk from 'chalk';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { read_config } from '../core/config.js';
import { parse_file } from '../core/env-file.js';
import { is_claude_code } from '../core/session.js';
import { scan_all } from '../detectors/index.js';
import { info, label } from '../utils/output.js';

export async function status_command(): Promise<void> {
	const config = read_config();

	// Session status
	info(
		chalk.bold('Session: ') +
			(is_claude_code()
				? chalk.green('Inside Claude Code')
				: chalk.dim('Outside Claude Code')),
	);

	// Stored keys
	const keys = Object.keys(config.keys);
	console.error('');
	info(chalk.bold(`Stored keys: ${keys.length}`));
	for (const key of keys) {
		label(`  ${key} [${config.keys[key].source}]`);
	}

	// CLI profiles
	const profiles = Object.entries(config.cli_profiles);
	console.error('');
	info(chalk.bold(`CLI profiles: ${profiles.length}`));
	for (const [cli, prof] of profiles) {
		label(`  ${cli} → ${prof.profile}`);
	}

	// Live detection
	console.error('');
	info(chalk.bold('Detected CLIs:'));
	const results = await scan_all();
	if (results.length === 0) {
		label('  None found');
	} else {
		for (const r of results) {
			const status_icon =
				r.status === 'ok'
					? chalk.green('[OK]')
					: r.status === 'migrate'
						? chalk.yellow('[MIGRATE]')
						: chalk.dim('[SKIP]');
			label(`  ${r.name} v${r.version} ${status_icon}`);
		}
	}

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

	if (env_files.length > 0) {
		console.error('');
		info(chalk.bold(`.env files in ${cwd}:`));
		for (const { name, key_count } of env_files) {
			label(
				`  ${name} (${key_count} key${key_count !== 1 ? 's' : ''})`,
			);
		}
		if (keys.length === 0) {
			label(chalk.cyan('  Tip: npx nopeek load .env'));
		}
	}
}

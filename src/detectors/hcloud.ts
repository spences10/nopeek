import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CliDetector, DetectorResult } from './types.js';

function get_version(): string | null {
	try {
		const out = execSync('hcloud version 2>&1', {
			encoding: 'utf-8',
		});
		const match = out.match(/(\d+\.\d+\.\d+)/);
		return match ? match[1] : null;
	} catch {
		return null;
	}
}

function get_active_context(): string | null {
	try {
		const out = execSync('hcloud context active 2>&1', {
			encoding: 'utf-8',
		});
		return out.trim() || null;
	} catch {
		return null;
	}
}

export const hcloud_detector: CliDetector = {
	name: 'hcloud',

	async check(): Promise<DetectorResult | null> {
		const version = get_version();
		if (!version) return null;

		// Check for inline token in env (bad)
		if (process.env.HCLOUD_TOKEN) {
			return {
				name: 'hcloud',
				version,
				status: 'migrate',
				detail: 'token inline in environment [MIGRATE]',
				env_var: 'HCLOUD_CONTEXT',
			};
		}

		// Check for config file with contexts
		const config_path = join(
			homedir(),
			'.config',
			'hcloud',
			'cli.toml',
		);

		if (!existsSync(config_path)) {
			return {
				name: 'hcloud',
				version,
				status: 'skip',
				detail: 'not authenticated [SKIP]',
			};
		}

		const context = get_active_context();
		if (context) {
			return {
				name: 'hcloud',
				version,
				status: 'ok',
				detail: `using context "${context}" [OK]`,
				env_var: 'HCLOUD_CONTEXT',
				profile: context,
			};
		}

		return {
			name: 'hcloud',
			version,
			status: 'skip',
			detail: 'config exists but no active context [SKIP]',
		};
	},
};

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CliDetector, DetectorResult } from './types.js';

function get_version(): string | null {
	try {
		const out = execSync('aws --version 2>&1', {
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'ignore'],
			timeout: 2000,
		});
		const match = out.match(/aws-cli\/(\S+)/);
		return match ? match[1] : null;
	} catch {
		return null;
	}
}

export const aws_detector: CliDetector = {
	name: 'aws',

	async check(): Promise<DetectorResult | null> {
		const version = get_version();
		if (!version) return null;

		// Check for inline env var credentials (bad)
		if (process.env.AWS_ACCESS_KEY_ID) {
			return {
				name: 'aws',
				version,
				status: 'migrate',
				detail: 'AWS_ACCESS_KEY_ID set in environment [MIGRATE]',
				env_var: 'AWS_PROFILE',
			};
		}

		// Check for credentials file with named profiles (good)
		const creds_path = join(homedir(), '.aws', 'credentials');
		const has_creds = existsSync(creds_path);

		// Check if using a named profile already
		const profile = process.env.AWS_PROFILE;
		if (profile || has_creds) {
			return {
				name: 'aws',
				version,
				status: 'ok',
				detail: `using named profile "${profile || 'default'}" [OK]`,
				env_var: 'AWS_PROFILE',
				profile: profile || 'default',
			};
		}

		return {
			name: 'aws',
			version,
			status: 'skip',
			detail: 'not authenticated [SKIP]',
		};
	},
};

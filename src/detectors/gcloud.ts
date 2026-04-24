import { execSync } from 'node:child_process';
import type { CliDetector, DetectorResult } from './types.js';

const INLINE_CREDENTIAL_ENV_VARS = [
	'CLOUDSDK_AUTH_ACCESS_TOKEN',
	'GOOGLE_OAUTH_ACCESS_TOKEN',
	'GOOGLE_API_KEY',
	'GOOGLE_APPLICATION_CREDENTIALS',
];

function get_version(): string | null {
	try {
		const out = execSync('gcloud version', {
			encoding: 'utf-8',
		});
		const match = out.match(/Google Cloud SDK\s+(\S+)/);
		return match ? match[1] : null;
	} catch {
		return null;
	}
}

function get_active_config(): string | null {
	if (process.env.CLOUDSDK_ACTIVE_CONFIG_NAME) {
		return process.env.CLOUDSDK_ACTIVE_CONFIG_NAME;
	}

	try {
		const out = execSync(
			'gcloud config configurations list --filter=is_active:true --format="value(name)"',
			{ encoding: 'utf-8' },
		);
		const config = out.trim().split('\n')[0];
		return config || null;
	} catch {
		return null;
	}
}

function get_active_account(): string | null {
	try {
		const out = execSync(
			'gcloud auth list --filter=status:ACTIVE --format="value(account)"',
			{ encoding: 'utf-8' },
		);
		const account = out.trim().split('\n')[0];
		return account || null;
	} catch {
		return null;
	}
}

export const gcloud_detector: CliDetector = {
	name: 'gcloud',

	async check(): Promise<DetectorResult | null> {
		const version = get_version();
		if (!version) return null;

		for (const env_var of INLINE_CREDENTIAL_ENV_VARS) {
			if (process.env[env_var]) {
				return {
					name: 'gcloud',
					version,
					status: 'migrate',
					detail: `${env_var} set in environment [MIGRATE]`,
					env_var: 'CLOUDSDK_ACTIVE_CONFIG_NAME',
				};
			}
		}

		const account = get_active_account();
		if (!account) {
			return {
				name: 'gcloud',
				version,
				status: 'skip',
				detail: 'not authenticated [SKIP]',
			};
		}

		const config = get_active_config() || 'default';
		return {
			name: 'gcloud',
			version,
			status: 'ok',
			detail: `using configuration "${config}" [OK]`,
			env_var: 'CLOUDSDK_ACTIVE_CONFIG_NAME',
			profile: config,
		};
	},
};

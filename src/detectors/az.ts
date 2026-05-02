import { execSync } from 'node:child_process';
import type { CliDetector, DetectorResult } from './types.js';

const INLINE_CREDENTIAL_ENV_VARS = [
	'ARM_ACCESS_KEY',
	'ARM_CLIENT_SECRET',
	'AZURE_ACCESS_TOKEN',
	'AZURE_CLIENT_SECRET',
	'AZURE_PASSWORD',
	'AZURE_STORAGE_KEY',
];

interface AzureAccount {
	id?: string;
	name?: string;
	user?: {
		name?: string;
	};
}

function get_version(): string | null {
	try {
		const out = execSync('az version --output json', {
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'ignore'],
			timeout: 2000,
		});
		const parsed = JSON.parse(out) as { 'azure-cli'?: string };
		return parsed['azure-cli'] || null;
	} catch {
		return null;
	}
}

function get_active_account(): AzureAccount | null {
	try {
		const out = execSync('az account show --output json', {
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'ignore'],
			timeout: 2000,
		});
		return JSON.parse(out) as AzureAccount;
	} catch {
		return null;
	}
}

export const az_detector: CliDetector = {
	name: 'az',

	async check(): Promise<DetectorResult | null> {
		const version = get_version();
		if (!version) return null;

		for (const env_var of INLINE_CREDENTIAL_ENV_VARS) {
			if (process.env[env_var]) {
				return {
					name: 'az',
					version,
					status: 'migrate',
					detail: `${env_var} set in environment [MIGRATE]`,
					env_var: 'AZURE_SUBSCRIPTION_ID',
				};
			}
		}

		const account = get_active_account();
		if (!account?.id) {
			return {
				name: 'az',
				version,
				status: 'skip',
				detail: 'not authenticated [SKIP]',
			};
		}

		const subscription = account.name || account.id;
		return {
			name: 'az',
			version,
			status: 'ok',
			detail: `using subscription "${subscription}" [OK]`,
			env_var: 'AZURE_SUBSCRIPTION_ID',
			profile: account.id,
		};
	},
};

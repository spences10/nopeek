import { existsSync, readFileSync } from 'node:fs';
import { write_secure } from '../utils/fs.js';
import { config_path } from '../utils/paths.js';

export interface StoredKey {
	value: string;
	source: 'set' | 'load';
}

export interface CliProfile {
	profile: string;
}

export interface NopeekConfig {
	keys: Record<string, StoredKey>;
	cli_profiles: Record<string, CliProfile>;
}

function empty_config(): NopeekConfig {
	return { keys: {}, cli_profiles: {} };
}

export function read_config(): NopeekConfig {
	const path = config_path();
	if (!existsSync(path)) return empty_config();
	try {
		const raw = readFileSync(path, 'utf-8');
		return { ...empty_config(), ...JSON.parse(raw) };
	} catch {
		return empty_config();
	}
}

export function write_config(config: NopeekConfig): void {
	write_secure(config_path(), JSON.stringify(config, null, '\t'));
}

import { homedir } from 'node:os';
import { join } from 'node:path';

export function config_dir(): string {
	const xdg = process.env.XDG_CONFIG_HOME;
	return xdg
		? join(xdg, 'nopeek')
		: join(homedir(), '.config', 'nopeek');
}

export function config_path(): string {
	return join(config_dir(), 'config.json');
}

export function backups_dir(): string {
	return join(config_dir(), 'backups');
}

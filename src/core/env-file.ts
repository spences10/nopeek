import { readFileSync } from 'node:fs';

export interface EnvEntry {
	key: string;
	value: string;
}

export function parse_env_file(path: string): EnvEntry[] {
	const content = readFileSync(path, 'utf-8');
	const entries: EnvEntry[] = [];

	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;

		const eq = trimmed.indexOf('=');
		if (eq === -1) continue;

		const key = trimmed.slice(0, eq).trim();
		let value = trimmed.slice(eq + 1).trim();

		// Strip surrounding quotes
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}

		if (key) entries.push({ key, value });
	}

	return entries;
}

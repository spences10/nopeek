import { readFileSync } from 'node:fs';
import type { EnvEntry } from './env-file.js';

/**
 * Parse HCL-format .tfvars files.
 * Extracts top-level scalar string assignments only.
 * Skips maps, lists, objects, numbers, and bools.
 */
export function parse_tfvars_file(path: string): EnvEntry[] {
	const content = readFileSync(path, 'utf-8');
	const entries: EnvEntry[] = [];
	let i = 0;
	const lines = content.split('\n');

	while (i < lines.length) {
		const line = lines[i].trim();
		i++;

		// Skip empty lines and comments
		if (!line || line.startsWith('#') || line.startsWith('//')) {
			continue;
		}

		const eq = line.indexOf('=');
		if (eq === -1) continue;

		const key = line.slice(0, eq).trim();
		const rest = line.slice(eq + 1).trim();

		// Skip map/object/list openers
		if (rest.startsWith('{') || rest.startsWith('[')) {
			// Fast-forward past the block
			let depth = 0;
			for (const ch of rest) {
				if (ch === '{' || ch === '[') depth++;
				if (ch === '}' || ch === ']') depth--;
			}
			while (depth > 0 && i < lines.length) {
				for (const ch of lines[i]) {
					if (ch === '{' || ch === '[') depth++;
					if (ch === '}' || ch === ']') depth--;
				}
				i++;
			}
			continue;
		}

		// Only extract quoted string values
		let value: string | null = null;
		if (rest.startsWith('"')) {
			const end = rest.indexOf('"', 1);
			if (end !== -1) {
				value = rest.slice(1, end);
			}
		}

		if (key && value !== null) {
			entries.push({ key, value });
		}
	}

	return entries;
}

/**
 * Parse JSON-format .tfvars.json files.
 * Extracts top-level string values only.
 */
export function parse_tfvars_json_file(path: string): EnvEntry[] {
	const content = readFileSync(path, 'utf-8');
	const data = JSON.parse(content);
	const entries: EnvEntry[] = [];

	for (const [key, value] of Object.entries(data)) {
		if (typeof value === 'string') {
			entries.push({ key, value });
		}
	}

	return entries;
}

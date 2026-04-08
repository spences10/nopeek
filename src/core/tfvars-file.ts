import { readFileSync } from 'node:fs';
import type { EnvEntry } from './env-file.js';

/**
 * Parse HCL-format .tfvars files.
 * Extracts scalar string assignments from top-level and nested maps.
 * Inner map keys are extracted directly (not dot-prefixed).
 * Skips lists, numbers, and bools.
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

		// Skip list blocks
		if (rest.startsWith('[')) {
			let depth = 0;
			for (const ch of rest) {
				if (ch === '[') depth++;
				if (ch === ']') depth--;
			}
			while (depth > 0 && i < lines.length) {
				for (const ch of lines[i]) {
					if (ch === '[') depth++;
					if (ch === ']') depth--;
				}
				i++;
			}
			continue;
		}

		// Recurse into map/object blocks, extracting inner string values
		if (rest.startsWith('{')) {
			let depth = 0;
			for (const ch of rest) {
				if (ch === '{') depth++;
				if (ch === '}') depth--;
			}
			while (depth > 0 && i < lines.length) {
				const inner = lines[i].trim();
				i++;
				for (const ch of inner) {
					if (ch === '{') depth++;
					if (ch === '}') depth--;
				}
				// Skip empty lines, comments, and closing braces
				if (
					!inner ||
					inner.startsWith('#') ||
					inner.startsWith('//') ||
					inner === '}'
				) {
					continue;
				}
				const innerEq = inner.indexOf('=');
				if (innerEq === -1) continue;
				const innerKey = inner.slice(0, innerEq).trim();
				const innerRest = inner.slice(innerEq + 1).trim();
				if (innerRest.startsWith('"')) {
					const end = innerRest.indexOf('"', 1);
					if (end !== -1) {
						entries.push({
							key: innerKey,
							value: innerRest.slice(1, end),
						});
					}
				}
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
 * Extracts string values from top-level and nested objects.
 * Inner object keys are extracted directly (not dot-prefixed).
 */
export function parse_tfvars_json_file(path: string): EnvEntry[] {
	const content = readFileSync(path, 'utf-8');
	const data = JSON.parse(content);
	const entries: EnvEntry[] = [];

	function extract(obj: Record<string, unknown>) {
		for (const [key, value] of Object.entries(obj)) {
			if (typeof value === 'string') {
				entries.push({ key, value });
			} else if (
				typeof value === 'object' &&
				value !== null &&
				!Array.isArray(value)
			) {
				extract(value as Record<string, unknown>);
			}
		}
	}

	extract(data);
	return entries;
}

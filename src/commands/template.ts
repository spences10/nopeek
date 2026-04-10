import { existsSync, readFileSync } from 'node:fs';
import { read_config } from '../core/config.js';
import { write_secure } from '../utils/fs.js';
import { error, info, success, warning } from '../utils/output.js';

const PLACEHOLDER_RE = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;

function resolve_value(key: string): string | undefined {
	const env_val = process.env[key];
	if (env_val) return env_val;

	const config = read_config();
	return config.keys[key]?.value;
}

export function template_command(
	input: string,
	output: string,
): void {
	if (!existsSync(input)) {
		error(`File not found: ${input}`);
		process.exit(1);
	}

	const content = readFileSync(input, 'utf-8');

	// Find all placeholder keys
	const keys = new Set<string>();
	for (const match of content.matchAll(PLACEHOLDER_RE)) {
		keys.add(match[1]);
	}

	if (keys.size === 0) {
		warning(`No {{KEY}} placeholders found in ${input}`);
		process.exit(1);
	}

	// Resolve all keys, track missing
	const resolved = new Map<string, string>();
	const missing: string[] = [];

	for (const key of keys) {
		const value = resolve_value(key);
		if (value === undefined) {
			missing.push(key);
		} else {
			resolved.set(key, value);
		}
	}

	if (missing.length > 0) {
		error(`Missing keys: ${missing.join(', ')}`);
		info(
			'  Load them first with: npx nopeek load .env or npx nopeek set <KEY>',
		);
		process.exit(1);
	}

	// Replace placeholders
	const result = content.replace(PLACEHOLDER_RE, (_, key: string) => {
		return resolved.get(key)!;
	});

	// Write output securely (0600 permissions)
	write_secure(output, result);

	info(`Resolved ${resolved.size} key(s) in ${input}:`);
	for (const key of keys) {
		info(`  ${key}`);
	}
	success(`Written to ${output}`);
}

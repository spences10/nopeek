import { existsSync, readFileSync } from 'node:fs';
import { read_config } from '../core/config.js';
import { write_secure } from '../utils/fs.js';
import {
	fail,
	info,
	output,
	success,
	warning,
} from '../utils/output.js';

const PLACEHOLDER_RE = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;

function resolve_value(key: string): string | undefined {
	if (Object.hasOwn(process.env, key)) return process.env[key];

	const config = read_config();
	return config.keys[key]?.value;
}

export function template_command(
	input: string,
	output_path: string,
	json?: boolean,
): void {
	if (!existsSync(input)) {
		fail(`File not found: ${input}`, json);
	}

	const content = readFileSync(input, 'utf-8');

	// Find all placeholder keys
	const keys = new Set<string>();
	for (const match of content.matchAll(PLACEHOLDER_RE)) {
		keys.add(match[1]);
	}

	if (keys.size === 0) {
		if (!json) {
			warning(`No {{KEY}} placeholders found in ${input}`);
			process.exit(1);
		}
		fail(`No {{KEY}} placeholders found in ${input}`, json);
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
		if (!json) {
			info(
				'  Load them first with: npx nopeek load .env or npx nopeek set <KEY>',
			);
		}
		fail(`Missing keys: ${missing.join(', ')}`, json, {
			missing_keys: missing,
		});
	}

	// Replace placeholders
	const result = content.replace(PLACEHOLDER_RE, (_, key: string) => {
		return resolved.get(key)!;
	});

	// Write output securely (0600 permissions)
	write_secure(output_path, result);

	if (!json) {
		info(`Resolved ${resolved.size} key(s) in ${input}:`);
		for (const key of keys) {
			info(`  ${key}`);
		}
		success(`Written to ${output_path}`);
		return;
	}

	output(
		{ success: true, keys: [...keys], input, output: output_path },
		true,
	);
}

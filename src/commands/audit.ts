import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { detect_secrets } from '../core/redaction.js';
import {
	fail,
	info,
	output,
	success,
	warning,
} from '../utils/output.js';

const TARGET_PATTERNS = [
	'.env',
	'.env.local',
	'.env.development',
	'.env.production',
	'.env.staging',
	'.env.test',
];

export function audit_command(dir: string, json?: boolean): void {
	if (!json) {
		info('Scanning for .env files...\n');
	}

	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		fail(`Cannot read directory: ${dir}`, json);
	}

	const env_files = entries.filter(
		(f) => TARGET_PATTERNS.includes(f) || f.match(/^\.env\..+$/),
	);

	if (env_files.length === 0) {
		if (!json) {
			info('No .env files found.');
			return;
		}
		output(
			{ files: [], total_secrets: 0, missing_gitignore: [] },
			true,
		);
		return;
	}

	// Check .gitignore
	const gitignore_path = join(dir, '.gitignore');
	const gitignore_content = existsSync(gitignore_path)
		? readFileSync(gitignore_path, 'utf-8')
		: '';

	let total_secrets = 0;
	const missing_gitignore: string[] = [];
	const file_results: {
		file: string;
		secrets_found: number;
		patterns: string[];
		in_gitignore: boolean;
	}[] = [];

	for (const file of env_files) {
		const path = join(dir, file);
		const content = readFileSync(path, 'utf-8');
		const hits = detect_secrets(content);

		const seen = new Set<string>();
		for (const hit of hits) {
			seen.add(hit.pattern.name);
		}

		const in_gitignore =
			file === '.env.example' ||
			gitignore_content.includes(file) ||
			gitignore_content.includes('.env*') ||
			gitignore_content.includes('.env');

		if (!in_gitignore && file !== '.env.example') {
			missing_gitignore.push(file);
		}

		total_secrets += hits.length;
		file_results.push({
			file,
			secrets_found: hits.length,
			patterns: [...seen],
			in_gitignore,
		});
	}

	if (!json) {
		for (const f of file_results) {
			if (f.secrets_found === 0) {
				info(`${f.file} — clean`);
			} else {
				info(`${f.file} — ${f.secrets_found} secret(s) found:`);
				for (const pattern of f.patterns) {
					info(`    ${pattern}`);
				}
			}
		}

		console.error('');
		if (total_secrets === 0) {
			success('No secrets detected.');
		} else {
			warning(
				`${total_secrets} secret(s) found across ${env_files.length} file(s).`,
			);
		}

		if (missing_gitignore.length > 0) {
			console.error('');
			warning(
				`Ensure these files are in .gitignore: ${missing_gitignore.join(', ')}`,
			);
		}
		return;
	}

	output(
		{ files: file_results, total_secrets, missing_gitignore },
		true,
	);
}

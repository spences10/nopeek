import chalk from 'chalk';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { detect_secrets } from '../core/redaction.js';
import { error, info, success, warning } from '../utils/output.js';

const TARGET_PATTERNS = [
	'.env',
	'.env.local',
	'.env.development',
	'.env.production',
	'.env.staging',
	'.env.test',
];

export function audit_command(dir: string): void {
	info('Scanning for .env files...\n');

	let files_found = 0;
	let total_secrets = 0;
	const missing_gitignore: string[] = [];

	// Check for .env files
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		error(`Cannot read directory: ${dir}`);
		process.exit(1);
	}

	const env_files = entries.filter(
		(f) => TARGET_PATTERNS.includes(f) || f.match(/^\.env\..+$/),
	);

	if (env_files.length === 0) {
		info('No .env files found.');
		return;
	}

	// Check .gitignore
	const gitignore_path = join(dir, '.gitignore');
	const gitignore_content = existsSync(gitignore_path)
		? readFileSync(gitignore_path, 'utf-8')
		: '';

	for (const file of env_files) {
		const path = join(dir, file);
		const content = readFileSync(path, 'utf-8');
		const hits = detect_secrets(content);
		files_found++;

		if (hits.length === 0) {
			info(`${chalk.white(file)} — ${chalk.green('clean')}`);
			continue;
		}

		total_secrets += hits.length;
		info(
			`${chalk.white(file)} — ${chalk.yellow(`${hits.length} secret(s) found:`)}`,
		);

		// Deduplicate by pattern name
		const seen = new Set<string>();
		for (const hit of hits) {
			if (seen.has(hit.pattern.name)) continue;
			seen.add(hit.pattern.name);
			info(`    ${hit.pattern.name}`);
		}

		// Check gitignore coverage
		if (
			file !== '.env.example' &&
			!gitignore_content.includes(file) &&
			!gitignore_content.includes('.env*') &&
			!gitignore_content.includes('.env')
		) {
			missing_gitignore.push(file);
		}
	}

	console.error('');
	if (total_secrets === 0) {
		success('No secrets detected.');
	} else {
		warning(
			`${total_secrets} secret(s) found across ${files_found} file(s).`,
		);
	}

	if (missing_gitignore.length > 0) {
		console.error('');
		warning(
			`Ensure these files are in .gitignore: ${missing_gitignore.join(', ')}`,
		);
	}
}

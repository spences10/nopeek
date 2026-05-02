import {
	existsSync,
	readFileSync,
	readdirSync,
	type Dirent,
} from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { detect_secrets } from '../core/redaction.js';
import {
	fail,
	info,
	output,
	success,
	warning,
} from '../utils/output.js';

const SKIP_DIRS = new Set([
	'.git',
	'.hg',
	'.svn',
	'node_modules',
	'dist',
	'build',
	'.next',
	'.svelte-kit',
]);

export function audit_command(dir: string, json?: boolean): void {
	if (!json) {
		info('Scanning for .env files...\n');
	}

	if (!existsSync(dir)) {
		fail(`Cannot read directory: ${dir}`, json);
	}

	const env_files = find_env_files(dir);

	if (env_files.length === 0) {
		const clean = {
			success: true,
			files: [],
			total_secrets: 0,
			missing_gitignore: [],
		};
		if (!json) {
			info('No .env files found.');
			return;
		}
		output(clean, true);
		return;
	}

	const gitignore_patterns = read_gitignore_patterns(dir);
	let total_secrets = 0;
	const missing_gitignore: string[] = [];
	const file_results: {
		file: string;
		secrets_found: number;
		patterns: string[];
		in_gitignore: boolean;
	}[] = [];

	for (const path of env_files) {
		const rel = to_posix(relative(dir, path));
		const content = readFileSync(path, 'utf-8');
		const hits = detect_secrets(content);
		const patterns = [
			...new Set(hits.map((hit) => hit.pattern.name)),
		];
		const in_gitignore =
			basename(rel) === '.env.example' ||
			is_ignored_by_patterns(rel, gitignore_patterns);

		if (!in_gitignore && basename(rel) !== '.env.example') {
			missing_gitignore.push(rel);
		}

		total_secrets += hits.length;
		file_results.push({
			file: rel,
			secrets_found: hits.length,
			patterns,
			in_gitignore,
		});
	}

	const success_state =
		total_secrets === 0 && missing_gitignore.length === 0;
	const result = {
		success: success_state,
		files: file_results,
		total_secrets,
		missing_gitignore,
	};

	if (json) {
		output(result, true);
		if (!success_state) process.exit(1);
		return;
	}

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

	if (!success_state) process.exit(1);
}

function find_env_files(root: string): string[] {
	const found: string[] = [];
	walk(root, found);
	return found.sort();
}

function walk(dir: string, found: string[]): void {
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}

	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name)) walk(path, found);
			continue;
		}
		if (entry.isFile() && is_env_filename(entry.name)) {
			found.push(path);
		}
	}
}

function is_env_filename(name: string): boolean {
	return name === '.env' || name.startsWith('.env.');
}

function read_gitignore_patterns(dir: string): string[] {
	const gitignore_path = join(dir, '.gitignore');
	if (!existsSync(gitignore_path)) return [];
	return readFileSync(gitignore_path, 'utf-8')
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(
			(line) =>
				line && !line.startsWith('#') && !line.startsWith('!'),
		);
}

function is_ignored_by_patterns(
	relative_path: string,
	patterns: string[],
): boolean {
	const file = basename(relative_path);
	return patterns.some((pattern) => {
		const normalized = to_posix(pattern.replace(/^\//, ''));
		if (normalized.endsWith('/')) return false;
		if (!normalized.includes('/')) {
			return wildcard_match(file, normalized);
		}
		return wildcard_match(relative_path, normalized);
	});
}

function wildcard_match(value: string, pattern: string): boolean {
	const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
	const regex = new RegExp(`^${escaped.replace(/\*/g, '.*')}$`);
	return regex.test(value);
}

function to_posix(path: string): string {
	return path.split(sep).join('/');
}

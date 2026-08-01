import { spawnSync } from 'node:child_process';
import {
	closeSync,
	constants,
	existsSync,
	fstatSync,
	lstatSync,
	openSync,
	readSync,
	readdirSync,
	statSync,
	type Dirent,
} from 'node:fs';
import {
	basename,
	dirname,
	join,
	relative,
	resolve,
	sep,
} from 'node:path';
import { parse_content } from '../core/env-file.js';
import { detect_secrets } from '../core/redaction.js';
import {
	fail,
	info,
	output,
	success,
	warning,
} from '../utils/output.js';

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILES = 1000;
const MAX_DEPTH = 32;
const MAX_DIRECTORIES = 10_000;
const GIT_MAX_BUFFER = 4 * 1024 * 1024;
const GIT_PATH_BATCH = 200;

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

type GitState = 'tracked' | 'untracked' | 'ignored' | 'unknown';
type FileFormat = 'dotenv' | 'tfvars' | 'tfvars.json';

type GitResult = {
	status: number | null;
	stdout: string;
	error_code?: string;
};

type GitRunner = (
	dir: string,
	args: string[],
	input?: string,
) => GitResult;

export interface AuditOptions {
	git_runner?: GitRunner;
}

interface FileResult {
	file: string;
	format: FileFormat;
	status: 'scanned' | 'error' | 'skipped';
	git_state: GitState;
	in_gitignore: boolean;
	secrets_found: number;
	patterns: string[];
	example: boolean;
	example_assessment?: 'placeholder' | 'live-looking' | 'empty';
	error?: string;
	skipped_reason?: string;
}

interface SkippedPath {
	path: string;
	reason: string;
}

interface Discovery {
	files: string[];
	skipped: SkippedPath[];
	directories_seen: number;
}

interface GitContext {
	available: boolean;
	repository: boolean;
	status: 'repository' | 'not_repository' | 'unavailable' | 'error';
	states: Map<string, GitState>;
}

export type CandidateRead =
	| { content: string }
	| { error: string }
	| { skipped_reason: string };

export interface CandidateIo {
	open(path: string): number;
	stat(fd: number): { isFile(): boolean; size: number };
	read(
		fd: number,
		buffer: Buffer,
		offset: number,
		length: number,
	): number;
	close(fd: number): void;
}

export function audit_command(
	dir: string,
	json?: boolean,
	options: AuditOptions = {},
): void {
	if (!json) {
		info(
			'Scanning supported secret-source files (heuristic, bounded)...\n',
		);
	}

	if (!existsSync(dir)) fail(`Cannot read directory: ${dir}`, json);
	let root;
	try {
		root = lstatSync(dir);
	} catch {
		fail(`Cannot read directory: ${dir}`, json);
	}
	if (!root.isDirectory() || root.isSymbolicLink())
		fail(`Cannot read directory: ${dir}`, json);

	const discovery = discover_source_files(dir);
	const relative_files = discovery.files.map((path) =>
		to_posix(relative(dir, path)),
	);
	const git_context = classify_git_states(
		dir,
		relative_files,
		options.git_runner ?? run_git,
	);
	const file_results: FileResult[] = [];
	const missing_gitignore: string[] = [];
	let total_secrets = 0;

	for (const [index, path] of discovery.files.entries()) {
		const rel = relative_files[index];
		const format = format_for(path);
		const git_state = git_context.states.get(rel) ?? 'unknown';
		const example = is_example_filename(basename(rel));
		const base = {
			file: rel,
			format,
			git_state,
			in_gitignore: git_state === 'ignored',
			example,
		};

		const read = read_candidate(path);
		if ('error' in read || 'skipped_reason' in read) {
			file_results.push({
				...base,
				status: 'skipped_reason' in read ? 'skipped' : 'error',
				secrets_found: 0,
				patterns: [],
				...read,
			});
			continue;
		}
		const { content } = read;
		if (content.includes('\0')) {
			file_results.push({
				...base,
				status: 'error',
				secrets_found: 0,
				patterns: [],
				error: 'binary NUL byte is unsupported',
			});
			continue;
		}

		let entries;
		try {
			entries = parse_content(path, content);
		} catch (error) {
			file_results.push({
				...base,
				status: 'error',
				secrets_found: 0,
				patterns: [],
				error: safe_parse_error(error, format),
			});
			continue;
		}

		const assessment = example
			? assess_example(entries.map(({ value }) => value))
			: undefined;
		const detector_content =
			example && assessment !== 'live-looking'
				? without_placeholder_assignments(content)
				: content;
		const hits = detect_secrets(detector_content);
		const patterns = [
			...new Set(hits.map((hit) => hit.pattern.name)),
		];
		total_secrets += hits.length;
		file_results.push({
			...base,
			status: 'scanned',
			secrets_found: hits.length,
			patterns,
			example_assessment: assessment,
		});

		if (
			git_state !== 'ignored' &&
			!(example && assessment !== 'live-looking')
		)
			missing_gitignore.push(rel);
	}

	const incomplete_files = file_results.filter(
		(file) => file.status !== 'scanned',
	).length;
	const success_state =
		total_secrets === 0 &&
		missing_gitignore.length === 0 &&
		incomplete_files === 0 &&
		discovery.skipped.length === 0 &&
		git_context.status !== 'error' &&
		git_context.status !== 'unavailable';
	const result = {
		success: success_state,
		heuristic: true,
		bounded: true,
		limits: {
			max_file_bytes: MAX_FILE_BYTES,
			max_files: MAX_FILES,
			max_depth: MAX_DEPTH,
			max_directories: MAX_DIRECTORIES,
		},
		git_available: git_context.available,
		git_status: git_context.status,
		repository: git_context.repository,
		files: file_results,
		skipped_paths: discovery.skipped,
		scanned_files: file_results.length - incomplete_files,
		incomplete_files,
		total_secrets,
		missing_gitignore,
	};

	if (json) {
		output(result, true);
		if (!success_state) process.exit(1);
		return;
	}

	for (const file of file_results) report_file(file);
	for (const skipped of discovery.skipped)
		warning(`${skipped.path} — skipped: ${skipped.reason}`);

	console.error('');
	if (total_secrets === 0)
		success('No secrets detected by the bounded heuristic scan.');
	else
		warning(
			`${total_secrets} secret(s) found across ${file_results.length} candidate file(s).`,
		);
	if (missing_gitignore.length > 0)
		warning(
			`Secret-source files are not ignored (tracked files must also be removed from Git): ${missing_gitignore.join(', ')}`,
		);
	if (git_context.status === 'unavailable')
		warning('Git is unavailable; source classification is unknown.');
	else if (git_context.status === 'error')
		warning(
			'Git classification failed; source classification is unknown.',
		);
	else if (git_context.status === 'not_repository')
		warning('The scan root is not inside a Git repository.');
	if (incomplete_files > 0 || discovery.skipped.length > 0)
		warning(
			'The bounded scan was incomplete; inspect skipped/error records.',
		);
	if (!success_state) process.exit(1);
}

export function read_candidate(
	path: string,
	io: CandidateIo = {
		open: (candidate) =>
			openSync(candidate, constants.O_RDONLY | constants.O_NOFOLLOW),
		stat: fstatSync,
		read: (fd, buffer, offset, length) =>
			readSync(fd, buffer, offset, length, null),
		close: closeSync,
	},
): CandidateRead {
	let fd: number | undefined;
	let outcome: CandidateRead = {
		error: 'file cannot be opened safely',
	};
	try {
		fd = io.open(path);
		const stat = io.stat(fd);
		if (!stat.isFile()) return { error: 'not a regular file' };
		if (stat.size > MAX_FILE_BYTES) {
			return {
				skipped_reason: `file exceeds ${MAX_FILE_BYTES} byte limit`,
			};
		}
		const buffer = Buffer.allocUnsafe(MAX_FILE_BYTES + 1);
		let bytes_read = 0;
		while (bytes_read < buffer.length) {
			const count = io.read(
				fd,
				buffer,
				bytes_read,
				buffer.length - bytes_read,
			);
			if (count === 0) break;
			bytes_read += count;
		}
		if (bytes_read > MAX_FILE_BYTES) {
			return {
				skipped_reason: `file exceeds ${MAX_FILE_BYTES} byte limit`,
			};
		}
		outcome = { content: buffer.toString('utf-8', 0, bytes_read) };
	} catch {
		outcome = { error: 'file cannot be opened safely' };
	} finally {
		if (fd !== undefined) {
			try {
				io.close(fd);
			} catch {
				if ('content' in outcome)
					outcome = { error: 'file cannot be closed safely' };
			}
		}
	}
	return outcome;
}

function report_file(file: FileResult): void {
	const qualifiers: string[] = [file.git_state];
	if (file.example_assessment)
		qualifiers.push(`example:${file.example_assessment}`);
	if (file.status === 'error') {
		warning(`${file.file} — error: ${file.error}`);
		return;
	}
	if (file.status === 'skipped') {
		warning(`${file.file} — skipped: ${file.skipped_reason}`);
		return;
	}
	if (file.secrets_found === 0) {
		info(`${file.file} — clean (${qualifiers.join(', ')})`);
		return;
	}
	info(
		`${file.file} — ${file.secrets_found} secret(s) found (${qualifiers.join(', ')}):`,
	);
	for (const pattern of file.patterns) info(`    ${pattern}`);
}

function discover_source_files(root: string): Discovery {
	const discovery: Discovery = {
		files: [],
		skipped: [],
		directories_seen: 0,
	};
	walk(root, root, 0, discovery);
	discovery.files.sort();
	discovery.skipped.sort((a, b) => a.path.localeCompare(b.path));
	return discovery;
}

function walk(
	root: string,
	dir: string,
	depth: number,
	discovery: Discovery,
): void {
	if (depth > MAX_DEPTH) {
		discovery.skipped.push({
			path: to_posix(relative(root, dir)),
			reason: `directory exceeds depth limit ${MAX_DEPTH}`,
		});
		return;
	}
	if (++discovery.directories_seen > MAX_DIRECTORIES) {
		discovery.skipped.push({
			path: to_posix(relative(root, dir)),
			reason: `directory count exceeds limit ${MAX_DIRECTORIES}`,
		});
		return;
	}
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		discovery.skipped.push({
			path: to_posix(relative(root, dir)) || '.',
			reason: 'directory cannot be read',
		});
		return;
	}
	for (const entry of entries) {
		const path = join(dir, entry.name);
		const rel = to_posix(relative(root, path));
		if (entry.isSymbolicLink()) {
			let points_to_directory = false;
			try {
				points_to_directory = statSync(path).isDirectory();
			} catch {
				// Broken links are relevant only when named as candidates.
			}
			if (is_source_filename(entry.name) || points_to_directory)
				discovery.skipped.push({
					path: rel,
					reason: 'symbolic link is not followed',
				});
			continue;
		}
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name))
				walk(root, path, depth + 1, discovery);
			continue;
		}
		if (!entry.isFile() || !is_source_filename(entry.name)) continue;
		if (discovery.files.length >= MAX_FILES) {
			discovery.skipped.push({
				path: rel,
				reason: `candidate count exceeds limit ${MAX_FILES}`,
			});
			continue;
		}
		discovery.files.push(path);
	}
}

function is_source_filename(name: string): boolean {
	return (
		name === '.env' ||
		name.startsWith('.env.') ||
		name.endsWith('.tfvars') ||
		name.endsWith('.tfvars.json')
	);
}

function format_for(path: string): FileFormat {
	if (path.endsWith('.tfvars.json')) return 'tfvars.json';
	if (path.endsWith('.tfvars')) return 'tfvars';
	return 'dotenv';
}

function is_example_filename(name: string): boolean {
	const parts = name.toLowerCase().split('.');
	return ['example', 'sample', 'template'].some((part) =>
		parts.includes(part),
	);
}

function assess_example(
	values: string[],
): 'placeholder' | 'live-looking' | 'empty' {
	if (values.every((value) => !value)) return 'empty';
	return values.every(is_placeholder_value)
		? 'placeholder'
		: 'live-looking';
}

function is_placeholder_value(value: string): boolean {
	return /^(?:replace[-_ ]?me|change[-_ ]?me|your[-_a-z0-9]*here|example|sample|dummy|placeholder|x{3,}|<[^>]+>|\$\{[^}]+\})$/i.test(
		value.trim(),
	);
}

function without_placeholder_assignments(content: string): string {
	return content
		.split(/(?<=\n)/)
		.map((line) =>
			/(?:=|:)\s*["']?(?:replace[-_ ]?me|change[-_ ]?me|your[-_a-z0-9]*here|example|sample|dummy|placeholder|x{3,}|<[^>]+>|\$\{[^}]+\})["']?\s*[,#]?\s*$/i.test(
				line.trimEnd(),
			)
				? '\n'
				: line,
		)
		.join('');
}

function safe_parse_error(
	error: unknown,
	format: FileFormat,
): string {
	const message = error instanceof Error ? error.message : '';
	const safe =
		/^(Invalid (?:dotenv|tfvars(?:\.json)?) at line \d+:[^\r\n]*)$/.exec(
			message,
		)?.[1];
	return safe ?? `invalid ${format} syntax`;
}

function classify_git_states(
	dir: string,
	paths: string[],
	runner: GitRunner,
): GitContext {
	const states = new Map(
		paths.map((path) => [path, 'unknown' as GitState]),
	);
	const probe = runner(dir, ['rev-parse', '--is-inside-work-tree']);
	const available = probe.error_code === undefined;
	if (!available) {
		return {
			available: false,
			repository: false,
			status: 'unavailable',
			states,
		};
	}
	if (probe.status !== 0) {
		return {
			available: true,
			repository: false,
			status:
				probe.status === 128 && !has_git_marker(dir)
					? 'not_repository'
					: 'error',
			states,
		};
	}
	const repository = probe.stdout.trim() === 'true';
	if (!repository) {
		return {
			available: true,
			repository: false,
			status: 'not_repository',
			states,
		};
	}

	const tracked = new Set<string>();
	for (let index = 0; index < paths.length; index += GIT_PATH_BATCH) {
		const batch = paths.slice(index, index + GIT_PATH_BATCH);
		const result = runner(dir, ['ls-files', '-z', '--', ...batch]);
		if (result.status !== 0)
			return {
				available,
				repository,
				status: 'error',
				states,
			};
		for (const path of split_nul(result.stdout)) tracked.add(path);
	}
	for (const path of tracked) states.set(path, 'tracked');

	const candidates = paths.filter((path) => !tracked.has(path));
	if (candidates.length > 0) {
		const ignored = runner(
			dir,
			['check-ignore', '-z', '--stdin'],
			`${candidates.join('\0')}\0`,
		);
		if (ignored.status !== 0 && ignored.status !== 1)
			return {
				available,
				repository,
				status: 'error',
				states,
			};
		const ignored_paths = new Set(split_nul(ignored.stdout));
		for (const path of candidates)
			states.set(
				path,
				ignored_paths.has(path) ? 'ignored' : 'untracked',
			);
	}
	return { available, repository, status: 'repository', states };
}

function has_git_marker(start: string): boolean {
	let current = resolve(start);
	while (true) {
		if (existsSync(join(current, '.git'))) return true;
		const parent = dirname(current);
		if (parent === current) return false;
		current = parent;
	}
}

function split_nul(value: string): string[] {
	return value.split('\0').filter(Boolean);
}

function run_git(
	dir: string,
	args: string[],
	input?: string,
): GitResult {
	const result = spawnSync('git', ['-C', dir, ...args], {
		encoding: 'utf-8',
		input,
		stdio: [
			input === undefined ? 'ignore' : 'pipe',
			'pipe',
			'ignore',
		],
		shell: false,
		maxBuffer: GIT_MAX_BUFFER,
	});
	return {
		status: result.status,
		stdout: String(result.stdout ?? ''),
		error_code: (result.error as NodeJS.ErrnoException | undefined)
			?.code,
	};
}

function to_posix(path: string): string {
	return path.split(sep).join('/');
}

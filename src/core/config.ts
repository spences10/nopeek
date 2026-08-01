import {
	closeSync,
	constants,
	fchmodSync,
	fstatSync,
	mkdirSync,
	openSync,
	readFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { write_secure } from '../utils/fs.js';
import { config_path } from '../utils/paths.js';

export interface StoredKey {
	value: string;
	source: 'set' | 'load';
}

export interface CliProfile {
	profile: string;
}

export interface NopeekConfig {
	keys: Record<string, StoredKey>;
	cli_profiles: Record<string, CliProfile>;
}

function empty_config(): NopeekConfig {
	return { keys: {}, cli_profiles: {} };
}

export interface ConfigReadOptions {
	close_file?: (fd: number) => void;
}

export function read_config(
	options: ConfigReadOptions = {},
): NopeekConfig {
	const path = config_path();
	const close_file = options.close_file ?? closeSync;
	if (!ensure_config_dir(dirname(path), false, close_file))
		return empty_config();
	const fd = open_config_file(path, close_file);
	if (fd === undefined) return empty_config();

	let raw: string;
	try {
		raw = readFileSync(fd, 'utf-8');
	} catch (error) {
		try {
			close_file(fd);
		} catch {
			// Preserve the actionable read failure.
		}
		throw config_error(path, `cannot be read (${error_code(error)})`);
	}
	try {
		close_file(fd);
	} catch (error) {
		throw config_error(
			path,
			`cannot be closed (${error_code(error)})`,
		);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw config_error(path, 'contains invalid JSON');
	}
	return validate_config(parsed, path);
}

export interface ConfigWriteOptions {
	before_commit?: () => void;
	close_file?: (fd: number) => void;
}

export function write_config(
	config: NopeekConfig,
	options: ConfigWriteOptions = {},
): void {
	const path = config_path();
	ensure_config_dir(dirname(path), true, options.close_file);
	const validated = validate_config(config, path);
	write_secure(path, JSON.stringify(validated, null, '\t'), () => {
		// Revalidate immediately before rename. This refuses corrupt, symlinked,
		// or otherwise unsafe destinations and preserves their original bytes.
		options.before_commit?.();
		read_config({ close_file: options.close_file });
	});
}

export function validate_config(
	value: unknown,
	path = 'config',
): NopeekConfig {
	if (!is_record(value))
		throw config_error(path, 'must be an object');
	if (!has_only_keys(value, ['keys', 'cli_profiles']))
		throw config_error(path, 'has unknown fields');
	const keys = value.keys ?? {};
	const profiles = value.cli_profiles ?? {};
	if (!is_record(keys))
		throw config_error(path, 'has an invalid keys object');
	if (!is_record(profiles))
		throw config_error(path, 'has an invalid cli_profiles object');

	const validated_key_entries: [string, StoredKey][] = [];
	for (const [key, entry] of Object.entries(keys)) {
		if (
			!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key) ||
			!is_record(entry) ||
			!has_only_keys(entry, ['value', 'source'])
		) {
			throw config_error(path, 'has an invalid key entry');
		}
		if (
			typeof entry.value !== 'string' ||
			(entry.source !== 'set' && entry.source !== 'load')
		) {
			throw config_error(path, 'has an invalid key entry');
		}
		validated_key_entries.push([
			key,
			{ value: entry.value, source: entry.source },
		]);
	}

	const validated_profile_entries: [string, CliProfile][] = [];
	for (const [cli, entry] of Object.entries(profiles)) {
		if (
			!cli ||
			!is_record(entry) ||
			!has_only_keys(entry, ['profile']) ||
			typeof entry.profile !== 'string'
		) {
			throw config_error(path, 'has an invalid CLI profile');
		}
		validated_profile_entries.push([cli, { profile: entry.profile }]);
	}
	return {
		keys: Object.fromEntries(validated_key_entries),
		cli_profiles: Object.fromEntries(validated_profile_entries),
	};
}

function ensure_config_dir(
	path: string,
	create: boolean,
	close_file: (fd: number) => void = closeSync,
): boolean {
	if (create) {
		try {
			mkdirSync(path, { recursive: true, mode: 0o700 });
		} catch (error) {
			throw config_error(
				path,
				`directory cannot be created (${error_code(error)})`,
			);
		}
	}

	let fd: number;
	try {
		fd = openSync(
			path,
			constants.O_RDONLY |
				constants.O_DIRECTORY |
				constants.O_NOFOLLOW,
		);
	} catch (error) {
		if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT')
			return false;
		throw config_error(
			path,
			`directory is unsafe or cannot be opened (${error_code(error)})`,
		);
	}

	let primary_error: unknown;
	try {
		const stat = fstatSync(fd);
		if (!stat.isDirectory())
			throw config_error(path, 'directory is not a directory');
		assert_owner(path, stat.uid);
		if ((stat.mode & 0o7777) !== 0o700) fchmodSync(fd, 0o700);
	} catch (error) {
		primary_error = is_config_error(error)
			? error
			: config_error(
					path,
					`directory permissions cannot be verified or repaired (${error_code(error)})`,
				);
	}
	try {
		close_file(fd);
	} catch (error) {
		if (!primary_error) {
			primary_error = config_error(
				path,
				`directory cannot be closed (${error_code(error)})`,
			);
		}
	}
	if (primary_error) throw primary_error;
	return true;
}

function open_config_file(
	path: string,
	close_file: (fd: number) => void = closeSync,
): number | undefined {
	let fd: number;
	try {
		fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT')
			return undefined;
		throw config_error(
			path,
			`file is unsafe or cannot be opened (${error_code(error)})`,
		);
	}
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile())
			throw config_error(path, 'must be a regular file');
		assert_owner(path, stat.uid);
		if ((stat.mode & 0o7777) !== 0o600) fchmodSync(fd, 0o600);
		return fd;
	} catch (error) {
		try {
			close_file(fd);
		} catch {
			// Preserve the primary validation failure.
		}
		if (is_config_error(error)) throw error;
		throw config_error(
			path,
			`file permissions cannot be verified or repaired (${error_code(error)})`,
		);
	}
}

function assert_owner(path: string, owner: number): void {
	const uid = process.getuid?.();
	if (uid === undefined) {
		throw config_error(
			path,
			'ownership cannot be verified on this platform',
		);
	}
	if (owner !== uid)
		throw config_error(path, 'is not owned by the current user');
}

function config_error(path: string, detail: string): Error {
	return new Error(
		`Unsafe nopeek config at ${path}: ${detail}. Original was left unchanged.`,
	);
}

function is_config_error(error: unknown): boolean {
	return (
		error instanceof Error &&
		error.message.startsWith('Unsafe nopeek config at ')
	);
}

function error_code(error: unknown): string {
	return (error as NodeJS.ErrnoException).code ?? 'unknown error';
}

function has_only_keys(
	value: Record<string, unknown>,
	allowed: string[],
): boolean {
	return Object.keys(value).every((key) => allowed.includes(key));
}

function is_record(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		(Object.getPrototypeOf(value) === Object.prototype ||
			Object.getPrototypeOf(value) === null)
	);
}

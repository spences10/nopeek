import { randomBytes } from 'node:crypto';
import {
	closeSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_STALE_AGE_MS = 24 * 60 * 60 * 1000;
const FILE_PREFIX = 'env-';
const TEMP_ENV_NAME = /^env-[a-f0-9]{32}\.sh$/;

export interface TempEnvOptions {
	root?: string;
	now?: () => number;
	stale_age_ms?: number;
	write_file?: (fd: number, content: string) => void;
	random_bytes?: (size: number) => Buffer;
}

export interface TempEnvFile {
	path: string;
	stale_files_removed: number;
}

export function default_temp_env_root(): string {
	const uid = process.getuid?.();
	if (uid === undefined) {
		throw new Error(
			'Secure temp env files require an operating-system user ID',
		);
	}
	return join(tmpdir(), `nopeek-${uid}`);
}

export function ensure_private_temp_root(root: string): void {
	const uid = current_uid();
	try {
		mkdirSync(root, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
			throw error;
	}

	const stat = lstatSync(root);
	if (!stat.isDirectory() || stat.isSymbolicLink()) {
		throw new Error(
			`Refusing unsafe temp env root: ${root} is not a directory`,
		);
	}
	if (stat.uid !== uid) {
		throw new Error(
			`Refusing unsafe temp env root: ${root} is not owned by the current user`,
		);
	}
	if ((stat.mode & 0o777) !== 0o700) {
		throw new Error(
			`Refusing unsafe temp env root: ${root} permissions must be 0700`,
		);
	}
}

export function cleanup_stale_temp_env_files(
	options: TempEnvOptions = {},
): number {
	const root = options.root ?? default_temp_env_root();
	ensure_private_temp_root(root);
	const cutoff =
		(options.now ?? Date.now)() -
		(options.stale_age_ms ?? DEFAULT_STALE_AGE_MS);
	const uid = current_uid();
	let removed = 0;

	for (const name of readdirSync(root)) {
		if (!TEMP_ENV_NAME.test(name)) continue;
		const path = join(root, name);
		let before;
		try {
			before = lstatSync(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT')
				continue;
			throw error;
		}
		if (
			!before.isFile() ||
			before.isSymbolicLink() ||
			before.uid !== uid ||
			(before.mode & 0o777) !== 0o600 ||
			before.mtimeMs > cutoff
		) {
			continue;
		}

		try {
			const after = lstatSync(path);
			if (
				!after.isFile() ||
				after.isSymbolicLink() ||
				after.uid !== uid ||
				(after.mode & 0o777) !== 0o600 ||
				after.dev !== before.dev ||
				after.ino !== before.ino ||
				after.mtimeMs !== before.mtimeMs ||
				after.mtimeMs > cutoff
			) {
				continue;
			}
			rmSync(path);
			removed += 1;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
				throw error;
		}
	}
	return removed;
}

export function write_temp_env_file(
	exports: { key: string; value: string }[],
	options: TempEnvOptions = {},
): TempEnvFile {
	const root = options.root ?? default_temp_env_root();
	const stale_files_removed = cleanup_stale_temp_env_files({
		...options,
		root,
	});
	const random_bytes = options.random_bytes ?? randomBytes;
	const path = join(
		root,
		`${FILE_PREFIX}${random_bytes(16).toString('hex')}.sh`,
	);
	const suffix = random_bytes(8).toString('hex');
	const loader = `_nopeek_load_${suffix}`;
	const cleanup = `_nopeek_cleanup_${suffix}`;
	const lines = [
		`${loader}() {`,
		...exports.map(
			({ key, value }) =>
				`  export ${key}=${escape_shell(value)} || return $?`,
		),
		'}',
		`${cleanup}() {`,
		`  rm -f ${escape_shell(path)} || :`,
		`  unset -f ${loader} ${cleanup}`,
		'  return "$1"',
		'}',
		`if ${loader}; then`,
		`  ${cleanup} 0`,
		'else',
		`  ${cleanup} $?`,
		'fi',
	];
	// The conditional suppresses errexit until cleanup has run. The cleanup
	// helper returns the exact loader status without leaking state into the caller.
	const content = `${lines.join('\n')}\n`;
	const fd = openSync(path, 'wx', 0o600);
	try {
		(options.write_file ?? write_content)(fd, content);
	} catch (error) {
		try {
			closeSync(fd);
		} catch {
			// Preserve the original write error.
		}
		try {
			// openSync succeeded with O_EXCL, so this path is ours to remove.
			rmSync(path, { force: true });
		} catch {
			// Preserve the original write error without leaking file contents.
		}
		throw error;
	}
	closeSync(fd);
	return { path, stale_files_removed };
}

function write_content(fd: number, content: string): void {
	writeFileSync(fd, content, { encoding: 'utf-8' });
}

function escape_shell(value: string): string {
	if (!/[^a-zA-Z0-9_./:@=-]/.test(value)) return value;
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function current_uid(): number {
	const uid = process.getuid?.();
	if (uid === undefined) {
		throw new Error(
			'Secure temp env files require an operating-system user ID',
		);
	}
	return uid;
}

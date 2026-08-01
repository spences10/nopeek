import { randomBytes } from 'node:crypto';
import {
	closeSync,
	mkdirSync,
	openSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export function ensure_dir(path: string, mode?: number): void {
	mkdirSync(path, { recursive: true, mode: mode ?? 0o755 });
}

export function ensure_secure_dir(path: string): void {
	mkdirSync(path, { recursive: true, mode: 0o700 });
}

export function write_secure(
	path: string,
	content: string,
	before_rename?: () => void,
	random_bytes: (size: number) => Buffer = randomBytes,
): void {
	ensure_secure_dir(dirname(path));
	const tmp = join(
		dirname(path),
		`.tmp-${random_bytes(16).toString('hex')}`,
	);
	const fd = openSync(tmp, 'wx', 0o600);
	let closed = false;
	try {
		writeFileSync(fd, content, { encoding: 'utf-8' });
		closeSync(fd);
		closed = true;
		before_rename?.();
		renameSync(tmp, path);
	} catch (error) {
		if (!closed) {
			try {
				closeSync(fd);
			} catch {
				// Preserve the original error.
			}
		}
		try {
			rmSync(tmp, { force: true });
		} catch {
			// Preserve the original error.
		}
		throw error;
	}
}

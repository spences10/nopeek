import { randomBytes } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function ensure_dir(path: string, mode?: number): void {
	mkdirSync(path, { recursive: true, mode: mode ?? 0o755 });
}

export function ensure_secure_dir(path: string): void {
	mkdirSync(path, { recursive: true, mode: 0o700 });
}

export function write_secure(path: string, content: string): void {
	ensure_secure_dir(dirname(path));
	const tmp = join(
		dirname(path),
		`.tmp-${randomBytes(8).toString('hex')}`,
	);
	writeFileSync(tmp, content, { encoding: 'utf-8', mode: 0o600 });
	renameSync(tmp, path);
}

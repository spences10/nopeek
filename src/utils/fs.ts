import { randomBytes } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function ensure_dir(path: string): void {
	mkdirSync(path, { recursive: true });
}

export function write_secure(path: string, content: string): void {
	ensure_dir(dirname(path));
	const tmp = join(
		dirname(path),
		`.tmp-${randomBytes(8).toString('hex')}`,
	);
	writeFileSync(tmp, content, { encoding: 'utf-8', mode: 0o600 });
	renameSync(tmp, path);
}

import { randomBytes } from 'node:crypto';
import {
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { write_secure } from './fs.js';

const roots: string[] = [];

function root(): string {
	const path = join(
		tmpdir(),
		`nopeek-fs-test-${randomBytes(6).toString('hex')}`,
	);
	roots.push(path);
	return path;
}

afterEach(() => {
	for (const path of roots.splice(0)) {
		rmSync(path, { recursive: true, force: true });
	}
});

describe('write_secure', () => {
	it('atomically replaces a file without leaving temporary files', () => {
		const dir = root();
		const path = join(dir, 'config.json');
		write_secure(path, 'first');
		write_secure(path, 'second');

		expect(readFileSync(path, 'utf-8')).toBe('second');
		expect(readdirSync(dir)).toEqual(['config.json']);
	});

	it('does not remove an existing exclusive temp-name collision', () => {
		const dir = root();
		mkdirSync(dir, { recursive: true });
		const path = join(dir, 'config.json');
		const collision = join(dir, `.tmp-${'a'.repeat(32)}`);
		write_secure(collision, 'existing');

		expect(() =>
			write_secure(path, 'replacement', undefined, () =>
				Buffer.alloc(16, 0xaa),
			),
		).toThrow(expect.objectContaining({ code: 'EEXIST' }));
		expect(readFileSync(collision, 'utf-8')).toBe('existing');
	});

	it('preserves the destination when pre-rename validation fails', () => {
		const dir = root();
		const path = join(dir, 'config.json');
		write_secure(path, 'original');

		expect(() =>
			write_secure(path, 'replacement', () => {
				throw new Error('unsafe destination');
			}),
		).toThrow('unsafe destination');
		expect(readFileSync(path, 'utf-8')).toBe('original');
		expect(readdirSync(dir)).toEqual(['config.json']);
	});

	it('keeps concurrent atomic writers free of temp-file collisions', async () => {
		const dir = root();
		const path = join(dir, 'config.json');
		const module_url = pathToFileURL(
			join(process.cwd(), 'src/utils/fs.ts'),
		).href;
		const { spawn } = await import('node:child_process');
		await Promise.all(
			Array.from(
				{ length: 6 },
				(_, index) =>
					new Promise<void>((resolve, reject) => {
						const script = `import { write_secure } from ${JSON.stringify(module_url)}; write_secure(${JSON.stringify(path)}, ${JSON.stringify(`writer-${index}`)});`;
						const child = spawn(
							process.execPath,
							[
								'--experimental-strip-types',
								'--input-type=module',
								'-e',
								script,
							],
							{ stdio: 'ignore' },
						);
						child.once('error', reject);
						child.once('exit', (code) => {
							if (code === 0) resolve();
							else reject(new Error(`child exited ${code}`));
						});
					}),
			),
		);
		expect(readFileSync(path, 'utf-8')).toMatch(/^writer-[0-5]$/);
		expect(readdirSync(dir)).toEqual(['config.json']);
	});

	it('cleans its temporary file when rename fails', () => {
		const dir = root();
		mkdirSync(dir, { recursive: true });
		const destination = join(dir, 'destination');
		mkdirSync(destination);

		expect(() =>
			write_secure(destination, 'sentinel-secret'),
		).toThrow();
		expect(readdirSync(dir)).toEqual(['destination']);
	});
});

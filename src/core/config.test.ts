import { randomBytes } from 'node:crypto';
import {
	chmodSync,
	closeSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	read_config,
	validate_config,
	write_config,
} from './config.js';

const original_env = { ...process.env };
const roots: string[] = [];

function fixture(): { root: string; dir: string; path: string } {
	const root = join(
		tmpdir(),
		`nopeek-config-test-${randomBytes(6).toString('hex')}`,
	);
	roots.push(root);
	process.env.XDG_CONFIG_HOME = root;
	return {
		root,
		dir: join(root, 'nopeek'),
		path: join(root, 'nopeek', 'config.json'),
	};
}

function valid_config() {
	return {
		keys: {
			SAFE: { value: 'sentinel-secret', source: 'set' as const },
		},
		cli_profiles: { aws: { profile: 'development' } },
	};
}

afterEach(() => {
	process.env = { ...original_env };
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe('config integrity', () => {
	it('returns empty for a missing config without creating directories', () => {
		const { dir } = fixture();
		expect(read_config()).toEqual({ keys: {}, cli_profiles: {} });
		expect(() => lstatSync(dir)).toThrow();
	});

	it('creates and atomically replaces a private validated config', () => {
		const { dir, path } = fixture();
		write_config(valid_config());

		expect(read_config()).toEqual(valid_config());
		expect(lstatSync(dir).mode & 0o777).toBe(0o700);
		expect(lstatSync(path).mode & 0o777).toBe(0o600);
		expect(readdirSync(dir)).toEqual(['config.json']);
	});

	it('fails actionably on corrupt JSON without changing the original', () => {
		const { dir, path } = fixture();
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		const original = '{"keys":"sentinel-secret"';
		writeFileSync(path, original, { mode: 0o600 });

		expect(() => read_config()).toThrow('contains invalid JSON');
		expect(readFileSync(path, 'utf-8')).toBe(original);
		expect(() => write_config(valid_config())).toThrow(
			'contains invalid JSON',
		);
		expect(readFileSync(path, 'utf-8')).toBe(original);
	});

	it('rejects an unsafe destination replacement immediately before rename', () => {
		const { dir, path } = fixture();
		write_config(valid_config());
		const original = readFileSync(path, 'utf-8');
		const backup = join(dir, 'original.json');
		const target = join(dir, 'target.json');
		writeFileSync(target, 'target-sentinel', { mode: 0o600 });

		expect(() =>
			write_config(
				{ keys: {}, cli_profiles: {} },
				{
					before_commit() {
						renameSync(path, backup);
						symlinkSync(target, path);
					},
				},
			),
		).toThrow('file is unsafe or cannot be opened');
		expect(readFileSync(backup, 'utf-8')).toBe(original);
		expect(readFileSync(target, 'utf-8')).toBe('target-sentinel');
		expect(lstatSync(path).isSymbolicLink()).toBe(true);
		expect(
			readdirSync(dir).every((name) => !name.startsWith('.tmp-')),
		).toBe(true);
	});

	it('rejects invalid runtime schema without disclosing values', () => {
		const invalid = {
			keys: {
				SAFE: { value: 'sentinel-secret', source: 'invalid' },
			},
			cli_profiles: {},
		};
		let message = '';
		try {
			validate_config(invalid);
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).toContain('invalid key entry');
		expect(message).not.toContain('sentinel-secret');
		expect(() =>
			validate_config({
				...valid_config(),
				unknown: 'sentinel-secret',
			}),
		).toThrow('has unknown fields');
	});

	it('repairs modes only for owned regular directories and files', () => {
		const { dir, path } = fixture();
		mkdirSync(dir, { recursive: true, mode: 0o755 });
		writeFileSync(path, JSON.stringify(valid_config()), {
			mode: 0o644,
		});
		chmodSync(dir, 0o1700);
		chmodSync(path, 0o1600);

		expect(read_config()).toEqual(valid_config());
		expect(lstatSync(dir).mode & 0o777).toBe(0o700);
		expect(lstatSync(path).mode & 0o777).toBe(0o600);
	});

	it('handles prototype-like names as data without changing prototypes', () => {
		const config = validate_config({
			keys: Object.fromEntries([
				['__proto__', { value: 'safe', source: 'set' }],
			]),
			cli_profiles: {},
		});
		expect(Object.hasOwn(config.keys, '__proto__')).toBe(true);
		expect(Object.prototype).not.toHaveProperty('value');
	});

	it('rejects a symlink config directory without touching its target', () => {
		const { root, dir } = fixture();
		mkdirSync(root, { recursive: true, mode: 0o700 });
		const target = join(root, 'target');
		mkdirSync(target, { mode: 0o700 });
		symlinkSync(target, dir);

		expect(() => read_config()).toThrow(
			'directory is unsafe or cannot be opened',
		);
		expect(lstatSync(target).mode & 0o777).toBe(0o700);
	});

	it('rejects a symlink or non-regular config file', () => {
		const { dir, path } = fixture();
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		const target = join(dir, 'target.json');
		writeFileSync(target, JSON.stringify(valid_config()), {
			mode: 0o600,
		});
		symlinkSync(target, path);

		expect(() => read_config()).toThrow(
			'file is unsafe or cannot be opened',
		);
		rmSync(path);
		rmSync(target);
		symlinkSync(join(dir, 'missing.json'), path);
		expect(() => read_config()).toThrow(
			'file is unsafe or cannot be opened',
		);
		rmSync(path);
		mkdirSync(path, { mode: 0o700 });
		expect(() => read_config()).toThrow('must be a regular file');
	});

	it('wraps standalone close failures and preserves primary security errors', () => {
		const { dir, path } = fixture();
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		writeFileSync(path, JSON.stringify(valid_config()), {
			mode: 0o600,
		});
		let closes = 0;
		const close_file = (fd: number) => {
			closeSync(fd);
			closes += 1;
			if (closes === 2) {
				const error = new Error(
					'close failed',
				) as NodeJS.ErrnoException;
				error.code = 'EIO';
				throw error;
			}
		};
		expect(() => read_config({ close_file })).toThrow(
			'cannot be closed (EIO)',
		);

		rmSync(path);
		mkdirSync(path, { mode: 0o700 });
		closes = 0;
		expect(() => read_config({ close_file })).toThrow(
			'must be a regular file',
		);
	});

	it('does not put config contents into filesystem error messages', () => {
		const { dir, path } = fixture();
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		writeFileSync(path, JSON.stringify(valid_config()), {
			mode: 0o600,
		});
		chmodSync(path, 0o000);
		let message = '';
		try {
			read_config();
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).toContain('cannot be opened (EACCES)');
		expect(message).not.toContain('sentinel-secret');
		expect(lstatSync(path).mode & 0o777).toBe(0o000);
	});
});

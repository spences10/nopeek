import { beforeEach, describe, expect, it, vi } from 'vitest';

const scan_all = vi.fn();
vi.mock('../detectors/index.js', () => ({ scan_all }));

const { init_command } = await import('./init.js');

describe('init_command', () => {
	beforeEach(() => {
		scan_all.mockReset();
		vi.restoreAllMocks();
	});

	it('reports cloud authentication without managing stored profiles', async () => {
		scan_all.mockResolvedValue([
			{
				name: 'aws',
				version: '2.0',
				status: 'ok',
				detail: 'using named profile "current" [OK]',
				env_var: 'AWS_PROFILE',
				profile: 'current',
			},
		]);
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});

		await init_command(true);

		expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({
			advisory: true,
			detected: [
				{
					name: 'aws',
					version: '2.0',
					status: 'ok',
					detail: 'using named profile "current" [OK]',
					profile: 'current',
				},
			],
			migrations: [],
		});
	});

	it('reports required migrations as advice', async () => {
		scan_all.mockResolvedValue([
			{
				name: 'aws',
				version: '2.0',
				status: 'migrate',
				detail: 'inline credentials detected',
			},
		]);
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});

		await init_command(true);

		expect(
			JSON.parse(String(log.mock.calls[0][0])).migrations,
		).toEqual([
			{ cli: 'aws', detail: 'inline credentials detected' },
		]);
	});

	it('handles a scan with no supported CLIs', async () => {
		scan_all.mockResolvedValue([]);
		const stderr = vi
			.spyOn(console, 'error')
			.mockImplementation(() => {});

		await init_command(false);

		expect(stderr).toHaveBeenCalledWith(
			'  No supported cloud CLIs found.',
		);
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NopeekConfig } from '../core/config.js';

const config: NopeekConfig = {
	keys: {},
	cli_profiles: { aws: { profile: 'legacy' } },
};
const write_config = vi.fn();
const scan_all = vi.fn();

vi.mock('../core/config.js', () => ({
	read_config: () => config,
	write_config,
}));
vi.mock('../detectors/index.js', () => ({ scan_all }));

const { init_command } = await import('./init.js');

describe('init_command', () => {
	beforeEach(() => {
		config.cli_profiles = { aws: { profile: 'legacy' } };
		write_config.mockClear();
		scan_all.mockReset();
	});

	it('is advisory and removes obsolete stored profile mappings', async () => {
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

		expect(config.cli_profiles).toEqual({});
		expect(write_config).toHaveBeenCalledWith(config);
		expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({
			advisory: true,
			removed_legacy_profiles: 1,
		});
		log.mockRestore();
	});

	it('does not rewrite config when there are no legacy mappings', async () => {
		config.cli_profiles = {};
		scan_all.mockResolvedValue([]);

		await init_command(true);

		expect(write_config).not.toHaveBeenCalled();
	});
});

import { read_config, write_config } from '../core/config.js';
import { fail, output, success } from '../utils/output.js';

export function remove_command(key: string, json?: boolean): void {
	const config = read_config();

	if (!config.keys[key]) {
		fail(`${key} not found in nopeek config`, json);
	}

	delete config.keys[key];
	write_config(config);

	if (!json) {
		success(`${key} removed from nopeek config`);
		return;
	}
	output({ success: true, key }, true);
}

import { read_config, write_config } from '../core/config.js';
import { error, success } from '../utils/output.js';

export function remove_command(key: string): void {
	const config = read_config();

	if (!config.keys[key]) {
		error(`${key} not found in nopeek config`);
		process.exit(1);
	}

	delete config.keys[key];
	write_config(config);
	success(`${key} removed from nopeek config`);
}

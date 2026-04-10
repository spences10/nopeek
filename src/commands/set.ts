import { createInterface } from 'node:readline';
import { read_config, write_config } from '../core/config.js';
import { error, info, success } from '../utils/output.js';

interface SetOptions {
	value?: string;
	from_env?: boolean;
}

export function set_command(key: string, options: SetOptions): void {
	if (options.from_env) {
		const val = process.env[key];
		if (!val) {
			error(`${key} not found in environment`);
			info(
				`  Tip: To load from a .env file, use: npx nopeek load .env --only ${key}`,
			);
			process.exit(1);
		}
		store_key(key, val);
		return;
	}

	if (options.value) {
		store_key(key, options.value);
		return;
	}

	// Interactive prompt — only works in TTY
	if (!process.stdin.isTTY) {
		error(
			'No value provided. Use --value or --from-env in non-interactive mode.',
		);
		process.exit(1);
	}

	const rl = createInterface({
		input: process.stdin,
		output: process.stderr,
	});

	rl.question(`  Enter value for ${key}: `, (answer) => {
		rl.close();
		if (!answer) {
			error('No value provided');
			process.exit(1);
		}
		store_key(key, answer);
	});
}

function store_key(key: string, value: string): void {
	const config = read_config();
	config.keys[key] = { value, source: 'set' };
	write_config(config);
	success(`${key} stored in nopeek config`);
}

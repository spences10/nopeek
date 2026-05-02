import { createInterface } from 'node:readline';
import { read_config, write_config } from '../core/config.js';
import {
	is_llm_agent_session,
	validate_key,
} from '../core/session.js';
import { fail, info, output, success } from '../utils/output.js';

interface SetOptions {
	value?: string;
	from_env?: boolean;
	json?: boolean;
}

export function set_command(key: string, options: SetOptions): void {
	const { json } = options;

	if (!validate_key(key)) {
		fail('Invalid env key name', json, { invalid_key: key });
	}

	if (options.from_env) {
		const val = process.env[key];
		if (!val) {
			if (!json) {
				info(
					`  Tip: To load from a .env file, use: npx nopeek load .env --only ${key}`,
				);
			}
			fail(`${key} not found in environment`, json);
		}
		store_key(key, val, json);
		return;
	}

	if (options.value) {
		if (is_llm_agent_session()) {
			fail(
				'--value is unsafe in an LLM agent session; use --from-env or interactive TTY',
				json,
			);
		}
		store_key(key, options.value, json);
		return;
	}

	// Interactive prompt — only works in TTY
	if (!process.stdin.isTTY) {
		fail(
			'No value provided. Use --value or --from-env in non-interactive mode.',
			json,
		);
	}

	const rl = createInterface({
		input: process.stdin,
		output: process.stderr,
	});

	rl.question(`  Enter value for ${key}: `, (answer) => {
		rl.close();
		if (!answer) {
			fail('No value provided', json);
		}
		store_key(key, answer, json);
	});
}

function store_key(key: string, value: string, json?: boolean): void {
	const config = read_config();
	config.keys[key] = { value, source: 'set' };
	write_config(config);

	if (!json) {
		success(`${key} stored in plaintext nopeek config`);
		return;
	}
	output(
		{ success: true, key, source: 'set', plaintext_config: true },
		true,
	);
}

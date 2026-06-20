import { defineCommand } from 'citty';
import { fail } from '../utils/output.js';
import { run_command } from './run.js';

export default defineCommand({
	meta: {
		name: 'run',
		description:
			'Run a command with secrets loaded from .env or .tfvars: nopeek run <file> [--only KEY] -- <command>',
	},
	args: {
		file: {
			type: 'positional',
			description: 'File path (.env, .tfvars, .tfvars.json)',
			required: true,
		},
		only: {
			type: 'string',
			description:
				'Comma-separated list of keys to load (default: all)',
		},
	},
	run({ rawArgs }) {
		const separator = rawArgs.indexOf('--');
		if (separator === -1) {
			fail('Missing -- before command', false);
		}

		const command = rawArgs.slice(separator + 1);
		const options = parse_run_args(rawArgs.slice(0, separator));
		run_command(options.file, options.only, command);
	},
});

function parse_run_args(args: string[]): {
	file: string;
	only?: string;
} {
	let file: string | undefined;
	let only: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--only') {
			only = args[++i];
			if (!only) fail('Missing value for --only', false);
			continue;
		}
		if (arg.startsWith('--only=')) {
			only = arg.slice('--only='.length);
			continue;
		}
		if (arg.startsWith('-')) {
			fail(`Unknown run option: ${arg}`, false);
		}
		if (file) {
			fail(`Unexpected argument before --: ${arg}`, false);
		}
		file = arg;
	}

	if (!file) fail('Missing file path', false);
	return { file, only };
}

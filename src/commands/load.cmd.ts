import { defineCommand } from 'citty';
import { load_command } from './load.js';

export default defineCommand({
	meta: {
		name: 'load',
		description: 'Load secrets from .env file into session',
	},
	args: {
		file: {
			type: 'positional',
			description: '.env file path',
			required: true,
		},
		only: {
			type: 'string',
			description:
				'Comma-separated list of keys to load (default: all)',
		},
	},
	run({ args }) {
		load_command(args.file, args.only);
	},
});

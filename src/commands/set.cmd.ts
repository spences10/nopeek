import { defineCommand } from 'citty';
import { set_command } from './set.js';

export default defineCommand({
	meta: {
		name: 'set',
		description: 'Store a secret key in nopeek config',
	},
	args: {
		key: {
			type: 'positional',
			description: 'Key name (e.g. MY_API_KEY)',
			required: true,
		},
		value: {
			type: 'string',
			description: 'Value to store (for scripting)',
		},
		'from-env': {
			type: 'boolean',
			description: 'Read value from current shell environment',
		},
		json: {
			type: 'boolean',
			description: 'Output as JSON (default: true)',
			default: true,
		},
	},
	run({ args }) {
		set_command(args.key, {
			value: args.value,
			from_env: args['from-env'],
			json: args.json,
		});
	},
});

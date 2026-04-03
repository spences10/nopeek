import { defineCommand } from 'citty';
import { remove_command } from './remove.js';

export default defineCommand({
	meta: {
		name: 'remove',
		description: 'Remove a stored key from nopeek config',
	},
	args: {
		key: {
			type: 'positional',
			description: 'Key name to remove',
			required: true,
		},
	},
	run({ args }) {
		remove_command(args.key);
	},
});

import { defineCommand } from 'citty';
import { list_command } from './list.js';

export default defineCommand({
	meta: {
		name: 'list',
		description: 'List available keys (without values)',
	},
	args: {
		json: {
			type: 'boolean',
			description: 'Output as JSON (default: true)',
			default: true,
		},
	},
	run({ args }) {
		list_command(args.json);
	},
});

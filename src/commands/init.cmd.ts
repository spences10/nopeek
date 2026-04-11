import { defineCommand } from 'citty';
import { init_command } from './init.js';

export default defineCommand({
	meta: {
		name: 'init',
		description: 'Scan for cloud CLIs and configure secure auth',
	},
	args: {
		json: {
			type: 'boolean',
			description: 'Output as JSON (default: true)',
			default: true,
		},
	},
	run({ args }) {
		void init_command(args.json);
	},
});

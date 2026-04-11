import { defineCommand } from 'citty';
import { status_command } from './status.js';

export default defineCommand({
	meta: {
		name: 'status',
		description: 'Show current nopeek configuration state',
	},
	args: {
		json: {
			type: 'boolean',
			description: 'Output as JSON (default: true)',
			default: true,
		},
	},
	run({ args }) {
		void status_command(args.json);
	},
});

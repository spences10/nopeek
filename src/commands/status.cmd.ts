import { defineCommand } from 'citty';
import { status_command } from './status.js';

export default defineCommand({
	meta: {
		name: 'status',
		description: 'Show current nopeek configuration state',
	},
	run() {
		void status_command();
	},
});

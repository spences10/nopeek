import { defineCommand } from 'citty';
import { init_command } from './init.js';

export default defineCommand({
	meta: {
		name: 'init',
		description: 'Scan for cloud CLIs and configure secure auth',
	},
	run() {
		void init_command();
	},
});

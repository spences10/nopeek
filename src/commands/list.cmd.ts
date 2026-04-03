import { defineCommand } from 'citty';
import { list_command } from './list.js';

export default defineCommand({
	meta: {
		name: 'list',
		description: 'List available keys (without values)',
	},
	run() {
		list_command();
	},
});

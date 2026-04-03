import { defineCommand } from 'citty';
import { audit_command } from './audit.js';

export default defineCommand({
	meta: {
		name: 'audit',
		description:
			'Scan current directory for exposed secrets in .env files',
	},
	args: {
		path: {
			type: 'positional',
			description: 'Directory to scan (default: .)',
			default: '.',
		},
	},
	run({ args }) {
		audit_command(args.path);
	},
});

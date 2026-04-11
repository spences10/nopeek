import { defineCommand } from 'citty';
import { template_command } from './template.js';

export default defineCommand({
	meta: {
		name: 'template',
		description:
			'Resolve {{KEY}} placeholders in a file using session secrets',
	},
	args: {
		input: {
			type: 'string',
			description: 'Input template file path',
			required: true,
		},
		output: {
			type: 'string',
			description: 'Output file path',
			required: true,
		},
		json: {
			type: 'boolean',
			description: 'Output as JSON (default: true)',
			default: true,
		},
	},
	run({ args }) {
		template_command(args.input, args.output, args.json);
	},
});

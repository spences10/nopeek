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
	},
	run({ args }) {
		template_command(args.input, args.output);
	},
});

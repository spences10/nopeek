import { defineCommand } from 'citty';
import { load_command } from './load.js';

export default defineCommand({
	meta: {
		name: 'load',
		description:
			'Load secrets from .env or .tfvars file into session',
	},
	args: {
		file: {
			type: 'positional',
			description: 'File path (.env, .tfvars, .tfvars.json)',
			required: true,
		},
		only: {
			type: 'string',
			description:
				'Comma-separated list of keys to load (default: all)',
		},
		persist: {
			type: 'boolean',
			description:
				'Also save keys to nopeek config for future sessions',
		},
		shell: {
			type: 'enum',
			description:
				'Choose shell assignment syntax (requires --allow-values)',
			options: ['bash', 'zsh', 'fish'],
		},
		'allow-values': {
			type: 'boolean',
			description:
				'Explicitly allow secret values in stdout (rejected in agent sessions)',
		},
		json: {
			type: 'boolean',
			description: 'Output as JSON (default: true)',
			default: true,
		},
	},
	run({ args }) {
		load_command(
			args.file,
			args.only,
			args.persist,
			args.json,
			args.shell as 'bash' | 'zsh' | 'fish' | undefined,
			args['allow-values'],
		);
	},
});

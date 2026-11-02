#!/usr/bin/env node

import { defineCommand, renderUsage, runMain } from 'citty';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail } from './utils/output.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
	readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'),
);

const WORKFLOW_SECTION = `Workflow:
  1. npx nopeek run .env --only API_KEY -- your-command
     Pass selected secrets directly to one child process, without temp files or storage.
  2. npx nopeek audit         Scan secret files and Git ignore coverage
  3. npx nopeek init          Audit cloud CLI authentication (advisory only)`;

const CONCEPTS_SECTION = `Boundaries:
  --only filters the input file, not the inherited parent environment.
  The child receives real credentials and can print or write them.
  nopeek does not redact child output or restrict access to the original file.`;

const EXAMPLES_SECTION = `Examples:
  npx nopeek run .env --only DATABASE_URL -- node ./scripts/query.js
  npx nopeek run production.tfvars.json --only API_KEY -- node ./scripts/call-api.js
  npx nopeek audit
  npx nopeek init

  run passes through child output and preserves its exit code.
  Advisory commands output JSON by default; use --no-json for text output.`;

const retired_commands = new Set([
	'load',
	'set',
	'list',
	'remove',
	'status',
	'template',
]);

const main = defineCommand({
	meta: {
		name: 'nopeek',
		version: pkg.version,
		description:
			'Run one command with env secrets, without temp files or persistent storage.',
	},
	subCommands: {
		run: () => import('./commands/run.cmd.js').then((m) => m.default),
		init: () =>
			import('./commands/init.cmd.js').then((m) => m.default),
		audit: () =>
			import('./commands/audit.cmd.js').then((m) => m.default),
	},
});

// Non-TTY with no subcommand: auto-show help with workflow guidance
const arg = process.argv[2];
if (retired_commands.has(arg)) {
	fail(
		`The ${arg} command has been removed. Use nopeek run <file> --only KEY -- <command>. Legacy stored files are not read, migrated, or deleted.`,
		false,
	);
}
if (!arg && !process.stdout.isTTY) {
	const base = await renderUsage(main);
	console.log(
		base +
			'\n' +
			WORKFLOW_SECTION +
			'\n\n' +
			CONCEPTS_SECTION +
			'\n\n' +
			EXAMPLES_SECTION +
			'\n',
	);
} else {
	void runMain(main);
}

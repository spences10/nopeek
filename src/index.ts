#!/usr/bin/env node

import { defineCommand, renderUsage, runMain } from 'citty';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
	readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'),
);

const WORKFLOW_SECTION = `Workflow:
  1. npx nopeek init          Detect cloud CLIs, configure profiles
  2. npx nopeek load .env     Inject .env secrets into session
  3. npx nopeek run .env -- cmd  Run one command with loaded secrets
  4. npx nopeek status        Verify session state and loaded keys
  5. npx nopeek audit         Scan for exposed secrets`;

const CONCEPTS_SECTION = `Concepts:
  Key       A secret name (e.g. DATABASE_URL). Values never appear in output.
  Source    Where the key came from: "set" (manual), "load" (from file).
  Profile   A named CLI auth config (e.g. AWS_PROFILE) — no inline creds.
  Session   LLM coding agent session detected via env-file injection or known agent markers.`;

const EXAMPLES_SECTION = `Examples:
  npx nopeek load .env --only DATABASE_URL,API_KEY
  npx nopeek run .env --only API_KEY -- sh -c 'curl -H "Authorization: Bearer $API_KEY" https://api.example.com'
  npx nopeek set STRIPE_KEY --from-env
  npx nopeek list
  npx nopeek status
  npx nopeek audit
  npx nopeek init

  All commands output JSON by default (for LLM agents).
  Use --no-json for human-readable text output.
  Interactive prompts are skipped in non-TTY environments.`;

const main = defineCommand({
	meta: {
		name: 'nopeek',
		version: pkg.version,
		description:
			'Load env secrets for LLM coding agents without exposing values.',
	},
	subCommands: {
		load: () =>
			import('./commands/load.cmd.js').then((m) => m.default),
		run: () => import('./commands/run.cmd.js').then((m) => m.default),
		set: () => import('./commands/set.cmd.js').then((m) => m.default),
		list: () =>
			import('./commands/list.cmd.js').then((m) => m.default),
		remove: () =>
			import('./commands/remove.cmd.js').then((m) => m.default),
		init: () =>
			import('./commands/init.cmd.js').then((m) => m.default),
		status: () =>
			import('./commands/status.cmd.js').then((m) => m.default),
		audit: () =>
			import('./commands/audit.cmd.js').then((m) => m.default),
		template: () =>
			import('./commands/template.cmd.js').then((m) => m.default),
	},
});

// Non-TTY with no subcommand: auto-show help with workflow guidance
const arg = process.argv[2];
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

#!/usr/bin/env node

import { defineCommand, runMain } from 'citty';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
	readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'),
);

const main = defineCommand({
	meta: {
		name: 'nopeek',
		version: pkg.version,
		description:
			'Secure proxy between Claude Code and your secrets. Claude knows key names, never key values.',
	},
	subCommands: {
		load: () =>
			import('./commands/load.cmd.js').then((m) => m.default),
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
	},
});

void runMain(main);

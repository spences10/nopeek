import chalk from 'chalk';

export const success = (msg: string) =>
	console.error(chalk.green(`  [done] ${msg}`));
export const error = (msg: string) =>
	console.error(chalk.red(`  [error] ${msg}`));
export const warning = (msg: string) =>
	console.error(chalk.yellow(`  [warn] ${msg}`));
export const info = (msg: string) =>
	console.error(chalk.cyan(`  ${msg}`));
export const found = (msg: string) =>
	console.error(chalk.white(`  Found: ${msg}`));
export const label = (msg: string) =>
	console.error(chalk.dim(`  ${msg}`));

export const success = (msg: string) =>
	console.error(`  [done] ${msg}`);
export const error = (msg: string) =>
	console.error(`  [error] ${msg}`);
export const warning = (msg: string) =>
	console.error(`  [warn] ${msg}`);
export const info = (msg: string) => console.error(`  ${msg}`);
export const found = (msg: string) =>
	console.error(`  Found: ${msg}`);
export const label = (msg: string) => console.error(`  ${msg}`);

/**
 * Unified output — JSON to stdout, text to stderr.
 */
export function output(data: unknown, json: boolean): void {
	if (json) {
		console.log(JSON.stringify(data, null, 2));
	} else if (typeof data === 'string') {
		console.error(data);
	} else if (Array.isArray(data)) {
		for (const item of data) {
			console.error(item);
		}
	} else {
		console.error(data);
	}
}

/**
 * Exit with error. JSON mode gets structured output; human mode gets text.
 */
export function fail(
	msg: string,
	json?: boolean,
	extra?: Record<string, unknown>,
): never {
	if (json) {
		console.log(
			JSON.stringify(
				{ success: false, error: msg, ...extra },
				null,
				2,
			),
		);
	} else {
		error(msg);
	}
	process.exit(1);
}

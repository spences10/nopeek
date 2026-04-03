import { aws_detector } from './aws.js';
import { hcloud_detector } from './hcloud.js';
import type { CliDetector, DetectorResult } from './types.js';

export type { CliDetector, DetectorResult };

export const detectors: CliDetector[] = [
	aws_detector,
	hcloud_detector,
];

export async function scan_all(): Promise<DetectorResult[]> {
	const results: DetectorResult[] = [];
	for (const detector of detectors) {
		const result = await detector.check();
		if (result) results.push(result);
	}
	return results;
}

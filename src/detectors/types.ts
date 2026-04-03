export type AuthStatus = 'ok' | 'migrate' | 'skip';

export interface DetectorResult {
	name: string;
	version: string | null;
	status: AuthStatus;
	detail: string;
	env_var?: string;
	profile?: string;
}

export interface CliDetector {
	name: string;
	check(): Promise<DetectorResult | null>;
	migrate?(): Promise<boolean>;
}

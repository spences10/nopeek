export interface SecretPattern {
	name: string;
	pattern: RegExp;
}

export const SECRET_PATTERNS: SecretPattern[] = [
	{
		name: 'AWS Access Key',
		pattern: /AKIA[A-Z0-9]{16}/,
	},
	{
		name: 'AWS Secret Key',
		pattern:
			/(?:SecretAccessKey|aws_secret_access_key)\s*[:=]\s*[A-Za-z0-9/+=]{40}/,
	},
	{
		name: 'Bearer Token',
		pattern: /Bearer\s+[a-zA-Z0-9._-]{20,}/,
	},
	{
		name: 'OpenAI/Anthropic API Key',
		pattern: /sk-[a-zA-Z0-9._-]{20,}/,
	},
	{
		name: 'Stripe Live Key',
		pattern: /sk_live_[a-zA-Z0-9]{20,}/,
	},
	{
		name: 'Stripe Test Key',
		pattern: /sk_test_[a-zA-Z0-9]{20,}/,
	},
	{
		name: 'Hetzner Token',
		pattern:
			/(?:HCLOUD_TOKEN|hcloud_token|token)\s*[:=]\s*["']?[a-f0-9]{64}\b/,
	},
	{
		name: 'Google API Key',
		pattern: /AIza[0-9A-Za-z_-]{35}/,
	},
	{
		name: 'Google OAuth Token',
		pattern: /ya29\.[0-9A-Za-z_-]{20,}/,
	},
	{
		name: 'Azure Credential',
		pattern:
			/(?:ARM_ACCESS_KEY|ARM_CLIENT_SECRET|AZURE_ACCESS_TOKEN|AZURE_CLIENT_SECRET|AZURE_PASSWORD|AZURE_STORAGE_KEY)\s*[:=]\s*["']?[^\s"']{8,}/i,
	},
	{
		name: 'Azure Storage Account Key',
		pattern:
			/(?:AccountKey|SharedAccessKey)\s*=\s*[A-Za-z0-9+/=]{20,}/,
	},
	{
		name: 'Private Key',
		pattern: /-----BEGIN\s+[\w\s]*PRIVATE\s+KEY-----/,
	},
	{
		name: 'Connection String with Password',
		pattern: /:\/\/[^:]+:[^@]+@/,
	},
	{
		name: 'Generic Password Field',
		pattern:
			/(?:password|passwd|secret|token)\s*[:=]\s*["']?[^\s"']{8,}/i,
	},
];

export function detect_secrets(
	content: string,
): { line: number; pattern: SecretPattern }[] {
	const hits: { line: number; pattern: SecretPattern }[] = [];
	const lines = content.split('\n');

	for (let i = 0; i < lines.length; i++) {
		for (const sp of SECRET_PATTERNS) {
			if (sp.pattern.test(lines[i])) {
				hits.push({ line: i + 1, pattern: sp });
			}
		}
	}

	return hits;
}

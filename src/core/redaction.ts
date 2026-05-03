export interface SecretPattern {
	name: string;
	pattern: RegExp;
	multiline?: boolean;
}

export const SECRET_PATTERNS: SecretPattern[] = [
	{
		name: 'AWS Access Key',
		pattern: /AKIA[A-Z0-9]{16}/,
	},
	{
		name: 'AWS Temp Access Key',
		pattern: /ASIA[A-Z0-9]{16}/,
	},
	{
		name: 'AWS Secret Key',
		pattern:
			/\b(?:AWS_SECRET_ACCESS_KEY|aws_secret_access_key|secret_access_key|SecretAccessKey)\b\s*[:=]\s*["']?[A-Za-z0-9/+=]{40,}["']?/,
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
		pattern:
			/-----BEGIN\s+[\w\s]*PRIVATE\s+KEY-----(?:[\s\S]*?-----END\s+[\w\s]*PRIVATE\s+KEY-----)?/,
		multiline: true,
	},
	{
		name: 'Connection String with Password',
		pattern: /:\/\/[^\s:]+:[^\s@]+@/,
	},
	{
		name: 'Generic Password Field',
		pattern:
			/\b(?:[A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY)|password|passwd|secret|token|api[_-]?key)\b\s*[:=]\s*["']?[A-Za-z0-9._:/+=@!-]{8,}["']?/i,
	},
	{
		name: 'Generic Secret Phrase',
		pattern:
			/\b(?:password|passwd|secret|token|api[_-]?key)\b\s+(?:is|was|seen|value|header)?\s*["']?[A-Za-z0-9._:/+=@!-]{12,}["']?/i,
	},
	{
		name: 'Tavily API Key',
		pattern: /tvly-[a-zA-Z0-9_-]{20,}/,
	},
	{
		name: 'Kagi API Key',
		pattern:
			/\bKAGI_API_KEY\b\s*[:=]\s*["']?[a-zA-Z0-9_-]{40,}\.[a-zA-Z0-9_-]{40,}["']?/i,
	},
	{
		name: 'Brave API Key',
		pattern: /BSA[A-Z0-9]{20,}/,
	},
	{
		name: 'Firecrawl API Key',
		pattern: /fc-[a-f0-9]{32}/,
	},
	{
		name: 'GitHub Token',
		pattern: /gh[pousr]_[a-zA-Z0-9]{36,}/,
	},
	{
		name: 'GitHub Fine-grained PAT',
		pattern: /github_pat_[a-zA-Z0-9_]{20,}/,
	},
];

export function detect_secrets(
	content: string,
): { line: number; pattern: SecretPattern }[] {
	const hits: { line: number; pattern: SecretPattern }[] = [];
	const lines = content.split('\n');

	for (const sp of SECRET_PATTERNS) {
		if (!sp.multiline) continue;
		const pattern = global_regex(sp.pattern);
		for (const match of content.matchAll(pattern)) {
			hits.push({
				line: line_number_at(content, match.index ?? 0),
				pattern: sp,
			});
		}
	}

	for (let i = 0; i < lines.length; i++) {
		const line_hits = SECRET_PATTERNS.filter((sp) => {
			if (sp.multiline) return false;
			return line_regex(sp.pattern).test(lines[i]);
		});
		const specific_hits = line_hits.filter(
			(sp) => sp.name !== 'Generic Password Field',
		);
		for (const sp of specific_hits.length > 0
			? specific_hits
			: line_hits) {
			hits.push({ line: i + 1, pattern: sp });
		}
	}

	return hits.sort((a, b) => a.line - b.line);
}

function line_regex(pattern: RegExp): RegExp {
	return new RegExp(pattern.source, pattern.flags.replace('g', ''));
}

function global_regex(pattern: RegExp): RegExp {
	const flags = pattern.flags.includes('g')
		? pattern.flags
		: `${pattern.flags}g`;
	return new RegExp(pattern.source, flags);
}

function line_number_at(content: string, index: number): number {
	return content.slice(0, index).split('\n').length;
}

import { describe, expect, it } from 'vitest';
import { detect_secrets } from './redaction.js';

describe('detect_secrets', () => {
	it('detects AWS access keys', () => {
		const hits = detect_secrets('AKIAIOSFODNN7EXAMPLE');
		expect(hits).toHaveLength(1);
		expect(hits[0].pattern.name).toBe('AWS Access Key');
	});

	it('detects bearer tokens', () => {
		const hits = detect_secrets(
			'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
		);
		expect(hits).toHaveLength(1);
		expect(hits[0].pattern.name).toBe('Bearer Token');
	});

	it('detects OpenAI/Anthropic API keys', () => {
		const hits = detect_secrets(
			'ANTHROPIC_API_KEY=sk-ant-api03-abcdefghij1234567890',
		);
		expect(
			hits.some((h) => h.pattern.name === 'OpenAI/Anthropic API Key'),
		).toBe(true);
	});

	it('detects connection strings with passwords', () => {
		const hits = detect_secrets(
			'DATABASE_URL=postgres://user:password123@localhost:5432/mydb',
		);
		expect(
			hits.some(
				(h) => h.pattern.name === 'Connection String with Password',
			),
		).toBe(true);
	});

	it('detects private key blocks', () => {
		const hits = detect_secrets('-----BEGIN RSA PRIVATE KEY-----');
		expect(hits).toHaveLength(1);
		expect(hits[0].pattern.name).toBe('Private Key');
	});

	it('detects stripe live keys', () => {
		const hits = detect_secrets('sk_live_' + 'x'.repeat(24));
		expect(
			hits.some((h) => h.pattern.name === 'Stripe Live Key'),
		).toBe(true);
	});

	it('detects hetzner tokens with context', () => {
		const hex64 = 'a'.repeat(64);
		const hits = detect_secrets(`HCLOUD_TOKEN=${hex64}`);
		expect(hits.some((h) => h.pattern.name === 'Hetzner Token')).toBe(
			true,
		);
	});

	it('detects Google Cloud API keys', () => {
		const hits = detect_secrets(
			'GOOGLE_API_KEY=AIza' + 'A'.repeat(35),
		);
		expect(
			hits.some((h) => h.pattern.name === 'Google API Key'),
		).toBe(true);
	});

	it('detects Google OAuth tokens', () => {
		const hits = detect_secrets(
			'CLOUDSDK_AUTH_ACCESS_TOKEN=ya29.' + 'a'.repeat(24),
		);
		expect(
			hits.some((h) => h.pattern.name === 'Google OAuth Token'),
		).toBe(true);
	});

	it('detects Azure credential environment variables', () => {
		const hits = detect_secrets(
			'ARM_CLIENT_SECRET=' + 'x'.repeat(24),
		);
		expect(
			hits.some((h) => h.pattern.name === 'Azure Credential'),
		).toBe(true);
	});

	it('detects Azure storage account keys', () => {
		const hits = detect_secrets(
			'DefaultEndpointsProtocol=https;AccountKey=' + 'A'.repeat(44),
		);
		expect(
			hits.some(
				(h) => h.pattern.name === 'Azure Storage Account Key',
			),
		).toBe(true);
	});

	it('detects AWS temp access keys', () => {
		const hits = detect_secrets(
			'AWS_ACCESS_KEY_ID=ASIA' + 'A'.repeat(16),
		);
		expect(
			hits.some((h) => h.pattern.name === 'AWS Temp Access Key'),
		).toBe(true);
	});

	it('detects common AWS secret key assignment variants', () => {
		const uppercase_hits = detect_secrets(
			'AWS_SECRET_ACCESS_KEY=' + 'A'.repeat(40),
		);
		const lowercase_hits = detect_secrets(
			'secret_access_key = "' + 'A'.repeat(40) + '"',
		);
		expect(
			uppercase_hits.some((h) => h.pattern.name === 'AWS Secret Key'),
		).toBe(true);
		expect(
			lowercase_hits.some((h) => h.pattern.name === 'AWS Secret Key'),
		).toBe(true);
	});

	it('detects GitHub token variants', () => {
		const hits = detect_secrets('github_pat_' + 'A'.repeat(30));
		expect(
			hits.some((h) => h.pattern.name === 'GitHub Fine-grained PAT'),
		).toBe(true);
	});

	it('detects provider API key formats', () => {
		const content = [
			'TAVILY_API_KEY=tvly-' + 'A'.repeat(24),
			'BRAVE_API_KEY=BSA' + 'A'.repeat(21),
			'FIRECRAWL_API_KEY=fc-' + 'a'.repeat(32),
			'KAGI_API_KEY=' + 'A'.repeat(40) + '.' + 'B'.repeat(40),
		].join('\n');
		const names = detect_secrets(content).map((h) => h.pattern.name);
		expect(names).toContain('Tavily API Key');
		expect(names).toContain('Brave API Key');
		expect(names).toContain('Firecrawl API Key');
		expect(names).toContain('Kagi API Key');
	});

	it('detects generic API key assignments', () => {
		const hits = detect_secrets('API_KEY=EXAMPLEVALUE123456');
		expect(
			hits.some((h) => h.pattern.name === 'Generic Password Field'),
		).toBe(true);
	});

	it('detects full multiline private key blocks once at the start line', () => {
		const hits = detect_secrets(
			[
				'clean',
				'-----BEGIN RSA PRIVATE KEY-----',
				'A'.repeat(64),
				'-----END RSA PRIVATE KEY-----',
			].join('\n'),
		);
		const private_key_hits = hits.filter(
			(h) => h.pattern.name === 'Private Key',
		);
		expect(private_key_hits).toHaveLength(1);
		expect(private_key_hits[0].line).toBe(2);
	});

	it('detects freeform secret phrases in logs', () => {
		const hits = detect_secrets(
			['opaque fallback', 'secret', 'EXAMPLEVALUE123456'].join(' '),
		);
		expect(
			hits.some((h) => h.pattern.name === 'Generic Secret Phrase'),
		).toBe(true);
	});

	it('does not false-positive on bare SHA256 hashes', () => {
		const sha =
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
		const hits = detect_secrets(`integrity: ${sha}`);
		expect(hits.some((h) => h.pattern.name === 'Hetzner Token')).toBe(
			false,
		);
	});

	it('returns empty for clean content', () => {
		const hits = detect_secrets(
			'NODE_ENV=production\nPORT=3000\nDEBUG=false',
		);
		expect(hits).toHaveLength(0);
	});

	it('reports correct line numbers', () => {
		const hits = detect_secrets(
			'clean line\nAKIAIOSFODNN7EXAMPLE\nanother clean',
		);
		expect(hits[0].line).toBe(2);
	});
});

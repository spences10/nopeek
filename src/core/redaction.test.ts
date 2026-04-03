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

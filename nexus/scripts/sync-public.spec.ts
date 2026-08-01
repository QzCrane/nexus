import { describe, expect, test } from 'bun:test';
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { validatePublicMarkdownLinks } from './sync-public.ts';

function withPublicFixture(run: (root: string) => void) {
	const root = mkdtempSync(resolve(tmpdir(), 'nexus-public-markdown-'));
	try {
		run(root);
	} finally {
		rmSync(root, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
	}
}

describe('public Markdown projection', () => {
	test('accepts relative links that remain inside the generated repository', () => {
		withPublicFixture((root) => {
			mkdirSync(resolve(root, 'docs'));
			writeFileSync(
				resolve(root, 'README.md'),
				'[Privacy](PRIVACY.md)\n[Docs][docs]\n\n[docs]: docs/README.md\n',
			);
			writeFileSync(resolve(root, 'PRIVACY.md'), '# Privacy\n');
			writeFileSync(resolve(root, 'docs', 'README.md'), '# Docs\n');

			expect(() => validatePublicMarkdownLinks(root)).not.toThrow();
		});
	});

	test('rejects links to excluded or escaping files before publication', () => {
		withPublicFixture((root) => {
			mkdirSync(resolve(root, 'apps', 'extension-halo'), { recursive: true });
			writeFileSync(
				resolve(root, 'apps', 'extension-halo', 'README.md'),
				'[Architecture](../../docs/architecture.md)\n[Outside](../../../private.md)\n',
			);

			expect(() => validatePublicMarkdownLinks(root)).toThrow(
				'Generated public Markdown contains broken relative links',
			);
		});
	});
});

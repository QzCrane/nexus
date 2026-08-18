import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	findReleaseSourceGraphViolations,
} from '../check-release-source-graph';

describe('HALO production source graph admission', () => {
	test('reaches no catalog-only tool/script/system implementation from production roots', () => {
		expect(findReleaseSourceGraphViolations()).toEqual([]);
	});

	test('keeps the former Clipboard background leak physically absent', () => {
		const background = readFileSync(
			new URL('../src/entry/background.ts', import.meta.url),
			'utf8',
		);
		expect(background).not.toContain("../tools/clipboard/core");
		expect(background).not.toContain('HALO_CLIPBOARD_ADD');
	});

	test('covers literal dynamic imports and CommonJS require as graph edges', () => {
		const source = readFileSync(
			new URL('../check-release-source-graph.ts', import.meta.url),
			'utf8',
		);
		expect(source).toContain('ts.SyntaxKind.ImportKeyword');
		expect(source).toContain("node.expression.text === 'require'");
		expect(source).toContain("/^src\\/(tools|scripts|system)\\/([^/]+)/");
	});
});

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('background v2 listener ownership', () => {
	test('command listener cannot claim unrelated spectra.tab requests', () => {
		const source = readFileSync(
			resolve(import.meta.dir, '../src/background/handlers/commands.ts'),
			'utf8',
		);
		expect(source).not.toContain("candidate.type.startsWith('spectra.tab.')");
		expect(source).toContain("'spectra.tab.pinned.toggle'");
		expect(source).toContain("'spectra.tab.muted.toggle'");
		expect(source).toContain("'spectra.ui.open'");
		expect(source).not.toContain("'spectra.tab.visible.list',");
	});
});

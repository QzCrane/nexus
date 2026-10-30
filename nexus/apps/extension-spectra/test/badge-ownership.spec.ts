import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';

// The Action badge is a projection of acknowledged state, and a projection with
// two writers has no truth: whichever call happens to reach Chrome last wins.
// The Popup used to paint it from the card's own render, carrying the card's own
// mute flag, so a render that raced an unmute ACK could repaint "M" over the
// acknowledged value and leave it there. Nothing but the Background handler may
// write it.
const appDir = resolve(import.meta.dir, '..');
const BADGE_OWNER = 'src/background/handlers/badge.ts';

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')
			? [path]
			: [];
	});
}

describe('Action badge ownership', () => {
	test('only the Background badge handler writes the Action badge', () => {
		const writers = sourceFiles(resolve(appDir, 'src'))
			.filter((path) => /\bsetBadgeText\s*\(/u.test(readFileSync(path, 'utf8')))
			.map((path) => relative(appDir, path).replaceAll('\\', '/'))
			.sort();

		expect(writers).toEqual([BADGE_OWNER]);
	});
});

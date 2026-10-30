import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { injectFrameHeightKey } from '../scripts/frame-reserve-key';
import { resolveFrameTarget } from '../src/popup/frame-height';
import {
	FRAME_HEIGHT_KEY,
	FRAME_HEIGHT_KEY_PLACEHOLDER,
} from '../src/popup/constants/frame-height';

// The frame is the one size the user cannot help but compare across opens: two
// opens of the same content must land on the same height, and a shorter open
// must not inherit a taller one's. These are the rule's three states, none of
// which needs a browser to pin.
describe('popup frame target', () => {
	test('follows the content once the inventory has published', () => {
		expect(resolveFrameTarget(352, true, null)).toBe(352);
	});

	test('drops a stale prediction when the inventory publishes', () => {
		// The regression: a tall open persists 600, the next open's content is 352,
		// and keeping the prediction leaves 248px of blank under the only card.
		expect(resolveFrameTarget(352, true, 600)).toBe(352);
	});

	test('holds the prediction as a floor only while the inventory is pending', () => {
		// Before the inventory answers, a half-populated measurement must not be
		// allowed to shrink the window back through itself.
		expect(resolveFrameTarget(352, false, 600)).toBe(600);
		expect(resolveFrameTarget(352, false, null)).toBe(352);
	});

	test('never past the height Chrome grants the Action Popup', () => {
		expect(resolveFrameTarget(675.38, true, null)).toBe(600);
		expect(resolveFrameTarget(675.38, false, 600)).toBe(600);
	});
});

describe('popup frame height key', () => {
	test('the head script carries a placeholder, not a key of its own', () => {
		const source = readFileSync(
			resolve(import.meta.dir, '../public/frame-reserve.js'),
			'utf8',
		);
		expect(source).toContain(FRAME_HEIGHT_KEY_PLACEHOLDER);
		// With the placeholder taken out, no key may remain. A literal one would
		// be a second definition of the same string, and nothing would keep the
		// two in step once either changed.
		expect(source.replaceAll(FRAME_HEIGHT_KEY_PLACEHOLDER, '')).not.toContain(FRAME_HEIGHT_KEY);
	});

	test('the build writes the key the Popup module persists under', () => {
		const source = readFileSync(
			resolve(import.meta.dir, '../public/frame-reserve.js'),
			'utf8',
		);
		const built = injectFrameHeightKey(source);
		expect(built).toContain(FRAME_HEIGHT_KEY);
		expect(built).not.toContain(FRAME_HEIGHT_KEY_PLACEHOLDER);
	});

	test('a head script without the placeholder fails the build', () => {
		// The silent failure this prevents: a head script that reads its own key
		// would reserve a height the Popup module never persists, and every open
		// would jump again with nothing to point at the cause.
		expect(() => injectFrameHeightKey('const key = "spectra.popup.frameHeight";')).toThrow();
	});
});

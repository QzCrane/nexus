import { describe, expect, test } from 'bun:test';
import { resolveFrameTarget } from '../src/popup/frame-height';

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

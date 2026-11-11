// goal: a document that attached a live stream holds controllable media before playback
import { describe, expect, test } from 'bun:test';
import { hasPlayableMedia } from '../src/shared/media-presence';

interface MediaShape {
	readyState: number;
	currentTime: number;
	played: { length: number };
	srcObject: { getTracks(): unknown[] } | null;
}

function rootOf(...media: MediaShape[]): ParentNode {
	return { querySelectorAll: () => media } as unknown as ParentNode;
}

function media(overrides: Partial<MediaShape> = {}): MediaShape {
	return { readyState: 0, currentTime: 0, played: { length: 0 }, srcObject: null, ...overrides };
}

describe('hasPlayableMedia', () => {
	test('admits a player whose live stream is attached before playback starts', () => {
		// A live route sets `srcObject` and may keep the element at HAVE_NOTHING
		// until the first gesture. The tracks already exist, so the document holds
		// media the native controls address; the observation runtime must load now,
		// not after the viewer plays once.
		const stream = media({ srcObject: { getTracks: () => [{ kind: 'video' }] } });
		expect(hasPlayableMedia(rootOf(stream))).toBe(true);
	});

	test('keeps markup shells and empty streams out', () => {
		expect(hasPlayableMedia(rootOf(media()))).toBe(false);
		expect(hasPlayableMedia(rootOf(media({ srcObject: { getTracks: () => [] } })))).toBe(false);
	});

	test('keeps the loaded-source and paused-after-swap evidence', () => {
		expect(hasPlayableMedia(rootOf(media({ readyState: 1 })))).toBe(true);
		expect(hasPlayableMedia(rootOf(media({ currentTime: 12 })))).toBe(true);
		expect(hasPlayableMedia(rootOf(media({ played: { length: 1 } })))).toBe(true);
	});
});

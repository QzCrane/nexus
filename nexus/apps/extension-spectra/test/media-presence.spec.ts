// goal: a document that assigned a source holds controllable media before playback
import { describe, expect, test } from 'bun:test';
import { hasMediaSurface } from '../src/shared/media-presence';

interface MediaShape {
	readyState: number;
	currentTime: number;
	played: { length: number };
	srcObject: { getTracks(): unknown[] } | null;
	currentSrc?: string;
	src?: string;
}

function rootOf(...media: MediaShape[]): ParentNode {
	return { querySelectorAll: () => media } as unknown as ParentNode;
}

function media(overrides: Partial<MediaShape> = {}): MediaShape {
	return { readyState: 0, currentTime: 0, played: { length: 0 }, srcObject: null, ...overrides };
}

describe('hasMediaSurface', () => {
	test('admits a player whose live stream is attached before playback starts', () => {
		// A live route sets `srcObject` and may keep the element at HAVE_NOTHING
		// until the first gesture. The tracks already exist, so the document holds
		// media the native controls address; the observation runtime must load now,
		// not after the viewer plays once.
		const stream = media({ srcObject: { getTracks: () => [{ kind: 'video' }] } });
		expect(hasMediaSurface(rootOf(stream))).toBe(true);
	});

	test('admits a configured player whose metadata has not arrived', () => {
		// An SPA inserts the player and assigns a blob/MSE source; metadata and the
		// first gesture come later. The volume control already addresses it.
		expect(hasMediaSurface(rootOf(media({ src: 'blob:https://live.example/abc' })))).toBe(true);
		expect(hasMediaSurface(rootOf(media({ currentSrc: 'https://cdn.example/live.m3u8' })))).toBe(true);
	});

	test('keeps bare markup shells and empty streams out', () => {
		expect(hasMediaSurface(rootOf(media()))).toBe(false);
		expect(hasMediaSurface(rootOf(media({ srcObject: { getTracks: () => [] } })))).toBe(false);
	});

	test('keeps the loaded-source and paused-after-swap evidence', () => {
		expect(hasMediaSurface(rootOf(media({ readyState: 1 })))).toBe(true);
		expect(hasMediaSurface(rootOf(media({ currentTime: 12 })))).toBe(true);
		expect(hasMediaSurface(rootOf(media({ played: { length: 1 } })))).toBe(true);
	});
});

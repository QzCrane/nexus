// goal: pin the live-presentation definition to facts a browser cannot fake — an
// unbounded duration plus a presentation that actually carries media — so "live"
// is a measurement and never a guess
import { describe, expect, test } from 'bun:test';
import { isLiveMedia, isLiveUnsupportedField } from '../src/shared/media-live';

function media(shape: {
	duration: number;
	readyState?: number;
	buffered?: number;
	paused?: boolean;
	stream?: boolean;
}): HTMLMediaElement {
	return {
		duration: shape.duration,
		readyState: shape.readyState ?? 4,
		buffered: { length: shape.buffered ?? 1 } as TimeRanges,
		srcObject: shape.stream ? { getTracks: () => [] } : null,
		paused: shape.paused ?? false,
	} as unknown as HTMLMediaElement;
}

describe('live media detection', () => {
	test('an unbounded duration with buffered media is live, whatever else it reports', () => {
		expect(isLiveMedia(media({ duration: Number.POSITIVE_INFINITY, buffered: 1 }))).toBe(true);
		expect(isLiveMedia(media({ duration: Number.POSITIVE_INFINITY, buffered: 3 }))).toBe(true);
		expect(isLiveMedia(media({ duration: Number.POSITIVE_INFINITY, paused: true }))).toBe(true);
		expect(isLiveMedia(media({ duration: Number.POSITIVE_INFINITY, readyState: 2 }))).toBe(true);
	});

	test('an unbounded duration with nothing buffered is a broken resource, not a broadcast', () => {
		// A zero-sample file or a stub element also reports Infinity, and it still
		// accepts a rate. Refusing speed there removed a control the page honours.
		expect(isLiveMedia(media({ duration: Number.POSITIVE_INFINITY, buffered: 0 }))).toBe(false);
		expect(isLiveMedia(media({ duration: Number.POSITIVE_INFINITY, buffered: 0, readyState: 4 }))).toBe(false);
		// A `MediaStream` has no ranges by definition and is still a live feed.
		expect(isLiveMedia(media({ duration: Number.POSITIVE_INFINITY, buffered: 0, stream: true }))).toBe(true);
	});

	test('an unknown duration is not proof of a live presentation', () => {
		// Metadata that has not settled reports NaN on ordinary videos. Treating
		// that as live removed a speed control the page could honour.
		expect(isLiveMedia(media({ duration: Number.NaN, readyState: 2, buffered: 0 }))).toBe(false);
		expect(isLiveMedia(media({ duration: Number.NaN, readyState: 0, buffered: 0 }))).toBe(false);
		expect(isLiveMedia(media({ duration: Number.NaN, readyState: 4, buffered: 0 }))).toBe(false);
	});

	test('a finite timeline is on demand', () => {
		expect(isLiveMedia(media({ duration: 120 }))).toBe(false);
		expect(isLiveMedia(media({ duration: 0, buffered: 0 }))).toBe(false);
		expect(isLiveMedia(media({ duration: 8, buffered: 0 }))).toBe(false);
	});

	test('only a field the timeline owns is withheld', () => {
		expect(isLiveUnsupportedField('speed')).toBe(true);
		expect(isLiveUnsupportedField('volumeBase')).toBe(false);
		expect(isLiveUnsupportedField('mediaMuted')).toBe(false);
		expect(isLiveUnsupportedField('currentTime')).toBe(false);
	});
});

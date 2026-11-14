// goal: prove the site-native control projection is a no-op without a control
//       and converges on the site's own level when one exists
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
	projectSiteNativePlayback,
	projectSiteNativeVolume,
	readSiteNativeVolumeLevel,
} from '../src/content/logic/site-native-control-surface';

type FakeInput = { type: string; clientX: number; clientY: number; buttons: number };

class FakeMouseEvent {
	type: string;
	clientX = 0;
	clientY = 0;
	buttons = 0;
	constructor(type: string, init: Record<string, unknown>) {
		this.type = type;
		Object.assign(this, init);
	}
}

class FakeBar {
	width = 43.5;
	getBoundingClientRect(): { width: number; height: number } {
		return { width: this.width, height: 4 };
	}
	dispatchEvent(): boolean { return true; }
}

class FakeTrack {
	childElementCount = 1;
	bar = new FakeBar();
	level = 0.5;
	media: FakeMedia;
	dispatched: FakeInput[] = [];
	writesMirror = true;
	constructor(media: FakeMedia) { this.media = media; }
	getBoundingClientRect(): Record<string, number> {
		return { x: 0, y: 0, left: 0, top: 0, width: 90, height: 12, right: 90, bottom: 12 };
	}
	querySelector(selector: string): unknown {
		return selector.includes('bar') ? this.bar : null;
	}
	querySelectorAll(selector: string): unknown[] {
		return selector.includes('bar') ? [this.bar] : [];
	}
	dispatchEvent(event: FakeInput): boolean {
		this.dispatched.push(event);
		// The player offsets the click by its handle radius and writes the level
		// to its own bar and to the media element's mirror.
		const ratio = Math.max(0, Math.min(1, event.clientX / 90));
		this.level = Math.max(0, Math.min(0.944, ratio - 0.02));
		this.bar.width = this.level * 90;
		if (this.writesMirror) this.media.volume = this.level;
		return true;
	}
}

class FakePlayButton {
	media: FakeMedia;
	clicks = 0;
	get className(): string { return this.media.paused ? 'player-play-btn' : 'player-pause-btn'; }
	getAttribute(): string | null { return null; }
	constructor(media: FakeMedia) { this.media = media; }
	getBoundingClientRect(): Record<string, number> {
		return { x: 0, y: 0, left: 0, top: 0, width: 24, height: 24, right: 24, bottom: 24 };
	}
	dispatchEvent(): boolean {
		this.clicks += 1;
		this.media.paused = !this.media.paused;
		return true;
	}
}

class FakeMedia {
	volume = 0.5;
	muted = false;
	paused = false;
	parentElement: FakeContainer | null = null;
}

class FakeContainer {
	track: FakeTrack | null = null;
	playButton: FakePlayButton | null = null;
	querySelector(selector: string): unknown {
		if (selector.includes('sound-progress') || selector.includes('volume-progress')
			|| selector.includes('volume-track') || selector.includes('volume-slider')
			|| selector.includes('role="slider"')) return this.track;
		if (selector.includes('player-pause') || selector.includes('player-play')
			|| selector.includes('title*="暂停"') || selector.includes('title*="播放"')
			|| selector.includes('开始观看') || selector.includes('aria-label*="Pause"')
			|| selector.includes('aria-label*="Play"')) return this.playButton;
		return null;
	}
	querySelectorAll(selector: string): unknown[] {
		const found = this.querySelector(selector);
		return found ? [found] : [];
	}
}

const originals: Record<string, unknown> = {};
for (const key of ['document', 'MouseEvent']) {
	originals[key] = (globalThis as unknown as Record<string, unknown>)[key];
}

function install(): void {
	(globalThis as unknown as Record<string, unknown>).MouseEvent = FakeMouseEvent;
	(globalThis as unknown as Record<string, unknown>).document = {
		querySelector: () => null,
		querySelectorAll: () => [],
		dispatchEvent: () => true,
	};
}

afterEach(() => {
	for (const [key, value] of Object.entries(originals)) {
		(globalThis as unknown as Record<string, unknown>)[key] = value;
	}
});

describe('site-native control projection', () => {
	beforeEach(() => {
		(globalThis as unknown as Record<string, unknown>).document = undefined;
		(globalThis as unknown as Record<string, unknown>).MouseEvent = undefined;
	});

	test('is a complete no-op when the page exposes no native control', async () => {
		const media = new FakeMedia();
		media.parentElement = null;
		expect(projectSiteNativePlayback(media as unknown as HTMLMediaElement, false)).toBe(false);
		expect(await projectSiteNativeVolume(media as unknown as HTMLMediaElement, 70)).toBeNull();
		expect(readSiteNativeVolumeLevel(media as unknown as HTMLMediaElement)).toBeNull();
	});

	test('does not throw when document has no querySelectorAll', () => {
		const media = new FakeMedia();
		media.parentElement = new FakeContainer();
		install();
		(globalThis as unknown as Record<string, unknown>).document = {
			dispatchEvent: () => true,
		};
		expect(projectSiteNativePlayback(media as unknown as HTMLMediaElement, false)).toBe(false);
	});

	test('clicks the site play/pause button instead of writing a vetoed DOM pause', () => {
		const media = new FakeMedia();
		const container = new FakeContainer();
		container.playButton = new FakePlayButton(media);
		media.parentElement = container;
		install();
		expect(projectSiteNativePlayback(media as unknown as HTMLMediaElement, false)).toBe(true);
		expect(media.paused).toBe(true);
		expect(container.playButton.clicks).toBe(1);
		// A second request for the same state must not click again.
		expect(projectSiteNativePlayback(media as unknown as HTMLMediaElement, false)).toBe(true);
		expect(container.playButton.clicks).toBe(1);
	});

	test('calibrates the site slider to the requested level and aligns the element mirror', async () => {
		const media = new FakeMedia();
		const container = new FakeContainer();
		container.track = new FakeTrack(media);
		media.parentElement = container;
		install();
		const level = await projectSiteNativeVolume(media as unknown as HTMLMediaElement, 70);
		expect(level).not.toBeNull();
		expect(level ?? 0).toBeGreaterThanOrEqual(68);
		expect(level ?? 0).toBeLessThanOrEqual(70);
		expect(media.volume).toBeCloseTo((level ?? 70) / 100, 2);
		expect(container.track.bar.width).toBeCloseTo((level ?? 70) * 0.9, 0);
		expect(readSiteNativeVolumeLevel(media as unknown as HTMLMediaElement)).toBe(level);
		// Each pass drives the site's own control, never the DOM property first.
		expect(container.track.dispatched.length).toBeGreaterThan(0);
	});

	test('leaves the DOM mirror to the single canonical media writer', async () => {
		const media = new FakeMedia();
		const container = new FakeContainer();
		const track = new FakeTrack(media);
		track.writesMirror = false;
		container.track = track;
		media.parentElement = container;
		install();
		const level = await projectSiteNativeVolume(media as unknown as HTMLMediaElement, 70);
		expect(level ?? 0).toBeGreaterThanOrEqual(68);
		expect(track.bar.width).toBeGreaterThan(60);
		// A paused player may move its bar without refreshing the mirror. The
		// projection must not become a second volume writer to compensate.
		expect(media.volume).toBe(0.5);
	});
});

import { afterEach, describe, expect, test } from 'bun:test';
import { VideoEffectsController } from '../src/content/video/video-effects-controller';

class FakeStyle {
	private readonly values = new Map<string, string>();
	private readonly priorities = new Map<string, string>();
	setProperty(name: string, value: string, priority = ''): void {
		this.values.set(name, value);
		this.priorities.set(name, priority);
	}
	removeProperty(name: string): string {
		const value = this.values.get(name) ?? '';
		this.values.delete(name);
		this.priorities.delete(name);
		return value;
	}
	getPropertyValue(name: string): string { return this.values.get(name) ?? ''; }
	getPropertyPriority(name: string): string { return this.priorities.get(name) ?? ''; }
}

class FakeVideo {
	readonly style = new FakeStyle();
	readonly attributes = new Map<string, string>();
	clientWidth = 640;
	clientHeight = 360;
	toggleAttribute(name: string, force?: boolean): boolean {
		const enabled = force ?? !this.attributes.has(name);
		if (enabled) this.attributes.set(name, '');
		else this.attributes.delete(name);
		return enabled;
	}
	setAttribute(name: string, value = ''): void { this.attributes.set(name, value); }
	getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
	removeAttribute(name: string): void { this.attributes.delete(name); }
	hasAttribute(name: string): boolean { return this.attributes.has(name); }
}

class FakeStyleElement {
	readonly dataset: Record<string, string> = {};
	textContent = '';
	isConnected = false;
	remove(): void { this.isConnected = false; }
}

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalVideo = Object.getOwnPropertyDescriptor(globalThis, 'HTMLVideoElement');
const originalComputed = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
const originalResizeObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

afterEach(() => {
	restore('document', originalDocument);
	restore('HTMLVideoElement', originalVideo);
	restore('getComputedStyle', originalComputed);
	restore('ResizeObserver', originalResizeObserver);
	restore('window', originalWindow);
});

describe('extension-owned video effect release', () => {
	test('leaves page-authored owner names untouched for a never-owned neutral write', async () => {
		Object.defineProperty(globalThis, 'HTMLVideoElement', {
			configurable: true,
			value: FakeVideo,
		});
		Object.defineProperty(globalThis, 'window', {
			configurable: true,
			value: { addEventListener: () => undefined, removeEventListener: () => undefined },
		});
		Object.defineProperty(globalThis, 'document', {
			configurable: true,
			value: { removeEventListener: () => undefined },
		});
		const video = new FakeVideo() as unknown as HTMLVideoElement;
		video.setAttribute('data-spectra-rotate', 'page');
		video.style.setProperty('--spectra-rotate', '13deg', 'important');
		const controller = new VideoEffectsController();

		try {
			await controller.apply(video, 'rotation', 0);
			await controller.apply(video, 'dimEnabled', false);
			expect(video.hasAttribute('data-spectra-rotate')).toBe(true);
			expect(video.style.getPropertyValue('--spectra-rotate')).toBe('13deg');
			expect(video.style.getPropertyPriority('--spectra-rotate')).toBe('important');
		} finally {
			controller.dispose();
		}
	});

	test('removes every owner attribute and CSS variable when an effect returns to native presentation', async () => {
		Object.defineProperty(globalThis, 'HTMLVideoElement', {
			configurable: true,
			value: FakeVideo,
		});
		Object.defineProperty(globalThis, 'ResizeObserver', {
			configurable: true,
			value: class {
				observe(): void { }
				unobserve(): void { }
				disconnect(): void { }
			},
		});
		Object.defineProperty(globalThis, 'window', {
			configurable: true,
			value: { addEventListener: () => undefined, removeEventListener: () => undefined },
		});
		const head = {
			appendChild: (element: FakeStyleElement) => { element.isConnected = true; },
		};
		Object.defineProperty(globalThis, 'document', {
			configurable: true,
			value: {
				head,
				documentElement: head,
				createElement: () => new FakeStyleElement(),
				addEventListener: () => undefined,
				removeEventListener: () => undefined,
			},
		});
		Object.defineProperty(globalThis, 'getComputedStyle', {
			configurable: true,
			value: (video: FakeVideo) => ({
				objectFit: video.hasAttribute('data-spectra-fill') ? 'cover' : 'contain',
				rotate: video.hasAttribute('data-spectra-rotate')
					? video.style.getPropertyValue('--spectra-rotate')
					: 'none',
				scale: video.hasAttribute('data-spectra-scale')
					? `${video.style.getPropertyValue('--spectra-scale-x')} ${video.style.getPropertyValue('--spectra-scale-y')}`
					: 'none',
				filter: video.hasAttribute('data-spectra-filter')
					? video.style.getPropertyValue('--spectra-filter')
					: 'brightness(90%)',
			}),
		});

		const controller = new VideoEffectsController();
		const video = new FakeVideo() as unknown as HTMLVideoElement;
		try {
			await controller.apply(video, 'rotation', 90);
			await controller.apply(video, 'rotation', 0);
			expect(video.hasAttribute('data-spectra-rotate')).toBe(false);
			expect(video.hasAttribute('data-spectra-scale')).toBe(false);
			expect(video.style.getPropertyValue('--spectra-rotate')).toBe('');
			expect(video.style.getPropertyValue('--spectra-scale-x')).toBe('');

			await controller.apply(video, 'mirrored', true);
			await controller.apply(video, 'mirrored', false);
			expect(video.hasAttribute('data-spectra-scale')).toBe(false);
			expect(video.style.getPropertyValue('--spectra-scale-y')).toBe('');

			await controller.apply(video, 'fill', true);
			await controller.apply(video, 'fill', false);
			expect(video.hasAttribute('data-spectra-fill')).toBe(false);

			await controller.apply(video, 'filterEnabled', true);
			await controller.apply(video, 'filterEnabled', false);
			expect(video.hasAttribute('data-spectra-filter')).toBe(false);
			expect(video.style.getPropertyValue('--spectra-filter')).toBe('');
		} finally {
			controller.dispose();
		}
	});
});

function restore(key: string, descriptor?: PropertyDescriptor): void {
	if (descriptor) Object.defineProperty(globalThis, key, descriptor);
	else Reflect.deleteProperty(globalThis, key);
}

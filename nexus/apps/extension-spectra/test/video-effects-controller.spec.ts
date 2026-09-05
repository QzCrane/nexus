import { afterEach, describe, expect, test } from 'bun:test';
import { VideoEffectsController } from '../src/content/video/video-effects-controller';

class FakeStyle {
	private readonly values = new Map<string, string>();
	private readonly priorities = new Map<string, string>();
	cssText = '';
	left = '';
	top = '';
	width = '';
	height = '';
	opacity = '';
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
	getBoundingClientRect(): DOMRect {
		return {
			top: 90,
			left: 160,
			right: 800,
			bottom: 450,
			width: 640,
			height: 360,
			x: 160,
			y: 90,
			toJSON: () => ({}),
		} as DOMRect;
	}
}

class FakeDomElement {
	readonly dataset: Record<string, string> = {};
	readonly style = new FakeStyle();
	readonly children: FakeDomElement[] = [];
	textContent = '';
	isConnected = false;
	parentElement: FakeDomElement | null = null;
	clientWidth = 1280;
	clientHeight = 720;
	appendChild(element: FakeDomElement): FakeDomElement {
		if (element.parentElement && element.parentElement !== this) {
			element.parentElement.children.splice(element.parentElement.children.indexOf(element), 1);
		}
		element.parentElement = this;
		element.isConnected = true;
		if (!this.children.includes(element)) this.children.push(element);
		return element;
	}
	attachShadow(): FakeDomElement { return new FakeDomElement(); }
	contains(element: unknown): boolean {
		return this.children.includes(element as FakeDomElement)
			|| this.children.some((child) => child.contains(element));
	}
	remove(): void {
		if (this.parentElement) {
			const index = this.parentElement.children.indexOf(this);
			if (index >= 0) this.parentElement.children.splice(index, 1);
		}
		this.parentElement = null;
		this.isConnected = false;
	}
}

class FakeStyleElement extends FakeDomElement { }

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalVideo = Object.getOwnPropertyDescriptor(globalThis, 'HTMLVideoElement');
const originalElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
const originalComputed = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
const originalResizeObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalRequestAnimationFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
const originalCancelAnimationFrame = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');

afterEach(() => {
	restore('document', originalDocument);
	restore('HTMLVideoElement', originalVideo);
	restore('HTMLElement', originalElement);
	restore('getComputedStyle', originalComputed);
	restore('ResizeObserver', originalResizeObserver);
	restore('window', originalWindow);
	restore('requestAnimationFrame', originalRequestAnimationFrame);
	restore('cancelAnimationFrame', originalCancelAnimationFrame);
});

function installEffectDom(
	computedStyle: (video: FakeVideo) => Record<string, string>,
): FakeDomElement {
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
		value: {
			visualViewport: undefined,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
		},
	});
	const root = new FakeDomElement();
	root.isConnected = true;
	Object.defineProperty(globalThis, 'document', {
		configurable: true,
		value: {
			head: root,
			documentElement: root,
			fullscreenElement: null,
			createElement: (tag: string) => tag === 'style'
				? new FakeStyleElement()
				: new FakeDomElement(),
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
		},
	});
	Object.defineProperty(globalThis, 'getComputedStyle', {
		configurable: true,
		value: (video: FakeVideo) => computedStyle(video),
	});
	return root;
}

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

	test('preserves independent CSS effects when the dim target changes', async () => {
		Object.defineProperty(globalThis, 'HTMLVideoElement', {
			configurable: true,
			value: FakeVideo,
		});
		Object.defineProperty(globalThis, 'HTMLElement', {
			configurable: true,
			value: FakeDomElement,
		});
		Object.defineProperty(globalThis, 'ResizeObserver', {
			configurable: true,
			value: class {
				observe(): void { }
				unobserve(): void { }
				disconnect(): void { }
			},
		});
		Object.defineProperty(globalThis, 'requestAnimationFrame', {
			configurable: true,
			value: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
		});
		Object.defineProperty(globalThis, 'cancelAnimationFrame', {
			configurable: true,
			value: (id: number) => clearTimeout(id),
		});
		Object.defineProperty(globalThis, 'window', {
			configurable: true,
			value: {
				visualViewport: undefined,
				addEventListener: () => undefined,
				removeEventListener: () => undefined,
			},
		});
		const root = new FakeDomElement();
		root.isConnected = true;
		Object.defineProperty(globalThis, 'document', {
			configurable: true,
			value: {
				head: root,
				documentElement: root,
				fullscreenElement: null,
				createElement: (tag: string) => tag === 'style'
					? new FakeStyleElement()
					: new FakeDomElement(),
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
				filter: 'none',
			}),
		});

		const controller = new VideoEffectsController();
		const first = new FakeVideo() as unknown as HTMLVideoElement;
		const second = new FakeVideo() as unknown as HTMLVideoElement;
		try {
			await controller.apply(first, 'rotation', 90);
			await controller.apply(first, 'dimEnabled', true);
			await controller.apply(second, 'dimEnabled', true);

			expect(controller.snapshot(first)).toMatchObject({
				rotation: 90,
				dimEnabled: false,
			});
			expect(first.hasAttribute('data-spectra-video-effects-owner')).toBe(true);
			expect(first.style.getPropertyValue('--spectra-rotate')).toBe('90deg');
			expect(controller.snapshot(second).dimEnabled).toBe(true);
		} finally {
			controller.dispose();
		}
	});

	test('retires source ownership without restoring the previous source baseline', async () => {
		installEffectDom((video) => ({
			objectFit: video.hasAttribute('data-spectra-fill') ? 'cover' : 'contain',
			rotate: video.hasAttribute('data-spectra-rotate')
				? video.style.getPropertyValue('--spectra-rotate')
				: 'none',
			scale: video.hasAttribute('data-spectra-scale')
				? `${video.style.getPropertyValue('--spectra-scale-x')} ${video.style.getPropertyValue('--spectra-scale-y')}`
				: 'none',
			filter: 'none',
		}));
		const controller = new VideoEffectsController();
		const video = new FakeVideo() as unknown as HTMLVideoElement;
		try {
			await controller.apply(video, 'rotation', 90);
			// The player has already authored source-B presentation while reusing the
			// same element. Source retirement must not restore source-A's 90deg value.
			video.style.setProperty('--spectra-rotate', '13deg', 'important');
			controller.retireSource(video);
			expect(video.style.getPropertyValue('--spectra-rotate')).toBe('13deg');
			expect(video.style.getPropertyPriority('--spectra-rotate')).toBe('important');
			expect(video.hasAttribute('data-spectra-video-effects-owner')).toBe(false);
			expect(controller.snapshot(video).rotation).toBe(0);
		} finally {
			controller.dispose();
		}
	});

	test('rolls back DOM ownership when CSS readback fails before apply commits', async () => {
		installEffectDom(() => ({
			objectFit: 'contain',
			rotate: 'none',
			scale: 'none',
			filter: 'none',
		}));
		const controller = new VideoEffectsController();
		const video = new FakeVideo() as unknown as HTMLVideoElement;
		try {
			await expect(controller.apply(video, 'rotation', 90)).rejects.toThrow(
				'Video transform computed-style readback failed',
			);
			expect(video.hasAttribute('data-spectra-video-effects-owner')).toBe(false);
			expect(video.hasAttribute('data-spectra-rotate')).toBe(false);
			expect(video.hasAttribute('data-spectra-scale')).toBe(false);
			expect(video.style.getPropertyValue('--spectra-rotate')).toBe('');
			expect(video.style.getPropertyValue('--spectra-scale-x')).toBe('');
			expect(controller.snapshot(video).rotation).toBe(0);
		} finally {
			controller.dispose();
		}
	});
});

function restore(key: string, descriptor?: PropertyDescriptor): void {
	if (descriptor) Object.defineProperty(globalThis, key, descriptor);
	else Reflect.deleteProperty(globalThis, key);
}

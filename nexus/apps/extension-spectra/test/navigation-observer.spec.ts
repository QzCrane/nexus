import { afterEach, describe, expect, mock, test } from 'bun:test';
import {
	createNavigationObserver,
	getDocumentRouteIdentity,
	SPECTRA_SAME_DOCUMENT_NAVIGATION_EVENT,
} from '../src/content/core/lifecycle/navigation-observer';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalHistory = Object.getOwnPropertyDescriptor(globalThis, 'history');
const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');

afterEach(() => {
	restoreProperty('window', originalWindow);
	restoreProperty('history', originalHistory);
	restoreProperty('chrome', originalChrome);
});

describe('SPA navigation observer', () => {
	test('uses the complete document route identity', () => {
		expect(getDocumentRouteIdentity({
			origin: 'https://media.example',
			pathname: '/watch',
			search: '?v=two',
			hash: '#chapter',
		})).toBe('https://media.example/watch?v=two#chapter');
	});

	test('invalidates query and hash routes immediately but ignores identical replacements', () => {
		const location = {
			origin: 'https://media.example',
			pathname: '/watch',
			search: '?v=one',
			hash: '',
		};
		const target = new EventTarget();
		Object.defineProperty(target, 'location', { configurable: true, value: location });
		Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: { runtime: { id: 'spectra-test' } },
		});

		const applyUrl = (url?: string | URL | null) => {
			if (url === undefined || url === null) return;
			const next = new URL(String(url), `${location.origin}${location.pathname}${location.search}${location.hash}`);
			location.origin = next.origin;
			location.pathname = next.pathname;
			location.search = next.search;
			location.hash = next.hash;
		};
		const history = {
			pushState: mock((_data: unknown, _unused: string, url?: string | URL | null) => applyUrl(url)),
			replaceState: mock((_data: unknown, _unused: string, url?: string | URL | null) => applyUrl(url)),
		};
		Object.defineProperty(globalThis, 'history', { configurable: true, value: history });

		const probeCors = mock(() => undefined);
		let generation = 7;
		const onNavigate = mock(() => { generation += 1; });
		const dispose = createNavigationObserver({
			policyExecutor: { probeCors } as never,
			onNavigate,
		});

		try {
			history.pushState({}, '', '/watch?v=two');
			expect(generation).toBe(8);
			expect(onNavigate).toHaveBeenCalledTimes(1);

			history.replaceState({}, '', '/watch?v=two');
			expect(onNavigate).toHaveBeenCalledTimes(1);

			location.hash = '#chapter';
			target.dispatchEvent(new Event(SPECTRA_SAME_DOCUMENT_NAVIGATION_EVENT));
			expect(generation).toBe(9);
			expect(onNavigate).toHaveBeenCalledTimes(2);
			expect(probeCors).toHaveBeenCalledTimes(2);
		} finally {
			dispose();
		}
	});
});

function restoreProperty(
	key: 'window' | 'history' | 'chrome',
	descriptor?: PropertyDescriptor,
): void {
	if (descriptor) Object.defineProperty(globalThis, key, descriptor);
	else Reflect.deleteProperty(globalThis, key);
}

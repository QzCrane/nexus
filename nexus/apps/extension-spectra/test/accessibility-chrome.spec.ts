import { launchPuppeteerBrowser } from '../../../scripts/browser-driver';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Browser, Page, Target } from 'puppeteer';
import { build } from 'esbuild';
import { createRemotePairing } from '../src/remote/protocol';

const EXTENSION_DIR = resolve(process.env.SPECTRA_EXTENSION_DIR ?? join(import.meta.dir, '..', 'dist'));
const EXPLICIT_CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim();
const EXPECTED_CHROME = process.env.NEXUS_EXPECTED_CHROME_VERSION?.trim();
if (!existsSync(join(EXTENSION_DIR, 'manifest.json'))) {
	throw new Error(`SPECTRA extension directory is missing manifest.json: ${EXTENSION_DIR}`);
}
if (EXPLICIT_CHROME && !existsSync(EXPLICIT_CHROME)) {
	throw new Error(`Pinned Chrome executable is missing: ${EXPLICIT_CHROME}`);
}

let browser: Browser;
let profileDir = '';
let extensionId = '';

test('commits the latest physical speed settlement when a held OSD gesture releases', async () => {
	const bundled = await build({
		entryPoints: [resolve(import.meta.dir, '../src/content/ui/osd.ts')],
		bundle: true,
		write: false,
		platform: 'browser',
		format: 'iife',
		globalName: 'SpectraOSD',
	});
	const code = bundled.outputFiles?.[0]?.text;
	if (!code) throw new Error('OSD component bundle is missing');
	const page = await browser.newPage();
	type OsdScope = Window & {
		SpectraOSD: typeof import('../src/content/ui/osd');
	};
	const settings = {
		osdEnabled: true,
		visualizerEnabled: true,
		lang: 'en-US',
		osdMessages: { muted: 'MUTE' },
	};
	const label = () => page.evaluate(() => (
		document.querySelector<HTMLElement>('#spectra-osd-host')
			?.shadowRoot?.getElementById('t')?.textContent ?? ''
	));
	const waitForLabel = (expected: string) => page.waitForFunction((value) => (
		document.querySelector<HTMLElement>('#spectra-osd-host')
			?.shadowRoot?.getElementById('t')?.textContent === value
	), {}, expected);
	try {
		await page.setContent('<main>OSD transaction probe</main>');
		await page.addScriptTag({ content: code });

		await page.evaluate((value) => {
			const osd = (window as OsdScope).SpectraOSD;
			osd.advanceHotkeyTargetOSD({ kind: 'speed', value: 1 }, 0.1, value, 'default:1');
		}, settings);
		await waitForLabel('1.1×');
		await page.evaluate((value) => {
			const osd = (window as OsdScope).SpectraOSD;
			osd.showHotkeyActualOSD({ kind: 'speed', value: 1.1 }, value, {}, 'default:1');
			osd.advanceHotkeyTargetOSD({ kind: 'speed', value: 1.1 }, 0.1, value, 'default:1');
		}, settings);
		await waitForLabel('1.2×');
		await page.evaluate(() => {
			const osd = (window as OsdScope).SpectraOSD;
			osd.freezeHotkeyTargetOSD('default:1');
			osd.releaseHotkeyTargetOSD('default:1');
		});
		expect(await label()).toBe('1.1×');

		await page.evaluate((value) => {
			const osd = (window as OsdScope).SpectraOSD;
			osd.advanceHotkeyTargetOSD({ kind: 'speed', value: 1.1 }, 0.1, value, 'default:2');
		}, settings);
		await waitForLabel('1.2×');
		await page.evaluate((value) => {
			const osd = (window as OsdScope).SpectraOSD;
			osd.freezeHotkeyTargetOSD('default:2');
			osd.showHotkeyActualOSD({ kind: 'speed', value: 1.15 }, value, {}, 'default:2');
			osd.releaseHotkeyTargetOSD('default:2');
		}, settings);
		expect(await label()).toBe('1.15×');

		await page.evaluate((value) => {
			const osd = (window as OsdScope).SpectraOSD;
			osd.advanceHotkeyTargetOSD({ kind: 'speed', value: 1.15 }, 0.1, value, 'default:3');
			osd.showHotkeyActualOSD({ kind: 'speed', value: 1.05 }, value, {}, 'default:2');
		}, settings);
		await waitForLabel('1.25×');
		expect(await label()).toBe('1.25×');
	} finally {
		await page.close();
	}
}, 20_000);

test('keeps remote disconnect visible through failure and fences a late close from a newer dialog', async () => {
	const bundled = await build({
		entryPoints: [resolve(import.meta.dir, '../src/remote/modal-renderer.ts')],
		bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'RemoteModal',
	});
	const code = bundled.outputFiles?.[0]?.text;
	if (!code) throw new Error('Remote modal component bundle is missing');
	const page = await browser.newPage();
	type Scope = Window & {
		RemoteModal: typeof import('../src/remote/modal-renderer');
		pending: Array<(reply: unknown) => void>;
	};
	try {
		await page.setContent('<button id="opener">Remote</button>');
		await page.evaluate(() => {
			const scope = window as Scope;
			scope.pending = [];
			Object.defineProperty(window, 'chrome', { configurable: true, value: { runtime: {
				sendMessage: () => new Promise((resolveReply) => scope.pending.push(resolveReply)),
				onMessage: { addListener() {}, removeListener() {} },
			} } });
			document.getElementById('opener')?.focus();
		});
		await page.addScriptTag({ content: code });
		const pairing = createRemotePairing();
		await page.evaluate((value) => {
			(window as Scope).RemoteModal.renderRemoteModal('data:image/png;base64,AA==', value, 1);
		}, pairing);
		await page.click('.remote-disconnect-btn');
		expect(await page.evaluate(() => ({
			open: (window as Scope).RemoteModal.isRemoteModalOpen(),
			busy: document.getElementById('remote-modal')?.getAttribute('aria-busy'),
			disabled: document.querySelector<HTMLButtonElement>('.remote-disconnect-btn')?.disabled,
			requests: (window as Scope).pending.length,
		}))).toEqual({ open: true, busy: 'true', disabled: true, requests: 1 });
		await page.click('.remote-modal-close');
		await page.keyboard.press('Escape');
		await page.evaluate(() => document.getElementById('remote-modal')?.click());
		expect(await page.evaluate(() => (window as Scope).RemoteModal.isRemoteModalOpen())).toBe(true);
		await page.evaluate(() => (window as Scope).pending[0]?.({
			ok: false, error: { code: 'remote_failed', message: 'internal transport detail', retryable: true },
		}));
		await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('.remote-disconnect-btn')?.disabled);
		expect(await page.$eval('.remote-status-text', (node) => node.textContent)).toBe('Could not disconnect. Please try again.');
		await page.click('.remote-disconnect-btn');
		await page.evaluate(() => (window as Scope).pending[1]?.({ ok: true, data: { closed: true } }));
		await page.waitForFunction(() => !document.getElementById('remote-modal'));
		expect(await page.evaluate(() => document.activeElement?.id)).toBe('opener');
		await page.evaluate((value) => {
			(window as Scope).RemoteModal.renderRemoteModal('data:image/png;base64,AA==', value, 1);
		}, pairing);
		await page.click('.remote-disconnect-btn');
		await page.evaluate((value) => {
			(window as Scope).RemoteModal.renderRemoteModal('data:image/png;base64,AA==', value, 2);
			(window as Scope).pending[2]?.({ ok: true, data: { closed: true } });
		}, createRemotePairing());
		expect(await page.evaluate(() => (window as Scope).RemoteModal.isRemoteModalOpen())).toBe(true);
		await page.click('.remote-modal-close');
		expect(await page.evaluate(() => (window as Scope).pending.length)).toBe(3);
	} finally {
		await page.close();
	}
}, 20_000);

test('renders automatically detected and manually configured site audio routes together', async () => {
	const bundled = await build({
		entryPoints: [resolve(import.meta.dir, '../src/popup/views/media-route-ui.ts')],
		bundle: true,
		write: false,
		platform: 'browser',
		format: 'iife',
		globalName: 'MediaRouteUI',
	});
	const code = bundled.outputFiles?.[0]?.text;
	if (!code) throw new Error('Media route UI component bundle is missing');
	const page = await browser.newPage();
	type RouteScope = Window & {
		MediaRouteUI: typeof import('../src/popup/views/media-route-ui');
		routeDispose?: () => void;
	};
	try {
		await page.setContent(`
			<input id="registry-filter" />
			<ul id="registry-list"></ul>
			<input id="registry-new-domain" />
			<select id="registry-new-route"><option value="capture">Capture when needed</option></select>
			<button id="btn-add-domain" type="button">Add</button>
		`);
		await page.evaluate(() => {
			const listeners = { addListener() {}, removeListener() {} };
			Object.defineProperty(window, 'chrome', {
				configurable: true,
				value: {
					runtime: {
						onMessage: listeners,
						sendMessage: () => Promise.resolve({
							ok: true,
							data: {
								entries: [
									{
										domain: 'www.douyin.com',
										fingerprint: 'site:www.douyin.com',
										route: 'capture',
										source: 'auto',
										updatedAt: 2,
									},
									{
										domain: 'example.com',
										fingerprint: 'site:example.com',
										route: 'direct',
										source: 'user',
										updatedAt: 1,
									},
								],
							},
						}),
					},
					storage: { onChanged: listeners },
				},
			});
		});
		await page.addScriptTag({ content: code });
		await page.evaluate(async () => {
			const scope = window as RouteScope;
			scope.routeDispose = await scope.MediaRouteUI.initMediaRouteUI({
				tabRestricted: 'Capture when needed',
				tabSafe: 'Direct',
				registrySourceAuto: 'Auto-detected',
				registrySourceUser: 'Manual',
				registryEmptyRestricted: 'No detected or configured sites',
				registryInvalidDomain: 'Invalid domain',
				tipDelete: 'Delete',
			} as never);
		});
		const rows = await page.$$eval('.registry-item', (items) => items.map((item) => ({
			domain: item.querySelector('.registry-item-domain')?.textContent,
			source: item.querySelector('.registry-item-source')?.textContent,
			route: item.querySelector('.registry-item-route')?.textContent,
		})));
		expect(rows).toEqual([
			{ domain: 'www.douyin.com', source: 'Auto-detected', route: 'Capture when needed' },
			{ domain: 'example.com', source: 'Manual', route: 'Direct' },
		]);
		expect(await page.$eval('body', (body) => body.textContent?.includes('site:'))).toBe(false);
		await page.$eval('#registry-filter', (element) => {
			const input = element as HTMLInputElement;
			input.value = 'Auto-detected';
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		expect(await page.$$eval('.registry-item-domain', (items) => items.map((item) => item.textContent)))
			.toEqual(['www.douyin.com']);
	} finally {
		await page.evaluate(() => (window as RouteScope).routeDispose?.()).catch(() => undefined);
		await page.close();
	}
}, 20_000);

beforeAll(async () => {
	profileDir = await mkdtemp(join(tmpdir(), 'spectra-accessibility-'));
	browser = await launchPuppeteerBrowser({
		...(EXPLICIT_CHROME ? { executablePath: EXPLICIT_CHROME } : {}),
		headless: true,
		userDataDir: profileDir,
		args: [
			`--disable-extensions-except=${EXTENSION_DIR}`,
			`--load-extension=${EXTENSION_DIR}`,
			'--no-sandbox',
		'--disable-setuid-sandbox',
	],
	}, {
		owner: 'apps/extension-spectra/test/accessibility-chrome.spec.ts',
		profile: { kind: 'temporary', prefix: 'spectra-accessibility-', isolated: true },
	});
	const browserVersion = await browser.version();
	if (EXPECTED_CHROME) expect(browserVersion).toContain(EXPECTED_CHROME);
	const workerTarget: Target = await browser.waitForTarget(
		(target) => target.type() === 'service_worker'
			&& /^chrome-extension:\/\/[^/]+\/background\.js$/u.test(target.url()),
		{ timeout: 30_000 },
	);
	extensionId = new URL(workerTarget.url()).host;
}, 60_000);

afterAll(async () => {
	await browser?.close().catch(() => undefined);
	if (profileDir) {
		await rm(profileDir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
	}
});

async function openSurface(path: 'popup.html' | 'options.html'): Promise<Page> {
	const page = await browser.newPage();
	await page.setViewport({ width: 320, height: 700, deviceScaleFactor: 1 });
	await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
	await page.goto(`chrome-extension://${extensionId}/${path}`, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(
		() => document.documentElement.dataset.spectraReady === 'true',
		{ timeout: 15_000 },
	);
	return page;
}

async function customWheelIsPrevented(page: Page): Promise<boolean> {
	return page.evaluate(() => {
		document.getElementById('spectra-a11y-scroll-probe')?.remove();
		const box = document.createElement('div');
		box.id = 'spectra-a11y-scroll-probe';
		box.style.cssText = 'position:fixed;left:0;top:0;width:100px;height:40px;overflow-y:auto;z-index:-1';
		const child = document.createElement('div');
		child.style.height = '400px';
		box.append(child);
		document.body.append(box);
		box.scrollTop = 100;
		const event = new WheelEvent('wheel', {
			bubbles: true,
			cancelable: true,
			deltaY: 80,
		});
		box.dispatchEvent(event);
		return event.defaultPrevented;
	});
}

async function probeScrollTop(page: Page): Promise<number> {
	return page.evaluate(() => {
		const probe = document.getElementById('spectra-a11y-scroll-probe');
		if (!(probe instanceof HTMLElement)) throw new Error('scroll probe missing');
		return probe.scrollTop;
	});
}

async function nextAnimationFrames(page: Page, count = 2): Promise<void> {
	await page.evaluate(async (frameCount) => {
		for (let index = 0; index < frameCount; index++) {
			await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
		}
	}, count);
}

function cssTimeMs(value: string): number {
	const token = value.split(',')[0]?.trim() ?? '';
	const numeric = Number.parseFloat(token);
	if (!Number.isFinite(numeric)) return Number.POSITIVE_INFINITY;
	return token.endsWith('ms') ? numeric : numeric * 1_000;
}

async function themeContrasts(page: Page): Promise<{
	focusDark: number;
	focusLight: number;
	mutedDark: number | null;
	mutedLight: number | null;
	placeholderDark: number | null;
	placeholderLight: number | null;
}> {
	return page.evaluate(() => {
		type Rgba = [number, number, number, number];

		function parseColor(value: string): Rgba {
			const numbers = value.match(/[\d.]+/gu)?.map(Number) ?? [];
			if (numbers.length < 3 || numbers.slice(0, 3).some((entry) => !Number.isFinite(entry))) {
				throw new Error(`Unable to parse computed color: ${value}`);
			}
			return [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0, numbers[3] ?? 1];
		}
		function opaqueRgb(color: Rgba, background: Rgba): Rgba {
			const alpha = Math.max(0, Math.min(1, color[3]));
			return [
				color[0] * alpha + background[0] * (1 - alpha),
				color[1] * alpha + background[1] * (1 - alpha),
				color[2] * alpha + background[2] * (1 - alpha),
				1,
			];
		}
		function luminance(color: Rgba): number {
			const components = color.slice(0, 3).map((component) => {
				const normalized = component / 255;
				return normalized <= 0.04045
					? normalized / 12.92
					: ((normalized + 0.055) / 1.055) ** 2.4;
			});
			return 0.2126 * (components[0] ?? 0)
				+ 0.7152 * (components[1] ?? 0)
				+ 0.0722 * (components[2] ?? 0);
		}
		function ratio(foreground: Rgba, background: Rgba): number {
			const opaqueForeground = opaqueRgb(foreground, background);
			const left = luminance(opaqueForeground);
			const right = luminance(background);
			return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
		}
		function opaqueBackground(element: Element): Rgba {
			let cursor: Element | null = element;
			while (cursor) {
				const color = parseColor(getComputedStyle(cursor).backgroundColor);
				if (color[3] >= 0.999) return color;
				cursor = cursor.parentElement;
			}
			return parseColor(getComputedStyle(document.body).backgroundColor);
		}
		function actualTextContrast(element: HTMLElement): number {
			const style = getComputedStyle(element);
			const foreground = parseColor(style.color);
			foreground[3] *= Number.parseFloat(style.opacity) || 1;
			return ratio(foreground, opaqueBackground(element));
		}
		function placeholderContrast(input: HTMLInputElement): number {
			const style = getComputedStyle(input, '::placeholder');
			const foreground = parseColor(style.color);
			foreground[3] *= Number.parseFloat(style.opacity) || 1;
			return ratio(foreground, opaqueBackground(input));
		}
		function read(theme: 'dark' | 'light') {
			document.documentElement.dataset.theme = theme;
			const sentinel = document.getElementById('spectra-a11y-focus-sentinel') as HTMLElement | null;
			if (!sentinel) throw new Error('focus sentinel missing');
			const focusStyle = getComputedStyle(sentinel);
			const bodyBackground = parseColor(getComputedStyle(document.body).backgroundColor);
			let muted: number | null = null;
			let placeholder: number | null = null;
			if (location.pathname.endsWith('/options.html')) {
				const mutedText = document.querySelector<HTMLElement>('.section-desc');
				const siteInput = document.getElementById('site-input');
				if (!mutedText) throw new Error('real muted text probe missing');
				if (!(siteInput instanceof HTMLInputElement)) throw new Error('real placeholder probe missing');
				muted = actualTextContrast(mutedText);
				placeholder = placeholderContrast(siteInput);
			}
			return {
				focus: ratio(parseColor(focusStyle.outlineColor), bodyBackground),
				muted,
				placeholder,
			};
		}
		const dark = read('dark');
		const light = read('light');
		return {
			focusDark: dark.focus,
			focusLight: light.focus,
			mutedDark: dark.muted,
			mutedLight: light.muted,
			placeholderDark: dark.placeholder,
			placeholderLight: light.placeholder,
		};
	});
}

async function assertSurface(path: 'popup.html' | 'options.html'): Promise<void> {
	const page = await openSurface(path);
	try {
		// The custom scroll engine owns normal wheel motion at a non-boundary.
		expect(await customWheelIsPrevented(page), `${path} normal smooth-scroll owner`).toBe(true);
		// Ensure the normal-motion wheel produced an active rAF trajectory before changing policy.
		await nextAnimationFrames(page, 1);

		// Media-query changes after initialization must cancel/unbind the rAF engine.
		await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
		await page.waitForFunction(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
		await nextAnimationFrames(page, 2);
		const stoppedScrollTop = await probeScrollTop(page);
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));
		expect(await probeScrollTop(page), `${path} pending rAF is cancelled under reduced motion`).toBe(stoppedScrollTop);
		expect(await customWheelIsPrevented(page), `${path} reduced-motion wheel pass-through`).toBe(false);

		await page.evaluate(() => {
			for (const node of document.querySelectorAll<HTMLElement>(
				'button,a[href],input,select,textarea,summary,[tabindex]',
			)) node.tabIndex = -1;
			const sentinel = document.createElement('button');
			sentinel.id = 'spectra-a11y-focus-sentinel';
			sentinel.type = 'button';
			sentinel.textContent = 'Keyboard focus sentinel';
			document.body.prepend(sentinel);
			(document.activeElement as HTMLElement | null)?.blur();
		});
		await page.keyboard.press('Tab');

		const facts = await page.evaluate(() => {
			const sentinel = document.getElementById('spectra-a11y-focus-sentinel') as HTMLButtonElement | null;
			if (!sentinel) throw new Error('focus sentinel missing');
			const focusStyle = getComputedStyle(sentinel);
			const motionProbe = document.createElement('div');
			motionProbe.id = 'spectra-a11y-motion-probe';
			// Product styles are layered, not inline. An inline synthetic declaration
			// bypasses that authored cascade and would test a policy we do not ship.
			const productStyle = document.createElement('style');
			productStyle.textContent = '@layer spectra-product { #spectra-a11y-motion-probe { transition: opacity 2s linear 1s; animation-duration: 2s; animation-iteration-count: 5; scroll-behavior: smooth; } }';
			document.head.append(productStyle);
			document.body.append(motionProbe);
			const motionStyle = getComputedStyle(motionProbe);
			const policy = document.getElementById('spectra-accessibility-policy') as HTMLLinkElement | null;
			return {
				inlineMotion: Array.from(document.querySelectorAll<HTMLElement>('[style]'))
					.filter((element) => element.style.transition || element.style.animation || element.style.animationDuration || element.style.scrollBehavior)
					.map((element) => element.id || element.tagName),
				policyLoaded: Boolean(policy?.sheet),
				focused: document.activeElement === sentinel,
				outlineStyle: focusStyle.outlineStyle,
				outlineWidth: focusStyle.outlineWidth,
				transitionDuration: motionStyle.transitionDuration,
				transitionDelay: motionStyle.transitionDelay,
				animationDuration: motionStyle.animationDuration,
				animationIterationCount: motionStyle.animationIterationCount,
				scrollBehavior: motionStyle.scrollBehavior,
				viewportWidth: innerWidth,
				scrollWidth: document.documentElement.scrollWidth,
			};
		});

		expect(facts.inlineMotion, `${path} motion must remain within the authored layer policy`).toEqual([]);
		expect(facts.policyLoaded, `${path} accessibility stylesheet`).toBe(true);
		expect(facts.focused, `${path} keyboard focus target`).toBe(true);
		expect(facts.outlineStyle, `${path} focus-visible outline style`).not.toBe('none');
		expect(Number.parseFloat(facts.outlineWidth), `${path} focus-visible outline width`).toBeGreaterThanOrEqual(2);
		expect(cssTimeMs(facts.transitionDuration), `${path} reduced transition duration`).toBeLessThanOrEqual(0.01);
		expect(cssTimeMs(facts.animationDuration), `${path} reduced animation duration`).toBeLessThanOrEqual(0.01);
		expect(cssTimeMs(facts.transitionDelay), `${path} reduced transition delay`).toBe(0);
		expect(facts.animationIterationCount, `${path} reduced animation iterations`).toBe('1');
		expect(facts.scrollBehavior, `${path} reduced CSS scroll behavior`).toBe('auto');
		expect(facts.viewportWidth, `${path} test viewport`).toBe(320);
		expect(facts.scrollWidth, `${path} 320px reflow`).toBeLessThanOrEqual(facts.viewportWidth + 1);

		const contrast = await themeContrasts(page);
		expect(contrast.focusDark, `${path} dark focus-ring contrast`).toBeGreaterThanOrEqual(3);
		expect(contrast.focusLight, `${path} light focus-ring contrast`).toBeGreaterThanOrEqual(3);
		if (path === 'options.html') {
			expect(contrast.mutedDark, 'Options dark real muted-text contrast').toBeGreaterThanOrEqual(4.5);
			expect(contrast.mutedLight, 'Options light real muted-text contrast').toBeGreaterThanOrEqual(4.5);
			expect(contrast.placeholderDark, 'Options dark real placeholder contrast').toBeGreaterThanOrEqual(4.5);
			expect(contrast.placeholderLight, 'Options light real placeholder contrast').toBeGreaterThanOrEqual(4.5);
		}

		// Restoring the OS preference at runtime must reacquire the same wheel owner;
		// a one-way reduce transition would leave the product permanently degraded.
		await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
		await page.waitForFunction(() => !matchMedia('(prefers-reduced-motion: reduce)').matches);
		await nextAnimationFrames(page, 2);
		expect(await customWheelIsPrevented(page), `${path} restored smooth-scroll owner`).toBe(true);
		const restoredMotion = await page.$eval('#spectra-a11y-motion-probe', (element) => getComputedStyle(element).transitionDuration);
		expect(cssTimeMs(restoredMotion), `${path} restored authored motion`).toBe(2_000);
	} finally {
		await page.close();
	}
}

describe('SPECTRA extension-page accessibility', () => {
	test('Popup and Options preserve focus, dynamic motion preference, contrast, and 320px reflow', async () => {
		await assertSurface('popup.html');
		await assertSurface('options.html');
	}, 90_000);
});

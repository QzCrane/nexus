import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer, { type Browser, type Page, type Target } from 'puppeteer';

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

beforeAll(async () => {
	profileDir = await mkdtemp(join(tmpdir(), 'spectra-accessibility-'));
	browser = await puppeteer.launch({
		...(EXPLICIT_CHROME ? { executablePath: EXPLICIT_CHROME } : {}),
		headless: true,
		userDataDir: profileDir,
		args: [
			`--disable-extensions-except=${EXTENSION_DIR}`,
			`--load-extension=${EXTENSION_DIR}`,
			'--no-sandbox',
			'--disable-setuid-sandbox',
		],
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

function cssTimeMs(value: string): number {
	const token = value.split(',')[0]?.trim() ?? '';
	const numeric = Number.parseFloat(token);
	if (!Number.isFinite(numeric)) return Number.POSITIVE_INFINITY;
	return token.endsWith('ms') ? numeric : numeric * 1_000;
}

async function optionsMutedContrast(page: Page): Promise<{ dark: number; light: number }> {
	return page.evaluate(() => {
		function parseRgb(value: string): [number, number, number] {
			const numbers = value.match(/[\d.]+/gu)?.map(Number) ?? [];
			if (numbers.length < 3 || numbers.slice(0, 3).some((entry) => !Number.isFinite(entry))) {
				throw new Error(`Unable to parse computed RGB color: ${value}`);
			}
			return [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0];
		}
		function luminance(value: string): number {
			const components = parseRgb(value).map((component) => {
				const normalized = component / 255;
				return normalized <= 0.04045
					? normalized / 12.92
					: ((normalized + 0.055) / 1.055) ** 2.4;
			});
			return 0.2126 * (components[0] ?? 0)
				+ 0.7152 * (components[1] ?? 0)
				+ 0.0722 * (components[2] ?? 0);
		}
		function ratio(foreground: string, background: string): number {
			const left = luminance(foreground);
			const right = luminance(background);
			return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
		}
		function read(theme: 'dark' | 'light'): number {
			document.documentElement.dataset.theme = theme;
			const probe = document.createElement('span');
			probe.style.color = 'var(--text-muted)';
			probe.style.backgroundColor = 'var(--bg-tertiary)';
			document.body.append(probe);
			const style = getComputedStyle(probe);
			const result = ratio(style.color, style.backgroundColor);
			probe.remove();
			return result;
		}
		return { dark: read('dark'), light: read('light') };
	});
}

async function assertSurface(path: 'popup.html' | 'options.html'): Promise<void> {
	const page = await openSurface(path);
	try {
		// The custom scroll engine owns normal wheel motion at a non-boundary.
		expect(await customWheelIsPrevented(page), `${path} normal smooth-scroll owner`).toBe(true);

		// Media-query changes after initialization must cancel/unbind the rAF engine.
		await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
		await page.waitForFunction(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
		await page.evaluate(() => new Promise<void>((resolveFrame) => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()));
		}));
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
			motionProbe.style.transition = 'opacity 2s linear 1s';
			motionProbe.style.animationDuration = '2s';
			motionProbe.style.animationIterationCount = '5';
			motionProbe.style.scrollBehavior = 'smooth';
			document.body.append(motionProbe);
			const motionStyle = getComputedStyle(motionProbe);
			const policy = document.getElementById('spectra-accessibility-policy') as HTMLLinkElement | null;
			return {
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

		if (path === 'options.html') {
			const contrast = await optionsMutedContrast(page);
			expect(contrast.dark, 'Options dark muted-text contrast').toBeGreaterThanOrEqual(4.5);
			expect(contrast.light, 'Options light muted-text contrast').toBeGreaterThanOrEqual(4.5);
		}
	} finally {
		await page.close();
	}
}

describe('SPECTRA extension-page accessibility', () => {
	test('Popup and Options preserve focus, motion preference, contrast, and 320px reflow', async () => {
		await assertSurface('popup.html');
		await assertSurface('options.html');
	}, 90_000);
});

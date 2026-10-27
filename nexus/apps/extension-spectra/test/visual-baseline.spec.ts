import { launchPuppeteerBrowser } from '../../../scripts/browser-driver';
import { expect } from 'bun:test';
import { chromeIntegrationEnabled, testChrome } from './helpers/chrome-integration';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Browser, Page, Target } from 'puppeteer';
import { verifyVisualRegressionCandidate } from '../../../scripts/verify-visual-regression-candidate';

const EXTENSION_DIR = resolve(process.env.SPECTRA_EXTENSION_DIR ?? join(import.meta.dir, '..', 'dist'));
const workspaceDir = resolve(EXTENSION_DIR, '../../..');
const updateBaseline = process.env.NEXUS_UPDATE_VISUAL_BASELINE === '1';
const explicitChrome = process.env.NEXUS_CHROME_EXECUTABLE?.trim();
const expectedChrome = process.env.NEXUS_EXPECTED_CHROME_VERSION?.trim();
if (chromeIntegrationEnabled && !existsSync(join(EXTENSION_DIR, 'manifest.json'))) {
	throw new Error(`SPECTRA extension directory is missing manifest.json: ${EXTENSION_DIR}`);
}
if (chromeIntegrationEnabled && explicitChrome && !existsSync(explicitChrome)) {
	throw new Error(`Pinned Chrome executable is missing: ${explicitChrome}`);
}
if (chromeIntegrationEnabled && updateBaseline && !explicitChrome) {
	throw new Error('SPECTRA visual baseline update requires NEXUS_CHROME_EXECUTABLE');
}

const states = {
	data: {
		id: 'spectra.popup.media-data.dark.en-US.396x510', scenario: 'data', assertions: ['media-card-visible', 'control-values-visible', 'focus-visible'], focusTarget: 'volume-slider',
		width: 396, height: 510, theme: 'dark', file: 'spectra-popup-media-data-396x510.png',
	},
	error: {
		id: 'spectra.popup.startup-error.dark.en-US.320x600', scenario: 'error', assertions: ['startup-error-visible', 'retry-visible', 'narrow-layout', 'focus-visible'], focusTarget: 'retry',
		width: 320, height: 600, theme: 'dark', file: 'spectra-popup-startup-error-320x600.png',
	},
	dynamic: {
		id: 'spectra.popup.dynamic-control.light.en-US.396x510', scenario: 'dynamic', assertions: ['media-card-visible', 'volume-applied', 'speed-applied', 'focus-visible'], focusTarget: 'speed-input',
		width: 396, height: 510, theme: 'light', file: 'spectra-popup-dynamic-control-396x510.png',
	},
} as const;

function wav(): Uint8Array {
	const samples = 8_000;
	const bytes = new Uint8Array(44 + samples);
	const view = new DataView(bytes.buffer);
	const text = (offset: number, value: string) => [...value].forEach((character, index) => { bytes[offset + index] = character.charCodeAt(0); });
	text(0, 'RIFF'); view.setUint32(4, 36 + samples, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8_000, true); view.setUint32(28, 8_000, true);
	view.setUint16(32, 1, true); view.setUint16(34, 8, true); text(36, 'data'); view.setUint32(40, samples, true);
	bytes.fill(128, 44);
	return bytes;
}

// post: captures one deterministic PNG and verifies it equals the rendered CSS
// viewport. The Action-popup window is sized by the browser (extension popup
// targets reject device-metrics emulation), so its natural height depends on
// platform font metrics; `--force-device-scale-factor=1` pins the physical
// capture to the CSS viewport on every host, and comparing against the actual
// rendered viewport keeps the gate deterministic outside the certifying CI host.
async function capture(
	page: Page,
	state: (typeof states)[keyof typeof states],
	options: { resize?: boolean } = {},
): Promise<void> {
	if (options.resize !== false) await page.setViewport({ width: state.width, height: state.height, deviceScaleFactor: 1 });
	await page.emulateMediaFeatures([
		{ name: 'prefers-color-scheme', value: state.theme },
		{ name: 'prefers-reduced-motion', value: 'reduce' },
	]);
	await page.evaluate(() => {
		for (const element of document.querySelectorAll<HTMLElement>('*')) {
			element.style.setProperty('animation', 'none', 'important');
			element.style.setProperty('transition', 'none', 'important');
		}
	});
	const baselinePath = resolve(EXTENSION_DIR, `../store-listings/assets/${state.file}`);
	const candidatePath = resolve(workspaceDir, `../artifacts/visual-candidates/${state.file}`);
	const screenshotPath = updateBaseline ? baselinePath : candidatePath;
	mkdirSync(dirname(screenshotPath), { recursive: true });
	const png = Buffer.from(await page.screenshot({ type: 'png', captureBeyondViewport: false }));
	const rendered = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
	if (png.readUInt32BE(16) !== rendered.w || png.readUInt32BE(20) !== rendered.h) {
		throw new Error(`${state.id}: physical PNG dimensions ${png.readUInt32BE(16)}x${png.readUInt32BE(20)} differ from rendered viewport ${rendered.w}x${rendered.h}`);
	}
	writeFileSync(screenshotPath, png);
	const verification = verifyVisualRegressionCandidate({ stateId: state.id, candidatePath, baselinePath, updateBaseline });
	console.log(`✓ SPECTRA ${state.scenario} visual ${verification.mode} ${verification.sha256}: ${screenshotPath}`);
}

testChrome('captures real media data, startup error and acknowledged dynamic SPECTRA states', async () => {
	const profileDir = await mkdtemp(join(tmpdir(), 'spectra-visual-'));
	let browser: Browser | null = null;
	let server: ReturnType<typeof Bun.serve> | null = null;
	try {
		server = Bun.serve({
			port: 0, hostname: '127.0.0.1',
			fetch(request) {
				const url = new URL(request.url);
				if (url.pathname === '/tone.wav') return new Response(wav(), { headers: { 'content-type': 'audio/wav' } });
				if (url.pathname === '/media') return new Response(`<!doctype html><html><head><title>Visual Media ${url.searchParams.get('id')}</title></head><body><audio controls autoplay loop src="/tone.wav"></audio></body></html>`, { headers: { 'content-type': 'text/html' } });
				return new Response('not found', { status: 404 });
			},
		});
		browser = await launchPuppeteerBrowser({
			...(explicitChrome ? { executablePath: explicitChrome } : {}), headless: true, userDataDir: profileDir,
			defaultViewport: { width: 390, height: 600, deviceScaleFactor: 1 },
			args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`, '--lang=en-US', '--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=1'],
		}, { owner: 'apps/extension-spectra/test/visual-baseline.spec.ts', profile: { kind: 'temporary', prefix: 'spectra-visual-', isolated: true } });
		const browserVersion = await browser.version();
		if (expectedChrome) expect(browserVersion).toContain(expectedChrome);
		const workerTarget: Target = await browser.waitForTarget((target) => target.type() === 'service_worker' && /^chrome-extension:\/\/[^/]+\/background\.js$/u.test(target.url()), { timeout: 30_000 });
		const extensionId = new URL(workerTarget.url()).host;
		const worker = await workerTarget.worker();
		if (!worker) throw new Error('SPECTRA service worker target has no execution context');
		for (const id of [1, 2]) {
			const media = await browser.newPage();
			await media.goto(`http://127.0.0.1:${server.port}/media?id=${id}`, { waitUntil: 'domcontentloaded' });
			await media.$eval('audio', async (element) => { await (element as HTMLMediaElement).play(); });
			expect(await media.$eval('audio', (element) => !(element as HTMLMediaElement).paused)).toBe(true);
		}

		const knownTargets = new Set(browser.targets());
		const popupTarget = browser.waitForTarget(
			(target) => !knownTargets.has(target) && target.url() === `chrome-extension://${extensionId}/popup.html`,
			{ timeout: 10_000 },
		);
		await worker.evaluate(async () => chrome.action.openPopup());
		const popup = await (await popupTarget).asPage();
		if (!popup) throw new Error('Unable to attach to the SPECTRA Action Popup');
		await popup.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
		await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
		await popup.waitForFunction(() => document.documentElement.dataset.spectraReady === 'true' && document.querySelectorAll('.glass-card').length >= 2, { timeout: 20_000 });
		const cards = await popup.$$('.glass-card');
		expect(cards.length).toBeGreaterThanOrEqual(2); // media-card-visible
		const volume = await popup.$('.glass-card .vol-slider');
		const speed = await popup.$('.glass-card .speed-input');
		if (!volume || !speed) throw new Error('Representative media controls are missing');
		expect(await popup.$eval('.glass-card .vol-number', (element) => element.textContent?.trim())).toBe('100%'); // control-values-visible
		await volume.focus();
		expect(await popup.evaluate(() => document.activeElement?.classList.contains('vol-slider'))).toBe(true); // focus-visible, volume-slider
		await capture(popup, states.data, { resize: false });

		await volume.focus();
		await popup.keyboard.press('ArrowLeft');
		await popup.keyboard.press('ArrowLeft');
		// rule: the thumb follows the gesture immediately, while the result label
		// and fill commit together only when Background acknowledges the volume.
		expect(await popup.$eval('.glass-card .vol-slider', (element) => (element as HTMLInputElement).value)).toBe('80');
		await popup.waitForFunction(() => document.querySelector('.glass-card .vol-number')?.textContent?.trim() === '80%', { timeout: 10_000 }); // volume-applied
		expect(await popup.$eval('.glass-card', (card) => ({
			slider: (card.querySelector('.vol-slider') as HTMLInputElement | null)?.value,
			label: card.querySelector('.vol-number')?.textContent?.trim(),
		}))).toEqual({ slider: '80', label: '80%' });
		await popup.click('.glass-card .btn-speed[data-delta="0.5"]');
		await popup.waitForFunction(() => (document.querySelector('.glass-card .speed-input') as HTMLInputElement | null)?.value === '1.50', { timeout: 10_000 }); // speed-applied
		await popup.click('#btn-settings');
		await popup.select('#set-theme', 'light');
		await popup.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light');
		await popup.click('#btn-back');
		await popup.focus('.glass-card .speed-input'); // focus-visible, speed-input
		await capture(popup, states.dynamic, { resize: false });

		const errorPage = await browser.newPage();
		await errorPage.evaluateOnNewDocument(() => {
			Object.defineProperty(chrome.runtime, 'sendMessage', { configurable: true, value: async () => { throw new Error('visual fixture settings unavailable'); } });
		});
		await errorPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
		await errorPage.waitForSelector('#popup-startup-status[role="alert"]', { timeout: 10_000 }); // startup-error-visible, narrow-layout
		const retry = await errorPage.$('#popup-startup-status button');
		if (!retry) throw new Error('Startup retry control is missing'); // retry-visible
		await retry.focus();
		expect(await errorPage.evaluate(() => document.activeElement?.id === '' && document.activeElement?.tagName === 'BUTTON')).toBe(true); // focus-visible, retry
		await capture(errorPage, states.error);
	} finally {
		await browser?.close().catch(() => undefined);
		server?.stop(true);
		await rm(profileDir, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 });
	}
}, 120_000);

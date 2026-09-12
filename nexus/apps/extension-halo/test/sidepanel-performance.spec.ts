// HALO runtime performance evidence against the REAL Chrome Side Panel.
//
// The deadline coordinator trusts only non-tab senders (sender.tab ===
// undefined), which is the actual Side Panel context. A tab-opened
// sidepanel.html page is therefore not a valid client for pomodoro/timer
// commands, so this workload drives the real Side Panel opened through
// chrome.sidePanel.open with a CDP-granted user gesture.

import { launchPuppeteerBrowser } from '../../../scripts/browser-driver';
import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, Page, Target } from 'puppeteer';
import {
	runtimePerformanceIdentityFromEnvironment,
	writeRuntimePerformanceEvidence,
	type RuntimePerformanceSample,
} from '../../../scripts/runtime-performance';

const DIST_PATH = resolve(
	process.env.HALO_EXTENSION_DIR?.trim() || fileURLToPath(new URL('../dist/', import.meta.url)),
);
const SAMPLE_COUNT = 20;
const EXPLICIT_CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim();
const EXPECTED_CHROME = process.env.NEXUS_EXPECTED_CHROME_VERSION?.trim();

interface VisiblePoint { x: number; y: number }

async function eventually(
	read: () => Promise<boolean>,
	label: string,
	timeoutMs: number,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await read()) return;
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
	}
	throw new Error(`${label} did not converge within ${timeoutMs}ms`);
}

function isRendered(el: HTMLElement): boolean {
	const rect = el.getBoundingClientRect();
	const style = getComputedStyle(el);
	return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}

const RENDERED_CHECK_SOURCE = isRendered.toString();

async function waitForVisiblePoint(
	page: Page,
	selector: string,
	textIncludes: string,
	timeoutMs: number,
): Promise<VisiblePoint> {
	let last: VisiblePoint | null = null;
	let stableCount = 0;
	await eventually(async () => {
		const current = await page.evaluate(({ sel, text, renderedSource }) => {
			const isRenderedLocal = new Function(`return (${renderedSource});`)() as (el: HTMLElement) => boolean;
			const candidates = [...document.querySelectorAll<HTMLElement>(sel)];
			for (const el of candidates) {
				if (text && !(el.textContent ?? '').includes(text)) continue;
				if (!isRenderedLocal(el)) continue;
				// The real Side Panel viewport is small and the Home grid scrolls;
				// bring the element into view before reporting its center.
				el.scrollIntoView({ block: 'center', inline: 'center' });
				const rect = el.getBoundingClientRect();
				return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
			}
			return null;
		}, { sel: selector, text: textIncludes, renderedSource: RENDERED_CHECK_SOURCE });

		if (!current) {
			last = null;
			stableCount = 0;
			return false;
		}
		// The launcher slides tool pages through a 200%-wide container animated
		// with a transform; a point sampled mid-animation points at a stale
		// position and the following mouse click lands on the wrong element.
		// Require three consecutive samples at a settled position before the
		// coordinates are trusted for a click.
		if (last && Math.abs(current.x - last.x) < 2 && Math.abs(current.y - last.y) < 2) {
			stableCount += 1;
			return stableCount >= 3;
		}
		last = current;
		stableCount = 0;
		return false;
	}, `visible ${selector}${textIncludes ? ` containing ${textIncludes}` : ''}`, timeoutMs);
	return last as VisiblePoint;
}

async function clickVisible(
	page: Page,
	selector: string,
	textIncludes = '',
	timeoutMs = 10_000,
): Promise<void> {
	const point = await waitForVisiblePoint(page, selector, textIncludes, timeoutMs);
	await page.mouse.click(point.x, point.y);
}

async function setTextareaValue(page: Page, value: string): Promise<void> {
	// React-controlled textarea requires the native value setter plus an input
	// event; a plain `el.value =` assignment would not reach the component.
	await page.evaluate((next) => {
		const el = document.querySelector('textarea');
		if (!el) return;
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
		setter?.call(el, next);
		el.dispatchEvent(new Event('input', { bubbles: true }));
	}, value);
}

async function waitForTextareaValue(page: Page, pattern: RegExp, timeoutMs: number): Promise<void> {
	await eventually(async () => page.evaluate((source) => {
		const el = document.querySelector('textarea');
		if (!el) return false;
		return new RegExp(source).test(el.value);
	}, pattern.source), `textarea matches ${pattern}`, timeoutMs);
}

async function waitForPageText(page: Page, text: string, timeoutMs: number): Promise<void> {
	await eventually(async () => page.evaluate((target) => document.body.textContent?.includes(target) ?? false, text),
		`page contains ${text}`, timeoutMs);
}

async function openRealSidepanel(
	browser: Browser,
	extensionId: string,
): Promise<{ sidePage: Page; panelPage: Page }> {
	// Resolve the host tab through the extension page instead of the service
	// worker: Puppeteer worker.evaluate can hang when the worker execution
	// context is not attached, and the side panel only needs a host tab id.
	const panelPage = await browser.newPage();
	await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load' });
	const tabId = await panelPage.evaluate(async () => {
		const tabs = await chrome.tabs.query({});
		const host = tabs.find((tab) => tab.id != null && tab.url && !tab.url.startsWith('chrome-extension://'));
		return host?.id ?? null;
	});
	if (typeof tabId !== 'number') throw new Error('unable to resolve a host tab for the real sidepanel');

	// chrome.sidePanel.open requires a user gesture. Grant it through CDP
	// Runtime.evaluate(userGesture) inside our own extension page, which is a
	// trusted context and can call the API for the target tab.
	const cdp = await panelPage.createCDPSession();
	const openResult = await cdp.send('Runtime.evaluate', {
		expression: `chrome.sidePanel.open({ tabId: ${JSON.stringify(tabId)} })`,
		awaitPromise: true,
		returnByValue: true,
		userGesture: true,
	});
	await cdp.detach();
	if (openResult?.exceptionDetails) {
		throw new Error(`sidePanel.open failed: ${JSON.stringify(openResult.exceptionDetails)}`);
	}

	// Attach to the real sidepanel target (distinct from the tab-opened page).
	const sideTarget: Target = await browser.waitForTarget(
		(target) => target.url() === `chrome-extension://${extensionId}/sidepanel.html`
			&& target.type() !== 'service_worker' && target !== panelPage.target(),
		{ timeout: 15_000 },
	);
	const sidePage = await sideTarget.asPage();
	if (!sidePage) throw new Error('unable to attach to the real sidepanel target');
	// Keep the opener extension page alive for the whole sample: closing it can
	// cascade-close the side panel target mid-run in headless Chrome, which
	// surfaces as an intermittent TargetCloseError during later clicks.
	return { sidePage, panelPage };
}

interface SampleOutcome {
	samples: RuntimePerformanceSample[];
	browserVersion: string;
}

async function runSample(): Promise<SampleOutcome> {
	const profileDir = await mkdtemp(join(tmpdir(), 'halo-sidepanel-perf-'));
	const coldStarted = performance.now();
	const browser = await launchPuppeteerBrowser({
		...(EXPLICIT_CHROME ? { executablePath: EXPLICIT_CHROME } : {}),
		headless: true,
		userDataDir: profileDir,
		args: [
			`--disable-extensions-except=${DIST_PATH}`,
			`--load-extension=${DIST_PATH}`,
		],
	}, {
		owner: 'apps/extension-halo/test/sidepanel-performance.spec.ts',
		profile: { kind: 'temporary', prefix: 'halo-sidepanel-perf-', isolated: true },
	});
	try {
		const browserVersion = await browser.version();
		if (EXPECTED_CHROME) expect(browserVersion).toContain(EXPECTED_CHROME);
		const workerTarget: Target = await browser.waitForTarget(
			(target) => target.type() === 'service_worker'
				&& /^chrome-extension:\/\/[^/]+\/background\.js$/u.test(target.url()),
			{ timeout: 30_000 },
		);
		const extensionId = new URL(workerTarget.url()).host;

		const hostTab = await browser.newPage();
		await hostTab.goto('about:blank');
		const navigationStarted = performance.now();
		const { sidePage, panelPage } = await openRealSidepanel(browser, extensionId);

		// Populated Home readiness: the json-formatter tool entry is visible.
		await waitForVisiblePoint(sidePage, 'button[data-tool-id]', '', 15_000);
		await waitForVisiblePoint(sidePage, 'button[data-tool-id="json-formatter"]', '', 15_000);
		const interactiveAt = performance.now();
		const toolCount = await sidePage.evaluate(() => document.querySelectorAll('button[data-tool-id]').length);
		expect(toolCount).toBeGreaterThan(20); // home-populated
		const samples: RuntimePerformanceSample[] = [
			{
				metric: 'halo.sidepanel.cold-profile-to-interactive',
				value: interactiveAt - coldStarted,
				unit: 'ms',
			},
			{
				metric: 'halo.sidepanel.navigation-to-interactive',
				value: interactiveAt - navigationStarted,
				unit: 'ms',
			},
		];

		// Valid JSON formatting roundtrip.
		await clickVisible(sidePage, 'button[data-tool-id="json-formatter"]', '');
		await waitForVisiblePoint(sidePage, 'textarea', '', 10_000);
		const validStarted = performance.now();
		await setTextareaValue(sidePage, '{"representative":{"items":[1,2,3],"enabled":true}}');
		await clickVisible(sidePage, 'button', '✨ Format');
		await waitForTextareaValue(sidePage, /\n\s+"items": \[/u, 10_000);
		samples.push({
			metric: 'halo.json-formatter.valid-data-to-result',
			value: performance.now() - validStarted,
			unit: 'ms',
		}); // json-valid-result

		// Invalid JSON feedback.
		const invalidStarted = performance.now();
		await setTextareaValue(sidePage, '{"representative":');
		await clickVisible(sidePage, 'button', '✨ Format');
		await waitForPageText(sidePage, 'Invalid JSON', 10_000);
		samples.push({
			metric: 'halo.json-formatter.invalid-data-to-error',
			value: performance.now() - invalidStarted,
			unit: 'ms',
		}); // json-invalid-error

		// Back to Home, then a real pomodoro start-to-running transition.
		await clickVisible(sidePage, 'button', '←');
		await clickVisible(sidePage, 'button[data-tool-id="pomodoro"]', '');
		await waitForVisiblePoint(sidePage, 'button', '▶', 10_000);
		const pomodoroStarted = performance.now();
		await clickVisible(sidePage, 'button', '▶');
		await waitForVisiblePoint(sidePage, 'button', '⏸', 10_000);
		samples.push({
			metric: 'halo.pomodoro.start-to-running',
			value: performance.now() - pomodoroStarted,
			unit: 'ms',
		}); // pomodoro-running

		await hostTab.close().catch(() => undefined);
		await panelPage.close().catch(() => undefined);
		await sidePage.close().catch(() => undefined);
		return { samples, browserVersion };
	} finally {
		await browser.close().catch(() => undefined);
		await rm(profileDir, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 });
	}
}

test('records twenty independent real-SidePanel cold-interactive samples', async () => {
	const samples: RuntimePerformanceSample[] = [];
	let observedBrowserVersion = '';
	for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
		const outcome = await runSample();
		samples.push(...outcome.samples);
		if (!observedBrowserVersion) observedBrowserVersion = outcome.browserVersion;
	}
	writeRuntimePerformanceEvidence({
		product: 'halo',
		browser: { name: 'Chromium', version: observedBrowserVersion || 'unknown' },
		samples,
		profile: {
			id: 'halo-sidepanel-representative',
			scenario: 'Fresh SidePanel profiles measure populated Home readiness, valid and invalid JSON feedback, and a running Pomodoro transition.',
			isolation: 'fresh-profile-per-sample',
			businessAssertions: ['home-populated', 'json-valid-result', 'json-invalid-error', 'pomodoro-running'],
		},
		identity: runtimePerformanceIdentityFromEnvironment(),
	});
}, 300_000);

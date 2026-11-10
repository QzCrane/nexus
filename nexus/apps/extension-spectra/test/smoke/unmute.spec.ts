// goal: prove explicit unmute admission without an automation-created page gesture
// inv: isolated profile keeps persisted volume settings out of other media suites
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { launchPuppeteerBrowser } from '../../../../scripts/browser-driver';
import {
	SMOKE_TONE_WAV, browser, fixtureUrl, getTabId, prepareSmokeSession,
	startSmokeSession, submitEffectiveVolume, teardownSmokeSession, waitForContentBootstrapStatus,
} from './harness';

describe('SPECTRA built extension smoke: unmute', () => {
	beforeAll(async () => {
		const options = await prepareSmokeSession();
		await startSmokeSession(await launchPuppeteerBrowser(options, {
			owner: 'apps/extension-spectra/test/smoke/unmute.spec.ts',
			profile: { kind: 'temporary', prefix: 'spectra-smoke-', isolated: true },
		}));
	}, 60_000);
	afterAll(teardownSmokeSession);

	test('explicit volume unmutes browser-allowed playback without page activation', async () => {
		const page = await browser.newPage();
		const session = await page.createCDPSession();
		try {
			const url = `${fixtureUrl}?explicit-unmute=1`;
			await page.goto(url, { waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(url);
			// Puppeteer evaluate grants a gesture; CDP explicitly preserves the
			// unactivated document that an extension Popup cannot activate.
			const before = await session.send('Runtime.evaluate', {
				expression: `(async () => { const media = document.querySelector('#v'); media.src = 'data:audio/wav;base64,${Buffer.from(SMOKE_TONE_WAV).toString('base64')}'; media.loop = true; media.muted = true; await media.play(); return { active: navigator.userActivation.hasBeenActive, muted: media.muted, paused: media.paused }; })()`,
				userGesture: false, awaitPromise: true, returnByValue: true,
			});
			expect(before.result.value).toEqual({ active: false, muted: true, paused: false });
			await page.bringToFront();
			const tabId = await getTabId(url);
			await submitEffectiveVolume(tabId, 30);
			const after = await session.send('Runtime.evaluate', {
				expression: `(() => { const media = document.querySelector('#v'); return { active: navigator.userActivation.hasBeenActive, muted: media.muted, paused: media.paused, volume: media.volume }; })()`,
				userGesture: false, returnByValue: true,
			});
			expect(after.result.value).toEqual({ active: false, muted: false, paused: false, volume: 0.3 });
		} finally {
			await session.detach();
			await page.close();
		}
	}, 30_000);
});

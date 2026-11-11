// goal: prove the Action badge keeps following page-native audio facts across a
// worker restart, which is the state every long-lived tab eventually reaches
// rule: a page observation may refine a visible badge; the durable usage fact,
// not the worker's memory, decides whether this tab has one
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { launchPuppeteerBrowser } from '../../../../scripts/browser-driver';
import {
	eventually,
	fixturePage,
	fixtureUrl,
	getTabId,
	prepareSmokeSession,
	readBadgeText,
	evaluateServiceWorker,
	sendFromActionPopup,
	waitForContentBootstrapStatus,
	openActionPopupTarget,
	closeActionPopup,
	SMOKE_TONE_WAV,
	restartServiceWorker,
	startSmokeSession,
	submitPopupControlIntent,
	teardownSmokeSession,
} from './harness';

describe('SPECTRA built extension smoke: badge projection', () => {
	beforeAll(async () => {
		const options = await prepareSmokeSession();
		const launched = await launchPuppeteerBrowser(options, {
			owner: 'apps/extension-spectra/test/smoke/badge-projection.spec.ts',
			profile: { kind: 'temporary', prefix: 'spectra-smoke-', isolated: true },
		});
		await startSmokeSession(launched);
	}, 60_000);

	afterAll(async () => {
		await teardownSmokeSession();
	});

	test('keeps following page-native volume after the tab reaches a new document', async () => {
		const tabId = await getTabId(fixtureUrl);
		await fixturePage.bringToFront();
		await submitPopupControlIntent(tabId, { patch: { volumeBase: 80 } });
		expect(await eventually(() => readBadgeText(tabId), text => text === '80', 'usage badge')).toBe('80');
		// A route change the browser serves as a new document keeps the tab-scoped
		// Action projection while every in-memory fact of the old document is gone.
		await fixturePage.goto(`${fixtureUrl}?second-document=1`, { waitUntil: 'domcontentloaded' });
		await fixturePage.bringToFront();
		await new Promise((resolveWait) => setTimeout(resolveWait, 1500));
		await fixturePage.evaluate(() => {
			const media = document.querySelector<HTMLMediaElement>('video,audio');
			if (!media) throw new Error('fixture media is missing');
			media.volume = 0.55;
		});
		expect(await eventually(() => readBadgeText(tabId), text => text === '55', 'badge after navigation'))
			.toBe('55');
	}, 90_000);

	test('follows a page-native volume after the worker forgot its in-memory badge', async () => {
		// The previous test left this tab on its second document; restore the
		// fixture URL so the failure below can only come from badge state.
		await fixturePage.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
		const tabId = await getTabId(fixtureUrl);
		await fixturePage.bringToFront();

		// One extension gesture lights the badge and records durable usage.
		await submitPopupControlIntent(tabId, { patch: { volumeBase: 80 } });
		expect(await eventually(() => readBadgeText(tabId), (text) => text === '80', 'extension volume badge'))
			.toBe('80');
		expect(await fixturePage.evaluate(() => (
			document.querySelector<HTMLMediaElement>('video,audio')?.volume ?? -1
		))).toBeCloseTo(0.8, 2);

		// A real service-worker stop drops every in-memory fact. Chrome keeps the
		// tab-scoped Action projection and storage.session keeps the usage fact,
		// so the badge is still on screen; only the worker's memory of it is gone.
		await restartServiceWorker();
		expect(await readBadgeText(tabId)).toBe('80');

		// The page now moves its own volume. The badge is a projection of admitted
		// facts, so it has to follow without another extension gesture.
		await fixturePage.evaluate(() => {
			const media = document.querySelector<HTMLMediaElement>('video,audio');
			if (!media) throw new Error('fixture media is missing');
			media.volume = 0.55;
		});
		expect(await eventually(() => readBadgeText(tabId), (text) => text === '55', 'page-native volume badge'))
			.toBe('55');

		await fixturePage.evaluate(() => {
			const media = document.querySelector<HTMLMediaElement>('video,audio');
			if (!media) throw new Error('fixture media is missing');
			media.volume = 0.33;
		});
		expect(await eventually(() => readBadgeText(tabId), (text) => text === '33', 'second page-native volume badge'))
			.toBe('33');
	}, 90_000);

	test('keeps page sliders and mute observable after page settings release with Popup closed', async () => {
		await fixturePage.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
		const tabId = await getTabId(fixtureUrl);
		await fixturePage.bringToFront();
		await fixturePage.evaluate(async bytes => {
			const media = document.querySelector<HTMLMediaElement>('video,audio');
			if (!media) throw new Error('Missing website media');
			media.src = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'audio/wav' }));
			media.loop = true; await media.play();
		}, [...SMOKE_TONE_WAV]);
		const seeded = await submitPopupControlIntent(tabId, { patch: { volumeBase: 80 } });
		expect(seeded.ok).toBe(true);
		await eventually(() => readBadgeText(tabId), text => text === '80', 'seed badge');
		const released = await sendFromActionPopup<{ ok: boolean }>({
			protocolVersion: 2, type: 'spectra.control.operation.submit', tabId,
			payload: { tabId, source: 'popup', target: null, operation: 'restore-page-settings', payload: {} },
		});
		expect(released.ok).toBe(true);
		// Releasing page settings retires the desired template. The document still
		// holds media, so the runtime legitimately stays as a read-only observation
		// owner (spec I2): nothing may remain owned or desired, while native events
		// must still reach the background without opening a Popup.
		await eventually(() => waitForContentBootstrapStatus(fixtureUrl), state =>
			state.mediaIntentState === 'released' && state.ownedSources.length === 0,
		'page settings release retires the desired template');
		// This is the page's own input handler. Native events must reach the
		// background without opening a Popup, requesting actual, or retaining a
		// test runtime lease. Observe stored facts and Chrome's Action only.
		await fixturePage.evaluate(() => {
			const slider = document.createElement('input');
			slider.id = 'website-volume'; slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.value = '100';
			slider.addEventListener('input', () => {
				const media = document.querySelector<HTMLMediaElement>('video,audio');
				if (!media) throw new Error('Missing website media');
				media.volume = Number(slider.value) / 100;
			});
			document.body.append(slider);
		});
		const observed = () => evaluateServiceWorker(async id => {
			const key = `spectra.control.tab.${id}`;
			const state = (await chrome.storage.local.get(key))[key];
			return { volume: state?.fields?.volumeBase?.actual, muted: state?.fields?.mediaMuted?.actual,
				speed: state?.fields?.speed?.actual,
				badge: await chrome.action.getBadgeText({ tabId: id }) };
		}, tabId);
		try {
			await fixturePage.focus('#website-volume');
			await fixturePage.keyboard.press('Home');
			expect(await eventually(observed, state => state.volume === 0 && state.badge === 'M',
				'website slider zero reaches badge with no Popup')).toMatchObject({ volume: 0, badge: 'M' });
			await fixturePage.keyboard.press('ArrowRight');
			expect(await eventually(observed, state => state.volume === 1 && state.badge === '1',
				'website slider positive reaches badge with no Popup')).toMatchObject({ volume: 1, badge: '1' });
			await fixturePage.evaluate(() => {
				const media = document.querySelector<HTMLMediaElement>('video,audio');
				if (!media) throw new Error('Missing website media');
				media.volume = 0.37;
				const preview = document.createElement('video'); preview.id = 'inactive-preview'; preview.hidden = true;
				document.body.append(preview); preview.volume = 0.13; preview.muted = true;
			});
			expect(await eventually(observed, state => state.volume === 37 && state.badge === '37',
				'inactive preview event cannot replace the selected player')).toMatchObject({ volume: 37, muted: false, badge: '37' });
			await fixturePage.evaluate(() => {
				const media = document.querySelector<HTMLMediaElement>('video,audio');
				if (!media) throw new Error('Missing website media');
				media.volume = 0.37; media.playbackRate = 1.5; media.preservesPitch = false;
			});
			expect(await eventually(observed, state => state.volume === 37 && state.speed === 1.5 && state.badge === '37',
				'coalesced website fields retain the latest physical values')).toMatchObject({ volume: 37, speed: 1.5, badge: '37' });
			await fixturePage.evaluate(() => { const media = document.querySelector<HTMLMediaElement>('video,audio'); if (media) media.muted = true; });
			expect(await eventually(observed, state => state.muted === true && state.badge === 'M',
				'website mute reaches badge with no Popup')).toMatchObject({ volume: 37, muted: true, badge: 'M' });
			expect(await waitForContentBootstrapStatus(fixtureUrl)).toMatchObject({
				ready: true, ownedSources: [], mediaIntentState: 'released',
			});
			// A read-only Popup visit must not recreate the released desired
			// template; observation ownership stays with the document's media.
			const popup = await (await openActionPopupTarget()).asPage();
			try {
				await popup.waitForSelector(`.glass-card[data-tab-id="${tabId}"] .vol-slider`);
				expect(await waitForContentBootstrapStatus(fixtureUrl)).toMatchObject({
					ownedSources: [], mediaIntentState: 'released',
				});
			} finally { await closeActionPopup(popup); }
			await eventually(() => waitForContentBootstrapStatus(fixtureUrl), state =>
				state.ready && state.ownedSources.length === 0 && state.mediaIntentState === 'released',
			'Popup close keeps the observation-only runtime');
			await fixturePage.evaluate(() => { const media = document.querySelector<HTMLMediaElement>('video,audio'); if (media) { media.muted = false; media.volume = 0.62; } });
			expect(await eventually(observed, state => state.volume === 62 && !state.muted && state.badge === '62',
				'website changes still synchronize after a second Popup close')).toMatchObject({ volume: 62, muted: false, badge: '62' });
		} finally {
			await fixturePage.evaluate(() => {
				document.querySelector('#website-volume')?.remove(); document.querySelector('#inactive-preview')?.remove();
			});
		}
	}, 30_000);
});

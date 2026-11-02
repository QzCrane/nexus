import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { ControlApplyAck, ControlPatch } from '@nexus/contracts';
import { launchPuppeteerBrowser } from '../../../../scripts/browser-driver';
import {
	acquireSmokeRuntime,
	browser,
	createSmokeToneWav,
	evaluateServiceWorker,
	eventually,
	getTabId,
	openActionPopupTarget,
	closeActionPopup,
	prepareSmokeSession,
	openExtensionClient,
	patchExtensionSettings,
	readContentBootstrapStatus,
	reinjectContentBootstrap,
	releaseSmokeRuntimes,
	startSmokeSession,
	teardownSmokeSession,
	waitForContentBootstrapStatus,
} from './harness';
import type { SmokeRpcResult } from './harness';

const fixtureHtml = readFileSync(new URL('../fixtures/speed-toolbar.html', import.meta.url), 'utf8');
const liveFixtureHtml = readFileSync(new URL('../fixtures/live-volume.html', import.meta.url), 'utf8');
const labelSelector = '.xgplayer-setting-playbackRatio';

async function openPlayer(query = '', origin = 'https://www.douyin.com', html = fixtureHtml) {
	const page = await browser.newPage();
	await page.setRequestInterception(true);
	page.on('request', (request) => {
		// Entirely local fixture, exercising the manifest's real document_start
		// entries at a declared origin without changing any live site/account.
		void request.respond(request.url().endsWith('/tone.wav')
			? { status: 200, contentType: 'audio/wav', body: Buffer.from(createSmokeToneWav()) }
			: { status: 200, contentType: 'text/html; charset=utf-8', body: html });
	});
	await page.goto(`${origin}/video/spectra-speed-toolbar${query}`, { waitUntil: 'load' });
	await waitForContentBootstrapStatus(page.url());
	return page;
}

async function executeNative(url: string, patch: ControlPatch, source: 'popup' | 'restore' = 'popup') {
	const lease = await acquireSmokeRuntime(url, 'speed-toolbar-physical');
	return evaluateServiceWorker(async ({ owned, changes, intentSource }) => chrome.tabs.sendMessage(owned.tabId, {
		protocolVersion: 2, requestId: crypto.randomUUID(), tabId: owned.tabId, documentId: owned.documentId, generation: 1,
		type: 'spectra.control.intent.execute',
		payload: {
			intentId: crypto.randomUUID(), tabId: owned.tabId, documentId: owned.documentId,
			generation: 1, baseRevision: 0, source: intentSource, requestedCoverage: 'active-target',
			target: null, actualContext: {}, patch: changes,
		},
	}), { owned: lease, changes: patch, intentSource: source }) as Promise<SmokeRpcResult<ControlApplyAck>>;
}

describe('SPECTRA built extension smoke: actual speed toolbar', () => {
	beforeAll(async () => {
		const options = await prepareSmokeSession();
		// This suite must exercise the browser's real document-activation policy.
		options.args = options.args?.filter((argument) => !argument.startsWith('--autoplay-policy='));
		const launched = await launchPuppeteerBrowser(options, {
			owner: 'apps/extension-spectra/test/smoke/speed-toolbar.spec.ts',
			profile: { kind: 'temporary', prefix: 'spectra-smoke-', isolated: true },
		});
		await startSmokeSession(launched);
	}, 60_000);

	afterAll(async () => {
		await teardownSmokeSession();
	});

	test.each([1, 1.3])('shows actual %sx on first open without a controller, menu action, or heavy runtime', async (rate) => {
		const page = await openPlayer(`?rate=${rate}`);
		try {
			await eventually(
				() => page.evaluate(() => (window as Window & { firstFrameLabel?: string }).firstFrameLabel),
				(text) => text === `${rate}x`,
				'actual rate on the first rendered frame',
			);
			expect(await page.$eval(labelSelector, (label) => label.textContent)).toBe(`${rate}x`);
			expect(await readContentBootstrapStatus(page.url())).toMatchObject({ ready: false, runtimeRevision: null });
			if (rate === 1) {
				expect(await page.evaluate(() => (window as Window & { rateEvents?: number }).rateEvents)).toBe(0);
			} else {
				expect(await page.$('.xgplayer-playratio-item.select')).toBeNull();
			}
		} finally { await page.close(); }
	}, 20_000);

	test('tracks actual native changes, a late label, and React replacing the text node', async () => {
		const page = await openPlayer('?rate=1.3&late=1');
		try {
			await page.evaluate(() => {
				const label = document.createElement('div');
				label.className = 'xgplayer-setting-playbackRatio';
				label.textContent = '倍速';
				document.querySelector('#player')?.append(label);
			});
			await eventually(() => page.$eval(labelSelector, (label) => label.textContent), (text) => text === '1.3x', 'late toolbar');
			await page.evaluate(() => {
				const video = document.querySelector('video');
				const label = document.querySelector('.xgplayer-setting-playbackRatio');
				if (!video || !label) throw new Error('Missing player');
				video.playbackRate = 2.35;
				label.replaceWith(label.cloneNode(true));
				const replacement = document.querySelector('.xgplayer-setting-playbackRatio');
				if (replacement) replacement.textContent = '倍速';
			});
			await eventually(() => page.$eval(labelSelector, (label) => label.textContent), (text) => text === '2.35x', 'recreated toolbar at an unlisted rate');
			await page.evaluate(() => {
				const label = document.querySelector('.xgplayer-setting-playbackRatio');
				if (label?.firstChild) label.firstChild.nodeValue = '倍速';
			});
			await eventually(() => page.$eval(labelSelector, (label) => label.textContent), (text) => text === '2.35x', 'React text reconciliation');
			expect(await page.$('.xgplayer-playratio-item.select')).toBeNull();
		} finally { await page.close(); }
	}, 20_000);

	test('keeps independent player roots isolated and preserves other controls', async () => {
		const page = await openPlayer();
		try {
			await page.evaluate(() => {
				const previous = document.querySelector('#player');
				if (!previous) throw new Error('Missing player');
				const next = previous.cloneNode(true) as HTMLElement;
				next.id = 'next';
				document.body.append(next);
				const media = next.querySelector('video');
				if (!media) throw new Error('Missing next media');
				media.playbackRate = 0.75;
			});
			await eventually(() => page.$$eval(labelSelector, (labels) => labels.map((label) => label.textContent)),
				(labels) => labels.join(',') === '1x,0.75x', 'each toolbar bound to its own video');
			expect(await page.$$eval('.xgplayer-playratio-item', (items) => items.map((item) => item.textContent)))
				.toEqual(['1.0x', '1.5x', '1.0x', '1.5x']);
		} finally { await page.close(); }
	}, 20_000);

	test('survives runtime acquisition/release and reinjection, and stops at bootstrap disposal', async () => {
		const page = await openPlayer();
		try {
			await acquireSmokeRuntime(page.url(), 'speed-toolbar');
			expect(await readContentBootstrapStatus(page.url())).toMatchObject({ ready: true });
			await page.$eval('video', (video) => { video.playbackRate = 1.3; });
			await eventually(() => page.$eval(labelSelector, (label) => label.textContent), (text) => text === '1.3x', 'label while runtime is resident');
			await releaseSmokeRuntimes();
			expect((await reinjectContentBootstrap(page.url())).same).toBe(true);
			expect((await reinjectContentBootstrap(page.url(), true)).same).toBe(false);
			expect(await page.$eval(labelSelector, (label) => label.textContent)).toBe('1.3x');
			const tabId = await getTabId(page.url());
			await evaluateServiceWorker(async (targetTabId) => chrome.scripting.executeScript({
				target: { tabId: targetTabId },
				func: () => (window as Window & { __SPECTRA_CONTENT_BOOTSTRAP__?: { dispose(): void } })
					.__SPECTRA_CONTENT_BOOTSTRAP__?.dispose(),
			}), tabId);
			expect(await page.$eval(labelSelector, (label) => label.textContent)).toBe('倍速');
			await page.$eval('video', (video) => new Promise<void>((resolve) => {
				video.addEventListener('ratechange', () => resolve(), { once: true });
				video.playbackRate = 2;
			}));
			expect(await page.$eval(labelSelector, (label) => label.textContent)).toBe('倍速');
		} finally {
			await releaseSmokeRuntimes();
			await page.close();
		}
	}, 25_000);

	test('does not guess a rate for multiple media in the same root or overwrite nested controls', async () => {
		const page = await openPlayer();
		try {
			await page.evaluate(() => {
				const root = document.querySelector('#player');
				if (!root) throw new Error('Missing player');
				root.append(document.createElement('video'));
			});
			await eventually(() => page.$eval(labelSelector, (label) => label.textContent), (text) => text === '倍速', 'ambiguous root releases the label');
			await page.evaluate(() => {
				document.querySelectorAll('video')[1]?.remove();
				const label = document.querySelector('.xgplayer-setting-playbackRatio');
				const control = document.createElement('button');
				control.textContent = 'Keep control';
				label?.append(control);
				const media = document.querySelector('video');
				if (media) media.playbackRate = 1.3;
			});
			expect(await page.$eval(`${labelSelector} button`, (button) => button.textContent)).toBe('Keep control');
		} finally { await page.close(); }
	}, 20_000);

	test('does not project labels on an unrelated host', async () => {
		const page = await openPlayer('?rate=1.3', 'https://example.test');
		try {
			expect(await page.$eval(labelSelector, (label) => label.textContent)).toBe('倍速');
		} finally { await page.close(); }
	}, 20_000);

	test('keeps the toolbar, actual readback and ACK coherent when a page controller cannot play a free rate', async () => {
		const page = await openPlayer('?controller=1');
		try {
			expect(await executeNative(page.url(), { speed: 1.5 })).toMatchObject({
				ok: true, data: { fields: { speed: { phase: 'applied', strategy: 'page-native', actual: 1.5 } } },
			});
			for (const speed of [1.3, 1.4]) {
				expect(await executeNative(page.url(), { speed })).toMatchObject({
					ok: true, data: { fields: { speed: { phase: 'applied', strategy: 'dom-native', actual: speed } } },
				});
				await eventually(() => page.$eval(labelSelector, (label) => label.textContent), (text) => text === `${speed}x`, 'consecutive free speeds after page-to-DOM handoff');
				expect(await page.$eval('video', (video) => video.playbackRate)).toBe(speed);
			}
			expect(await page.$('.xgplayer-playratio-item.select')).not.toBeNull();
			// A stale selected menu option is not allowed to overwrite actual speed.
			const lease = await acquireSmokeRuntime(page.url(), 'speed-toolbar-physical');
			const read = await evaluateServiceWorker(async (owned) => chrome.tabs.sendMessage(owned.tabId, {
				protocolVersion: 2, requestId: crypto.randomUUID(), tabId: owned.tabId,
				type: 'spectra.control.actual.read', payload: { target: null, fields: ['speed'] },
			}), lease);
			expect(read).toMatchObject({ ok: true, data: { patch: { speed: 1.4 }, observedStrategies: { speed: 'dom-native' } } });
		} finally {
			await releaseSmokeRuntimes();
			await page.close();
		}
	}, 20_000);

	test('applies unlisted live speeds without a trial, clamp or baseline bounce', async () => {
		const page = await openPlayer('?controller=1', 'https://live.douyin.com');
		try {
			await page.bringToFront();
			await executeNative(page.url(), { speed: 1.5 });
			await page.evaluate(() => { Object.assign(window, { speedWrites: [] }); });
			for (const speed of [1.3, 1.4]) {
				await page.evaluate(() => {
					const media = document.querySelector('video');
					if (!media) throw new Error('Missing media');
					const trace: Array<{ rate: number; label: string | null }> = [];
					const sample = () => trace.push({ rate: media.playbackRate, label: document.querySelector('.xgplayer-setting-playbackRatio')?.textContent ?? null });
					media.addEventListener('ratechange', sample);
					Object.assign(window, { speedTrace: trace, stopSpeedTrace: () => media.removeEventListener('ratechange', sample) });
				});
				expect(await executeNative(page.url(), { speed })).toMatchObject({
					ok: true, data: { fields: { speed: { phase: 'applied', strategy: 'dom-native', actual: speed } } },
				});
				const trace = await page.evaluate(() => {
					const scope = window as Window & { speedTrace?: Array<{ rate: number; label: string | null }>; stopSpeedTrace?: () => void };
					scope.stopSpeedTrace?.();
					return scope.speedTrace;
				});
				expect(trace?.length).toBeGreaterThan(0);
				expect(trace?.every((sample) => sample.rate === speed && sample.label === `${speed}x`)).toBe(true);
			}
			expect(await page.evaluate(() => (window as Window & { speedWrites?: number[] }).speedWrites)).toEqual([]);
		} finally {
			await releaseSmokeRuntimes();
			await page.close();
		}
	}, 20_000);

	test('reads physical speed through cold bootstrap, full runtime and release despite a stale controller', async () => {
		const page = await openPlayer('?controller=1&rate=1.3');
		const tabId = await getTabId(page.url());
		const read = () => evaluateServiceWorker(async (targetTabId) => chrome.tabs.sendMessage(targetTabId, {
			protocolVersion: 2, requestId: crypto.randomUUID(), tabId: targetTabId,
			type: 'spectra.control.actual.read', payload: { target: null, fields: ['speed'] },
		}), tabId);
		const expected = { ok: true, data: { patch: { speed: 1.3 }, observedStrategies: { speed: 'dom-native' } } };
		try {
			expect(await readContentBootstrapStatus(page.url())).toMatchObject({ ready: false });
			expect(await read()).toMatchObject(expected);
			await acquireSmokeRuntime(page.url(), 'speed-toolbar-physical');
			expect(await read()).toMatchObject(expected);
			await releaseSmokeRuntimes();
			await eventually(() => readContentBootstrapStatus(page.url()), (status) => !status.ready, 'runtime released to bootstrap');
			expect(await read()).toMatchObject(expected);
		} finally {
			await releaseSmokeRuntimes();
			await page.close();
		}
	}, 20_000);

	test('the real live Action Popup sets an unlisted speed without changing the page controller', async () => {
		const page = await openPlayer('?controller=1', 'https://live.douyin.com');
		const tabId = await getTabId(page.url());
		await page.bringToFront();
		const popup = await (await openActionPopupTarget()).asPage();
		const inputSelector = `.glass-card[data-tab-id="${tabId}"] .speed-input`;
		try {
			await popup.waitForSelector(inputSelector);
			await popup.$eval(inputSelector, (input) => {
				(input as HTMLInputElement).value = '1.3';
				input.dispatchEvent(new Event('change', { bubbles: true }));
				(input as HTMLInputElement).blur();
			});
			await eventually(() => page.$eval('video', (video) => video.playbackRate), (speed) => speed === 1.3, 'Popup changes physical live speed');
			await eventually(() => popup.$eval(inputSelector, (input) => (input as HTMLInputElement).value), (value) => Number(value) === 1.3, 'Popup keeps the acknowledged free speed');
			expect(await page.$eval(labelSelector, (label) => label.textContent)).toBe('1.3x');
			expect(await page.evaluate(() => (window as Window & { speedWrites?: number[] }).speedWrites)).toEqual([]);
		} finally {
			await closeActionPopup(popup);
			await page.close();
		}
	}, 20_000);

	test('preserves muted autoplay while restoring a speed preset and admits unmute only after page interaction', async () => {
		const client = await openExtensionClient('options.html');
		await patchExtensionSettings(client, { scope: 'audio-site', domain: 'www.douyin.com', value: { speed: 1.3 } });
		const page = await openPlayer('?autoplay=1');
		const passiveClient = await page.createCDPSession();
		// Puppeteer's evaluate/$eval deliberately sets userGesture:true. Using it
		// to inspect this regression would itself grant the missing activation.
		const sample = async () => {
			const result = await passiveClient.send('Runtime.evaluate', {
				expression: `(() => { const video = document.querySelector('video'); return { muted: video.muted, paused: video.paused, speed: video.playbackRate, activated: navigator.userActivation.hasBeenActive }; })()`,
				userGesture: false, returnByValue: true,
			});
			return result.result.value as { muted: boolean; paused: boolean; speed: number; activated: boolean };
		};
		try {
			await eventually(sample,
				(state) => state.muted && !state.paused && state.speed === 1.3, 'speed restore without unmuting or pausing autoplay');
			expect((await sample()).activated).toBe(false);
			const blocked = await executeNative(page.url(), { mediaMuted: false });
			expect(blocked).toMatchObject({ ok: true, data: { fields: { mediaMuted: { phase: 'error', lastError: { code: 'user-activation-required', retryable: false } } } } });
			expect(await sample()).toMatchObject({ muted: true, paused: false, activated: false });
			await page.click('#activate');
			expect(await page.evaluate(() => navigator.userActivation.hasBeenActive)).toBe(true);
			expect(await executeNative(page.url(), { mediaMuted: false })).toMatchObject({
				ok: true, data: { fields: { mediaMuted: { phase: 'applied', actual: false } } },
			});
			expect(await page.$eval('video', (video) => video.paused)).toBe(false);
		} finally {
			await passiveClient.detach();
			await releaseSmokeRuntimes();
			await page.close();
			await patchExtensionSettings(client, { scope: 'audio-site', domain: 'www.douyin.com', value: null });
			await client.close();
		}
	}, 20_000);

	test.each([false, true])('synchronizes live volume through the real Action Popup slider (site unmuted: %s)', async (unmuteSite) => {
		const page = await openPlayer('', 'https://live.douyin.com', liveFixtureHtml);
		const tabId = await getTabId(page.url());
		await page.bringToFront();
		if (unmuteSite) await page.click('#site-mute');
		const target = await openActionPopupTarget();
		const popup = await target.asPage();
		const slider = `.glass-card[data-tab-id="${tabId}"] .vol-slider`;
		try {
			await popup.waitForSelector(slider);
			await page.$eval('#site-volume', (input) => {
				(input as HTMLInputElement).value = '60';
				input.dispatchEvent(new Event('input', { bubbles: true }));
			});
			await eventually(() => popup.$eval(slider, (input) => (input as HTMLInputElement).value),
				(value) => value === '60', 'site volume reaches live Popup');
			await popup.$eval(slider, (input) => {
				(input as HTMLInputElement).value = '40';
				input.dispatchEvent(new Event('input', { bubbles: true }));
				input.dispatchEvent(new Event('change', { bubbles: true }));
			});
			await eventually(() => page.$eval('video', (video) => video.volume),
				(value) => value === 0.4, 'Popup continuous channel changes actual live volume');
			expect(await page.$eval('#site-number', (number) => number.textContent)).toBe('40');
			await page.$eval('#site-volume', (input) => {
				(input as HTMLInputElement).value = '80';
				input.dispatchEvent(new Event('input', { bubbles: true }));
			});
			await eventually(() => popup.$eval(slider, (input) => (input as HTMLInputElement).value),
				(value) => value === '80', 'page change supersedes acknowledged extension volume');
			expect(await page.$eval('video', (video) => ({ muted: video.muted, paused: video.paused })))
				.toEqual({ muted: !unmuteSite, paused: false });
		} catch (error) {
			console.error('Live volume diagnostic', JSON.stringify({
				bootstrap: await readContentBootstrapStatus(page.url()),
				physical: await page.$eval('video', (video) => ({ volume: video.volume, muted: video.muted, paused: video.paused })),
				popup: await popup.evaluate(async (id) => ({
					cards: [...document.querySelectorAll('.glass-card')].map((card) => ({ tab: (card as HTMLElement).dataset.tabId, value: card.querySelector<HTMLInputElement>('.vol-slider')?.value, status: card.querySelector('.control-sync-status')?.textContent })),
					stored: await chrome.storage.local.get(`spectra.control.tab.${id}`),
					view: await chrome.runtime.sendMessage({ protocolVersion: 2, requestId: crypto.randomUUID(), tabId: id, type: 'spectra.control.snapshot.get', payload: { tabId: id } }),
				} ), tabId),
				read: await evaluateServiceWorker(async (id) => chrome.tabs.sendMessage(id, { protocolVersion: 2, requestId: crypto.randomUUID(), tabId: id, type: 'spectra.control.actual.read', payload: { target: null, fields: ['volumeBase', 'mediaMuted'] } }), tabId),
			}));
			throw error;
		} finally {
			await closeActionPopup(popup);
			await page.close();
		}
	}, 25_000);
});

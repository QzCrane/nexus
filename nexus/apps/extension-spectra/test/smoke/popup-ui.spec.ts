import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { launchPuppeteerBrowser } from '../../../../scripts/browser-driver';
import type { Page } from 'puppeteer';
import type { MediaRouteRulesSnapshot, MediaRouteDecision } from '@nexus/contracts';
import { requireValue } from '../helpers/require-value';
import { EXTENSION_COMMAND_COUNT, browser, closeActionPopup, collectPageErrors, evaluateServiceWorker, eventually, extensionId, fixtureErrors, fixturePage, fixtureUrl, getOffscreenContextCount, getTabId, inspectExtensionAccessibility, inspectExtensionLayout, installPageMediaControllerHarness, openActionPopupTarget, openExtensionClient, readBadgeText, readPageMediaControllerHarness, readSiteRouteRegistry, removePageMediaControllerHarness, restartServiceWorker, sendExtensionMessage, sendFromActionPopup, submitEffectiveVolume, submitPopupControlIntent, updatePageMediaControllerHarness, waitForContentBootstrapStatus } from './harness';
import type { SmokeRpcResult } from './harness';
import { prepareSmokeSession, startSmokeSession, teardownSmokeSession } from './harness';

describe('SPECTRA built extension smoke: popup-ui', () => {
	beforeAll(async () => {
		const options = await prepareSmokeSession();
		const launched = await launchPuppeteerBrowser(options, {
			owner: 'apps/extension-spectra/test/smoke/popup-ui.spec.ts',
			profile: { kind: 'temporary', prefix: 'spectra-smoke-', isolated: true },
		});
		await startSmokeSession(launched);
	}, 60_000);

	afterAll(async () => {
		await teardownSmokeSession();
	});

	test('synchronizes page-native media bidirectionally through Popup and the mute hotkey', async () => {
		await installPageMediaControllerHarness();
		await fixturePage.bringToFront();
		const tabId = await getTabId(fixturePage.url());
		const popupTarget = await openActionPopupTarget();
		const popup = await popupTarget.asPage();
		const popupErrors: string[] = [];
		popup.on('pageerror', (error) => popupErrors.push(error.message));
		const readSnapshot = () => popup.evaluate(async (targetTabId) => chrome.runtime.sendMessage({
			protocolVersion: 2,
			requestId: crypto.randomUUID(),
			tabId: targetTabId,
			type: 'spectra.control.snapshot.get',
			payload: { tabId: targetTabId },
		}), tabId) as Promise<{
			ok: boolean;
			data?: { fields: Record<string, { actual?: unknown; strategy?: string; controlled?: boolean }> };
			error?: { message?: string };
		}>;

		try {
			await popup.waitForSelector('.glass-card .vol-slider', { timeout: 8_000 });
			await popup.waitForFunction(() => {
				const volume = document.querySelector<HTMLInputElement>('.vol-slider');
				const speed = document.querySelector<HTMLInputElement>('.speed-input');
				return volume?.value === '100' && speed?.value === '1.00';
			}, { timeout: 8_000 });
			const initial = await readSnapshot();
			expect(initial).toMatchObject({
				ok: true,
				data: {
					fields: {
						volumeBase: { actual: 100, strategy: 'page-native' },
						mediaMuted: { actual: false, strategy: 'page-native' },
						speed: { actual: 1, strategy: 'page-native' },
					},
				},
			});

			await popup.$eval('.vol-slider', (element) => {
				const slider = element as HTMLInputElement;
				slider.value = '40';
				slider.dispatchEvent(new Event('input', { bubbles: true }));
				slider.dispatchEvent(new Event('change', { bubbles: true }));
			});
			await eventually(
				readPageMediaControllerHarness,
				(state) => state.volumeBase === 40 && Math.abs(state.domVolume - 0.24524) < 0.00001,
				'Popup page-native volume ACK',
			);

			await popup.$eval('.speed-input', (element) => {
				const input = element as HTMLInputElement;
				input.value = '1.50';
				input.dispatchEvent(new Event('change', { bubbles: true }));
			});
			await eventually(
				readPageMediaControllerHarness,
				(state) => state.speed === 1.5 && state.domSpeed === 1.5,
				'Popup page-native speed ACK',
			);

			await popup.click('.btn-mute');
			await eventually(
				readPageMediaControllerHarness,
				(state) => state.mediaMuted && !state.domMuted,
				'Popup controller-only mute ACK',
			);
			await eventually(
				readSnapshot,
				(snapshot) => snapshot.ok
					&& snapshot.data?.fields.volumeBase?.actual === 40
					&& snapshot.data.fields.speed?.actual === 1.5
					&& snapshot.data.fields.mediaMuted?.actual === true,
				'committed page-native Popup transaction',
			);

			await updatePageMediaControllerHarness({
				volumeBase: 70,
				mediaMuted: false,
				speed: 1.25,
			});
			await popup.waitForFunction(() => {
				const volume = document.querySelector<HTMLInputElement>('.vol-slider');
				const speed = document.querySelector<HTMLInputElement>('.speed-input');
				const mute = document.querySelector<HTMLElement>('.btn-mute');
				return volume?.value === '70'
					&& speed?.value === '1.25'
					&& mute?.getAttribute('aria-pressed') === 'false';
			}, { timeout: 8_000 });
			const pageObservationSnapshot = await readSnapshot();
			expect(pageObservationSnapshot).toMatchObject({
				ok: true,
				data: {
					fields: {
						volumeBase: { actual: 70, strategy: 'page-native' },
						mediaMuted: { actual: false, strategy: 'page-native' },
						speed: { actual: 1.25, strategy: 'page-native' },
					},
				},
			});
			// The first page event may have been the correlated tail of the preceding
			// Popup transaction. Re-emit the stable page value after its ACK so this
			// assertion exercises a genuine post-transaction page gesture.
			await updatePageMediaControllerHarness({ mediaMuted: false });

			const hotkey = await evaluateServiceWorker(async (targetTabId) => chrome.tabs.sendMessage(
				targetTabId,
				{
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					tabId: targetTabId,
					type: 'spectra.hotkey.trigger',
					payload: { action: 'volume_mute' },
				},
			), tabId);
			expect(hotkey).toMatchObject({ ok: true });
			await eventually(
				readPageMediaControllerHarness,
				(state) => state.mediaMuted && !state.domMuted,
				'controller-only mute hotkey ACK',
			);
			await popup.waitForFunction(() => (
				document.querySelector('.btn-mute')?.getAttribute('aria-pressed') === 'true'
			), { timeout: 8_000 });
			const finalSnapshot = await readSnapshot();
			expect(finalSnapshot).toMatchObject({
				ok: true,
				data: {
					fields: {
						volumeBase: { actual: 70, strategy: 'page-native' },
						mediaMuted: { actual: true, strategy: 'page-native' },
						speed: { actual: 1.25, strategy: 'page-native' },
					},
				},
			});
		} finally {
			await closeActionPopup(popup);
			await removePageMediaControllerHarness();
		}
		expect(popupErrors).toEqual([]);
	}, 35_000);

	test('restores durable acknowledged state and sticky badge after worker replacement plus refresh', async () => {
		// The preceding SPA test intentionally leaves a history-only /spa/media
		// URL that this fixture server does not serve on a real reload. Establish
		// the canonical document explicitly so this test owns its navigation.
		await fixturePage.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
		await waitForContentBootstrapStatus(fixtureUrl);
		await fixturePage.bringToFront();
		const tabId = await getTabId(fixturePage.url());
		try {
			await submitEffectiveVolume(tabId, 63);
			const speed = await submitPopupControlIntent(
				tabId,
				{ patch: { mediaMuted: false, speed: 1.75 } },
			);
			if (!speed.ok) {
				throw new Error(speed.error?.message ?? 'Unable to set refresh mute and speed');
			}
			await eventually(
				() => fixturePage.evaluate(() => {
					const media = document.querySelector<HTMLMediaElement>('#v');
					return { volume: media?.volume ?? null, speed: media?.playbackRate ?? null };
				}),
				(state) => state.volume !== null
					&& Math.abs(state.volume - 0.63) < 0.000_001
					&& state.speed === 1.75,
				'pre-refresh acknowledged media state',
			);
			expect(await readBadgeText(tabId)).toBe('63');

			await restartServiceWorker();
			const durableProjection = await evaluateServiceWorker(async (targetTabId) => {
				const key = `tab_session_${targetTabId}`;
				const stored = (await chrome.storage.session.get(key))[key] as {
					patch?: Record<string, unknown>;
				} | undefined;
				return stored?.patch ?? null;
			}, tabId);
			expect(durableProjection).toMatchObject({
				volumeBase: 63,
				boost: 1,
				mediaMuted: false,
				speed: 1.75,
			});

			await fixturePage.reload({ waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(fixturePage.url());
			await eventually(
				() => fixturePage.evaluate(() => {
					const media = document.querySelector<HTMLMediaElement>('#v');
					return { volume: media?.volume ?? null, speed: media?.playbackRate ?? null };
				}),
				(state) => state.volume !== null
					&& Math.abs(state.volume - 0.63) < 0.000_001
					&& state.speed === 1.75,
				'post-refresh restored media state',
				10_000,
			);
			await eventually(
				() => readBadgeText(tabId),
				(text) => text === '63',
				'post-refresh sticky badge projection',
				5_000,
			);
			const snapshot = await sendFromActionPopup<{
				ok: boolean;
				data?: { fields?: Record<string, { actual?: unknown }> };
			}>({
				protocolVersion: 2,
				tabId,
				type: 'spectra.control.snapshot.get',
				payload: { tabId },
			});
			expect(snapshot).toMatchObject({
				ok: true,
				data: {
					fields: {
						volumeBase: { actual: 63 },
						mediaMuted: { actual: false },
						speed: { actual: 1.75 },
					},
				},
			});
		} finally {
			await submitEffectiveVolume(tabId, 100).catch(() => undefined);
			await submitPopupControlIntent(
				tabId,
				{ patch: { mediaMuted: false, speed: 1 } },
			).catch(() => undefined);
		}
	}, 35_000);

	test('applies a site preset before the default global preset after worker replacement', async () => {
		const presetName = 'smoke-initialization-default';
		const siteUrl = new URL(fixtureUrl);
		siteUrl.hostname = 'localhost';
		siteUrl.search = '?site-preset=1';
		const globalUrl = new URL(fixtureUrl);
		globalUrl.search = '?global-preset=1';
		const client = await openExtensionClient();
		const original = await client.evaluate(async ({ presetName }) => {
			const send = (type: string, payload: Record<string, unknown>) => chrome.runtime.sendMessage({
				protocolVersion: 2,
				requestId: crypto.randomUUID(),
				type,
				payload,
			});
			let snapshot = await send('spectra.settings.get', {});
			if (!snapshot?.ok) throw new Error(snapshot?.error?.message ?? 'Unable to read preset baseline');
			const baseline = {
				defaultPresetId: snapshot.data.defaultPresetId,
				localSite: snapshot.data.audioSites.localhost ?? null,
				globalSite: snapshot.data.audioSites['127.0.0.1'] ?? null,
				preset: snapshot.data.audioPresets[presetName] ?? null,
			};
			const patch = async (value: Record<string, unknown>) => {
				const response = await send('spectra.settings.patch', {
					expectedRevision: snapshot.data.revision,
					patch: value,
				});
				if (!response?.ok) throw new Error(response?.error?.message ?? 'Unable to seed preset');
				snapshot = response;
			};
			await patch({ scope: 'audio-site', domain: '127.0.0.1', value: null });
			await patch({
				scope: 'audio-preset',
				name: presetName,
				value: {
					config: { volume: 54, volumeBase: 54, boost: 1, speed: 1.25 },
					meta: { type: 'global', name: presetName, createdAt: Date.now() },
				},
			});
			await patch({ scope: 'default-preset', value: presetName });
			await patch({
				scope: 'audio-site',
				domain: 'localhost',
				mode: 'replace',
				value: { volume: 73, volumeBase: 73, boost: 1, speed: 1.5 },
			});
			return baseline;
		}, { presetName });
		let sitePage: Page | null = null;
		let globalPage: Page | null = null;
		const presetErrors: string[] = [];
		try {
			await restartServiceWorker();
			sitePage = await browser.newPage();
			globalPage = await browser.newPage();
			await sitePage.evaluateOnNewDocument(() => {
				const removeFixtureMedia = (): void => {
					document.querySelector('#v')?.remove();
				};
				const observer = new MutationObserver(removeFixtureMedia);
				observer.observe(document, { childList: true, subtree: true });
				document.addEventListener('DOMContentLoaded', () => {
					removeFixtureMedia();
					observer.disconnect();
				}, { once: true });
			});
			collectPageErrors(sitePage, presetErrors);
			collectPageErrors(globalPage, presetErrors);
			await sitePage.goto(siteUrl.href, { waitUntil: 'domcontentloaded' });
			await globalPage.goto(globalUrl.href, { waitUntil: 'domcontentloaded' });
			await Promise.all([
				waitForContentBootstrapStatus(siteUrl.href),
				waitForContentBootstrapStatus(globalUrl.href),
			]);
			expect(await sitePage.evaluate(() => document.querySelector('#v'))).toBeNull();
			await sitePage.evaluate(() => {
				const media = document.createElement('video');
				media.id = 'v';
				media.controls = true;
				document.body.append(media);
			});

			const readMediaState = (page: Page) => page.evaluate(() => {
				const media = document.querySelector<HTMLMediaElement>('#v');
				return {
					volume: media?.volume ?? null,
					speed: media?.playbackRate ?? null,
				};
			});
			const initializedSitePage = requireValue(
				sitePage,
				'Expected the site preset page to be initialized',
			);
			const initializedGlobalPage = requireValue(
				globalPage,
				'Expected the global preset page to be initialized',
			);
			await eventually(
				() => readMediaState(initializedSitePage),
				(state) => state.volume !== null
					&& Math.abs(state.volume - 0.73) < 0.000_001
					&& state.speed === 1.5,
				'site preset initialization',
			);
			await eventually(
				() => readMediaState(initializedGlobalPage),
				(state) => state.volume !== null
					&& Math.abs(state.volume - 0.54) < 0.000_001
					&& state.speed === 1.25,
				'default global preset initialization',
			);
			const [siteTabId, globalTabId] = await Promise.all([
				getTabId(siteUrl.href),
				getTabId(globalUrl.href),
			]);
			await eventually(() => readBadgeText(siteTabId), (text) => text === '73', 'site preset badge');
			await eventually(() => readBadgeText(globalTabId), (text) => text === '54', 'global preset badge');
		} finally {
			await sitePage?.close().catch(() => undefined);
			await globalPage?.close().catch(() => undefined);
			await client.evaluate(async ({
				presetName,
				defaultPresetId,
				localSite,
				globalSite,
				originalPreset,
			}) => {
				const send = (type: string, payload: Record<string, unknown>) => chrome.runtime.sendMessage({
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					type,
					payload,
				});
				let snapshot = await send('spectra.settings.get', {});
				const patch = async (value: Record<string, unknown>) => {
					const response = await send('spectra.settings.patch', {
						expectedRevision: snapshot.data.revision,
						patch: value,
					});
					if (!response?.ok) throw new Error(response?.error?.message ?? 'Unable to restore preset baseline');
					snapshot = response;
				};
				await patch({ scope: 'default-preset', value: defaultPresetId });
				await patch({ scope: 'audio-preset', name: presetName, value: originalPreset });
				await patch(localSite
					? { scope: 'audio-site', domain: 'localhost', value: localSite, mode: 'replace' }
					: { scope: 'audio-site', domain: 'localhost', value: null });
				await patch(globalSite
					? { scope: 'audio-site', domain: '127.0.0.1', value: globalSite, mode: 'replace' }
					: { scope: 'audio-site', domain: '127.0.0.1', value: null });
			}, {
				presetName,
				defaultPresetId: original.defaultPresetId,
				localSite: original.localSite,
				globalSite: original.globalSite,
				originalPreset: original.preset,
			}).catch(() => undefined);
			await client.close().catch(() => undefined);
		}
		expect(presetErrors).toEqual([]);
	}, 45_000);

	test('saves separate path rules through Popup and resolves the current SPA URL', async () => {
		const popup = await browser.newPage();
		popup.setDefaultTimeout(5_000);
		const page = await browser.newPage();
		const domain = new URL(fixtureUrl).hostname;
		const prefixes = ['/route-smoke/live', '/route-smoke/video'];
		try {
			await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
			await page.evaluate((path) => history.pushState({}, '', `${path}?anchor=1`), prefixes[0]);
			const tabId = await getTabId(page.url());
			await popup.bringToFront();
			await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
			await popup.waitForSelector('#view-main:not([hidden])');
			await popup.click('#btn-settings');
			await popup.waitForSelector('#view-settings:not([hidden])');
			for (const [index, prefix] of prefixes.entries()) {
				await popup.type('#registry-new-domain', `https://${domain}${prefix}?ignored=1`);
				await popup.select('#registry-new-route', index === 0 ? 'capture' : 'direct');
				await popup.click('#btn-add-domain');
				await popup.waitForFunction((label) => (
					[...document.querySelectorAll('.registry-item-domain')].some((node) => node.textContent === label)
				), {}, `${domain}${prefix}`);
				await popup.waitForFunction(() => document.querySelector<HTMLInputElement>('#registry-new-domain')?.value === '');
			}
			const rules = await sendExtensionMessage<SmokeRpcResult<MediaRouteRulesSnapshot>>(popup, {
				protocolVersion: 2, type: 'spectra.media-route.rules.get', payload: {},
			});
			expect(rules).toMatchObject({ ok: true, data: { entries: expect.arrayContaining([
				{ domain, pathPrefix: prefixes[0], fingerprint: `site:${domain}${prefixes[0]}`, route: 'capture', source: 'user', updatedAt: expect.any(Number) },
				{ domain, pathPrefix: prefixes[1], fingerprint: `site:${domain}${prefixes[1]}`, route: 'direct', source: 'user', updatedAt: expect.any(Number) },
			]) } });
			const readRoute = () => evaluateServiceWorker(async (targetTabId) => {
				const [result] = await chrome.scripting.executeScript({
					target: { tabId: targetTabId, frameIds: [0] }, world: 'ISOLATED',
					func: () => chrome.runtime.sendMessage({ protocolVersion: 2, requestId: crypto.randomUUID(), type: 'spectra.audio.route.get', payload: {} }),
				});
				return result?.result;
			}, tabId) as Promise<SmokeRpcResult<MediaRouteDecision>>;
			expect(await readRoute()).toMatchObject({ ok: true, data: { mediaRoute: 'capture', source: 'user' } });
			await page.evaluate((path) => history.pushState({}, '', `${path}?modal_id=2`), prefixes[1]);
			await eventually(readRoute, (result) => result.ok && result.data.mediaRoute === 'direct', 'same-document path route');
			await page.evaluate((path) => history.pushState({}, '', `${path}/next?anchor=2`), prefixes[0]);
			await eventually(readRoute, (result) => result.ok && result.data.mediaRoute === 'capture', 'nested live path route');
		} finally {
			for (const prefix of prefixes) {
				await sendExtensionMessage(popup, {
					protocolVersion: 2, type: 'spectra.media-route.rules.remove', payload: { fingerprint: `site:${domain}${prefix}` },
				});
			}
			await popup.close();
			await page.close();
		}
	}, 25_000);

	test('initializes popup and options scripts without page exceptions', async () => {
		const offscreenContextsBeforePopup = await getOffscreenContextCount();
		const popupErrors: string[] = [];
		const popup = await browser.newPage();
		collectPageErrors(popup, popupErrors);
		await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
		await popup.waitForSelector('#view-main:not([hidden])');
		await popup.click('#btn-settings');
		await popup.waitForSelector('#view-settings:not([hidden])');
		await popup.waitForFunction(() => (
			document.querySelector('#registry-list')?.childElementCount ?? 0
		) > 0);
		const routeDomain = 'route-ui-smoke.example';
		await popup.type('#registry-new-domain', routeDomain);
		await popup.select('#registry-new-route', 'direct');
		await popup.click('#btn-add-domain');
		await popup.waitForFunction((domain) => (
			[...document.querySelectorAll('.registry-item-domain')]
				.some((element) => element.textContent === domain)
		), {}, routeDomain);
		const routed = await readSiteRouteRegistry(popup);
		expect(routed.entries.find((entry) => entry.domain === routeDomain)).toMatchObject({
			route: 'direct',
			source: 'user',
		});
		await popup.click('.registry-item-delete');
		await popup.waitForFunction((domain) => (
			![...document.querySelectorAll('.registry-item-domain')]
				.some((element) => element.textContent === domain)
		), {}, routeDomain);
		expect((await readSiteRouteRegistry(popup)).entries).not.toContainEqual(
			expect.objectContaining({ domain: routeDomain }),
		);
		expect(await popup.evaluate(() => ({
			mainHidden: document.querySelector('#view-main')?.hasAttribute('hidden'),
			mainInert: document.querySelector('#view-main')?.hasAttribute('inert'),
			mainAriaHidden: document.querySelector('#view-main')?.getAttribute('aria-hidden'),
			settingsAriaHidden: document.querySelector('#view-settings')?.getAttribute('aria-hidden'),
		}))).toEqual({
			mainHidden: true,
			mainInert: true,
			mainAriaHidden: 'true',
			settingsAriaHidden: 'false',
		});
		expect(await popup.evaluate(() => ({
			hasLegacyTabs: Boolean(document.querySelector('#tab-restricted, #tab-safe')),
		}))).toEqual({ hasLegacyTabs: false });
		await popup.click('#btn-back');
		await popup.waitForSelector('#view-main:not([hidden])');
		expect(popupErrors).toEqual([]);
		await popup.close();
		// A prior Capture test may leave the unified host inside its intentional
		// idle-close grace period. Popup startup must not create another host or
		// change that lifecycle; the physical context count is not globally zero.
		expect(await getOffscreenContextCount()).toBe(offscreenContextsBeforePopup);
		expect(await fixturePage.evaluate(() => {
			return (window as Window & { __spectraAudioContextCount?: number })
				.__spectraAudioContextCount;
		})).toBe(0);

		const optionsErrors: string[] = [];
		const options = await browser.newPage();
		collectPageErrors(options, optionsErrors);
		await options.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });
		await options.waitForSelector('#slots-list .slot-row');
		expect(await options.$$eval('#slots-list .slot-row', (rows) => rows.length))
			.toBe(EXTENSION_COMMAND_COUNT);
		expect(await options.evaluate(() => document.documentElement.dataset.theme)).toMatch(/^(light|dark)$/);

		const accessibilityTestDomain = 'a11y-smoke.example';
		await options.type('#site-input', accessibilityTestDomain);
		await options.click('#site-add-btn');
		await options.waitForFunction((domain) => {
			const select = document.querySelector<HTMLSelectElement>('#site-select');
			return select?.value === domain && !document.querySelector('#site-config')?.hasAttribute('hidden');
		}, {}, accessibilityTestDomain);

		await options.click('#site-add-binding');
		await options.waitForFunction(() => document.activeElement?.id === 'edit-key');
		await options.focus('#modal-save');
		await options.keyboard.press('Tab');
		expect(await options.evaluate(() => document.activeElement?.classList.contains('modal-close'))).toBe(true);
		await options.keyboard.down('Shift');
		await options.keyboard.press('Tab');
		await options.keyboard.up('Shift');
		expect(await options.evaluate(() => document.activeElement?.id)).toBe('modal-save');
		await options.keyboard.press('Escape');
		expect(await options.evaluate(() => {
			const modal = document.querySelector('#edit-modal');
			return {
				hidden: modal?.hasAttribute('hidden'),
				inert: modal?.hasAttribute('inert'),
				ariaHidden: modal?.getAttribute('aria-hidden'),
				activeId: document.activeElement?.id,
			};
		})).toEqual({
			hidden: true,
			inert: true,
			ariaHidden: 'true',
			activeId: 'site-add-binding',
		});

		await options.click('#site-delete');
		await options.waitForSelector('#site-delete-dialog[open]');
		expect(await options.$eval('#site-delete-message', (node) => node.textContent)).toContain(accessibilityTestDomain);
		await options.click('#site-delete-confirm');
		await options.waitForFunction((domain) => {
			const select = document.querySelector<HTMLSelectElement>('#site-select');
			return ![...select?.options ?? []].some((option) => option.value === domain);
		}, {}, accessibilityTestDomain);
		expect(optionsErrors).toEqual([]);
		await options.close();
	}, 20_000);

	test('hands the latest volume to Background before the real action popup is destroyed', async () => {
		const page = await browser.newPage();
		const url = `${fixtureUrl}?popup-close-handoff=1`;
		let popup: Page | null = null;
		try {
			await page.goto(url, { waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(url);
			await page.bringToFront();
			const tabId = await getTabId(url);
			popup = await (await openActionPopupTarget()).asPage();
			await popup.waitForSelector(`.glass-card[data-tab-id="${tabId}"][data-control-coverage="known"]`);
			await popup.evaluate(() => {
				const slider = document.querySelector<HTMLInputElement>('.vol-slider');
				if (!slider) throw new Error('Popup volume slider missing');
				slider.value = '80';
				slider.dispatchEvent(new Event('input', { bubbles: true }));
				slider.dispatchEvent(new Event('change', { bubbles: true }));
				slider.value = '90';
				slider.dispatchEvent(new Event('input', { bubbles: true }));
			});
			await closeActionPopup(popup);
			await eventually(() => page.$eval('video', (element) => (element as HTMLVideoElement).volume),
				(value) => Math.abs(value - 0.9) < 0.001, 'final volume after Popup realm destruction');
			expect(popup.isClosed()).toBe(true);
		} finally {
			if (popup && !popup.isClosed()) await closeActionPopup(popup);
			await page.close();
		}
	}, 20_000);

	test('renders Presets from the selected locale on first paint and language refresh', async () => {
		const siteDomain = 'i18n-site-smoke.example';
		const presetName = 'i18n-preset-smoke';
		const client = await openExtensionClient();
		const seeded = await client.evaluate(async ({ siteDomain, presetName }) => {
			const send = (type: string, payload: Record<string, unknown>) => chrome.runtime.sendMessage({
				protocolVersion: 2,
				requestId: crypto.randomUUID(),
				type,
				payload,
			});
			let snapshot = await send('spectra.settings.get', {});
			if (!snapshot?.ok) throw new Error(snapshot?.error?.message ?? 'Unable to read settings');
			const original = {
				language: snapshot.data.globalSettings.lang,
				defaultPresetId: snapshot.data.defaultPresetId,
			};
			const patch = async (value: Record<string, unknown>) => {
				const response = await send('spectra.settings.patch', {
					expectedRevision: snapshot.data.revision,
					patch: value,
				});
				if (!response?.ok) throw new Error(response?.error?.message ?? 'Unable to seed settings');
				snapshot = response;
			};
			await patch({ scope: 'global', changes: { lang: 'zh-CN' } });
			await patch({
				scope: 'audio-site',
				domain: siteDomain,
				mode: 'replace',
				value: { volume: 125, volumeBase: 100, boost: 1.25, speed: 1.25, compressor: true, pan: 1 },
			});
			await patch({
				scope: 'audio-preset',
				name: presetName,
				value: {
					config: { volume: 125, volumeBase: 100, boost: 1.25, speed: 1.25, compressor: true, pan: 1 },
					meta: { type: 'global', name: presetName, createdAt: Date.now() },
				},
			});
			await patch({ scope: 'default-preset', value: presetName });
			return original;
		}, { siteDomain, presetName });

		const popup = await browser.newPage();
		await popup.evaluateOnNewDocument(({ presetName }) => {
			const scope = window as Window & { __spectraI18nFirstDynamic?: Record<string, string> };
			const first: Record<string, string> = {};
			scope.__spectraI18nFirstDynamic = first;
			const record = (key: string, value: string | null | undefined) => {
				const normalized = value?.trim();
				if (!first[key] && normalized) first[key] = normalized;
			};
			const scan = () => {
				const presetItem = [...document.querySelectorAll<HTMLElement>('.preset-item')]
					.find((item) => item.querySelector('.preset-name span')?.textContent === presetName);
				const presetHeaders = [...document.querySelectorAll<HTMLElement>('.preset-section-header')];
				record('presetHeader', presetHeaders[0]?.textContent);
				record('presetSiteHeader', presetHeaders[1]?.textContent);
				record('presetDefault', presetItem?.querySelector('.preset-badge.default')?.textContent);
				record('presetSummary', presetItem?.querySelector('.preset-summary')?.textContent);
				record('presetApply', presetItem?.querySelector('.btn-preset-action.apply')?.getAttribute('title'));
				if (presetHeaders[0]) record('presetHeaderFontSize', getComputedStyle(presetHeaders[0]).fontSize);
			};
			new MutationObserver(scan).observe(document, {
				attributes: true,
				childList: true,
				characterData: true,
				subtree: true,
			});
			queueMicrotask(scan);
		}, { presetName });

		try {
			await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
			await popup.waitForSelector('#view-main:not([hidden])');
			await popup.click('#btn-settings');
			await popup.waitForFunction(({ presetName }) => {
				const presetReady = [...document.querySelectorAll('.preset-name span')]
					.some((element) => element.textContent === presetName);
				return presetReady;
			}, {}, { presetName });

			const firstDynamic = await popup.evaluate(() => (
				(window as Window & { __spectraI18nFirstDynamic?: Record<string, string> })
					.__spectraI18nFirstDynamic
			));
			expect(firstDynamic).toMatchObject({
					presetHeader: '全局预设',
					presetSiteHeader: '网站预设',
					presetDefault: '默认',
					presetApply: '应用预设',
				});
			expect(Number.parseFloat(firstDynamic?.presetHeaderFontSize ?? '0')).toBeGreaterThanOrEqual(13);
			expect(firstDynamic?.presetSummary).toContain('压缩');
			expect(firstDynamic?.presetSummary).toContain('声相:右');

			await popup.select('#set-lang', 'en-US');
			await popup.waitForFunction(({ presetName }) => {
				const presetItem = [...document.querySelectorAll<HTMLElement>('.preset-item')]
					.find((item) => item.querySelector('.preset-name span')?.textContent === presetName);
				return document.documentElement.lang === 'en-US'
					&& [...document.querySelectorAll('.preset-section-header')]
						.map((element) => element.textContent).join('|') === 'Global Presets|Site Presets'
					&& presetItem?.querySelector('.preset-badge.default')?.textContent === 'DEFAULT'
					&& presetItem?.querySelector('.btn-preset-action.apply')?.getAttribute('title') === 'Apply preset';
			}, { timeout: 8_000 }, { presetName });

			await popup.evaluate((name) => {
				const item = [...document.querySelectorAll('.preset-item')]
					.find((node) => node.querySelector('.preset-name span')?.textContent === name);
				item?.querySelector<HTMLButtonElement>('.preview')?.click();
			}, presetName);
			await popup.waitForSelector('#preset-preview-details');
			expect(await popup.$eval('#preset-preview-details', (node) => ({
				tag: node.tagName,
				internalKeys: /volumeBase|eqValues|"boost"/u.test(node.textContent ?? ''),
			}))).toEqual({ tag: 'DL', internalKeys: false });
			expect(await popup.$$eval('#preset-preview-details dt', (nodes) => nodes.length)).toBeGreaterThan(0);
			await popup.keyboard.press('Escape');
			await popup.waitForSelector('#preset-preview-modal', { hidden: true });

			await popup.select('#set-lang', 'zh-CN');
			await popup.waitForFunction(({ presetName }) => {
				const presetItem = [...document.querySelectorAll<HTMLElement>('.preset-item')]
					.find((item) => item.querySelector('.preset-name span')?.textContent === presetName);
				return document.documentElement.lang === 'zh-CN'
					&& [...document.querySelectorAll('.preset-section-header')]
						.map((element) => element.textContent).join('|') === '全局预设|网站预设'
					&& presetItem?.querySelector('.preset-badge.default')?.textContent === '默认'
					&& presetItem?.querySelector('.btn-preset-action.apply')?.getAttribute('title') === '应用预设';
			}, { timeout: 8_000 }, { presetName });
		} finally {
			await popup.close().catch(() => undefined);
			await client.evaluate(async ({
				siteDomain,
				presetName,
				originalLanguage,
				originalDefaultPresetId,
			}) => {
				const send = (type: string, payload: Record<string, unknown>) => chrome.runtime.sendMessage({
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					type,
					payload,
				});
				let snapshot = await send('spectra.settings.get', {});
				const patch = async (value: Record<string, unknown>) => {
					const response = await send('spectra.settings.patch', {
						expectedRevision: snapshot.data.revision,
						patch: value,
					});
					if (!response?.ok) throw new Error(response?.error?.message ?? 'Unable to clean i18n settings');
					snapshot = response;
				};
				await patch({ scope: 'default-preset', value: originalDefaultPresetId });
				await patch({ scope: 'audio-preset', name: presetName, value: null });
				await patch({ scope: 'audio-site', domain: siteDomain, value: null });
				await patch({ scope: 'global', changes: { lang: originalLanguage } });
			}, {
				siteDomain,
				presetName,
				originalLanguage: seeded.language,
				originalDefaultPresetId: seeded.defaultPresetId,
			}).catch(() => undefined);
			await client.close().catch(() => undefined);
		}
	}, 35_000);

	test('keeps English and Chinese extension layouts bounded and exposes dynamic controls in the AX tree', async () => {
		const assertPageAudit = async (page: Page, label: string) => {
			const layout = await inspectExtensionLayout(page);
			expect(layout.documentOverflow, `${label} document overflow: ${JSON.stringify(layout)}`).toBeLessThanOrEqual(0);
			expect(layout.controlsOutsideViewport, `${label} controls outside viewport`).toEqual([]);
			expect(layout.clippedText, `${label} clipped text`).toEqual([]);
			const accessibility = await inspectExtensionAccessibility(page);
			expect(accessibility.interactiveCount, `${label} interactive AX nodes`).toBeGreaterThan(0);
			expect(accessibility.namelessInteractive, `${label} unnamed controls`).toEqual([]);
			expect(accessibility.missingState, `${label} missing AX states`).toEqual([]);
			expect(accessibility.axPressedCount, `${label} pressed states`).toBeGreaterThanOrEqual(
				accessibility.domPressedCount,
			);
		};

		await fixturePage.bringToFront();
		const popupTarget = await openActionPopupTarget();
		const popup = await popupTarget.asPage();
		const popupDiagnostics: string[] = [];
		popup.on('pageerror', (error) => popupDiagnostics.push(`pageerror: ${error.message}`));
		popup.on('console', (message) => {
			if (message.type() === 'error' || message.type() === 'warning') {
				popupDiagnostics.push(`console.${message.type()}: ${message.text()}`);
			}
		});
		await popup.waitForSelector('#view-main:not([hidden])');
		await popup.waitForSelector('.glass-card', { timeout: 8_000 }).catch(async (error) => {
			const state = await popup.evaluate(async () => ({
				readyState: document.readyState,
				mainChildren: document.querySelector('#main-stage')?.childElementCount ?? -1,
				emptyHidden: document.querySelector('#empty-state')?.classList.contains('hidden') ?? false,
				// biome-ignore lint/performance/useDomNodeTextContent: failure diagnostics must report the text a user can actually see, not hidden nodes.
				bodyText: document.body.innerText.slice(0, 500),
				activeTabs: (await chrome.tabs.query({ active: true, currentWindow: true }))
					.map(({ id, url, active, windowId }) => ({ id, url, active, windowId })),
				allTabs: (await chrome.tabs.query({}))
					.map(({ id, url, active, windowId }) => ({ id, url, active, windowId })),
			})).catch(() => null);
			throw new Error(
				`Popup card stage did not initialize: ${JSON.stringify({ state, popupDiagnostics })}`,
				{ cause: error },
			);
		});
		const originalLanguage = await popup.$eval('#set-lang', (element) => (
			(element as HTMLSelectElement).value
		));
		try {
			const readPopupGeometry = () => popup.evaluate(() => {
				const shell = document.querySelector<HTMLElement>('.view-container');
				const main = document.querySelector<HTMLElement>('#view-main');
				const shellBounds = shell?.getBoundingClientRect();
				const mainBounds = main?.getBoundingClientRect();
				return {
					windowHeight: window.innerHeight,
					documentHeight: document.documentElement.scrollHeight,
					shellHeight: shellBounds?.height ?? -1,
					mainHeight: mainBounds?.height ?? -1,
					mainSlack: shellBounds && mainBounds ? shellBounds.bottom - mainBounds.bottom : -1,
					inlineMinHeight: shell?.style.minHeight ?? '',
					settingsMode: shell?.classList.contains('settings-view-active') ?? false,
					mainCards: document.querySelectorAll('#main-stage > .glass-card').length,
					backgroundCards: document.querySelectorAll('#bg-stage > .glass-card').length,
				};
			});
			const intrinsicMain = await readPopupGeometry();
			expect(await popup.evaluate(() => window.innerWidth)).toBe(390);
			expect(intrinsicMain).toMatchObject({
				inlineMinHeight: '',
				settingsMode: false,
				mainCards: 1,
				backgroundCards: 0,
			});
			expect(Math.abs(intrinsicMain.shellHeight - intrinsicMain.mainHeight)).toBeLessThanOrEqual(1);
			expect(Math.abs(intrinsicMain.mainSlack)).toBeLessThanOrEqual(1);
			expect(intrinsicMain.windowHeight).toBeLessThan(600);
			expect(intrinsicMain.documentHeight).toBeLessThan(600);

			await popup.click('#btn-settings');
			await popup.waitForFunction(() => (
				document.querySelector('.view-container')?.classList.contains('settings-view-active') === true
				&& document.querySelector('#view-settings')?.hasAttribute('hidden') === false
			));
			const settingsGeometry = await readPopupGeometry();
			expect(settingsGeometry.settingsMode).toBe(true);
			expect(settingsGeometry.inlineMinHeight).toBe('');
			expect(settingsGeometry.shellHeight).toBeGreaterThanOrEqual(600);

			await popup.click('#btn-back');
			await popup.waitForFunction(() => (
				document.querySelector('.view-container')?.classList.contains('settings-view-active') === false
				&& document.querySelector('#view-main')?.hasAttribute('hidden') === false
				&& window.innerHeight < 600
			));
			const restoredMain = await readPopupGeometry();
			expect(restoredMain.inlineMinHeight).toBe('');
			expect(restoredMain.settingsMode).toBe(false);
			expect(restoredMain.shellHeight).toBeCloseTo(intrinsicMain.shellHeight, 0);
			expect(restoredMain.windowHeight).toBeCloseTo(intrinsicMain.windowHeight, 0);

			for (const language of ['en-US', 'zh-CN']) {
				await popup.select('#set-lang', language);
				await popup.waitForFunction(
					(expected) => document.documentElement.lang === expected,
					{},
					language,
				);
				await assertPageAudit(popup, `popup main ${language}`);
				await popup.waitForFunction(() => {
					const canvas = document.querySelector('.viz-canvas') as HTMLCanvasElement | null;
					if (!canvas) return false;
					const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
					return Boolean(pixels?.some((value, index) => index % 4 === 3 && value > 0));
				}, { timeout: 5_000 });
				const cardIdentity = await popup.evaluate(async () => {
					const selectors = [
						'#btn-theme', '#btn-hotkeys', '#btn-shortcuts', '#btn-remote', '#btn-settings',
						'.btn-reset', '.btn-save', '.btn-save-global', '.btn-mute', '.btn-pause',
						'.btn-pip', '.btn-hotkey-target', '.btn-goto-tab',
					].join(', ');
					const controls = [...document.querySelectorAll<HTMLElement>(selectors)].map((element) => ({
						title: element.title,
						ariaLabel: element.getAttribute('aria-label') ?? '',
					}));
					const canvas = document.querySelector('.viz-canvas') as HTMLCanvasElement | null;
					const island = document.querySelector('.viz-island') as HTMLElement | null;
					const bounds = canvas?.getBoundingClientRect();
					return {
						controls,
						icon: (document.querySelector('.meta-icon') as HTMLImageElement | null)?.src ?? '',
						permissions: await chrome.permissions.getAll(),
						visualizer: {
							hidden: island?.hidden ?? true,
							width: bounds?.width ?? 0,
							height: bounds?.height ?? 0,
						},
					};
				});
				expect(cardIdentity.controls).toHaveLength(13);
				expect(cardIdentity.controls.every(({ title, ariaLabel }) => (
					title.length > 0
					&& ariaLabel.length > 0
					&& title !== 'undefined'
					&& ariaLabel !== 'undefined'
				))).toBe(true);
				expect(cardIdentity.permissions.permissions).toContain('favicon');
				expect(cardIdentity.permissions.permissions).toContain('activeTab');
				expect(cardIdentity.icon).toContain('/_favicon/');
				expect(cardIdentity.visualizer).toMatchObject({ hidden: false, height: 40 });
				expect(cardIdentity.visualizer.width).toBeGreaterThan(0);
				await popup.focus('.btn-effects');
				await popup.keyboard.press('Enter');
				await popup.waitForSelector('#side-panel[aria-hidden="false"]');
				await popup.waitForFunction(() => document.getElementById('side-panel')?.classList.contains('open'));
				await popup.evaluate(async () => { await Promise.all(document.getAnimations().map((animation) => animation.finished)); });
				await assertPageAudit(popup, `popup effects ${language}`);
				await popup.keyboard.press('Escape');
				await popup.waitForFunction(() => document.getElementById('side-panel')?.getAttribute('aria-hidden') === 'true');
				expect(await popup.evaluate(() => document.activeElement?.classList.contains('btn-effects'))).toBe(true);
				await popup.click('#btn-settings');
				await popup.waitForSelector('#view-settings:not([hidden])');
				await assertPageAudit(popup, `popup settings ${language}`);
				await popup.click('#btn-back');
				await popup.waitForSelector('#view-main:not([hidden])');
			}
			await popup.$eval('.speed-input', (element) => {
				const input = element as HTMLInputElement;
				input.value = '1.75';
				input.dispatchEvent(new Event('change', { bubbles: true }));
			});
			await eventually(() => fixturePage.$eval('video', (element) => (element as HTMLVideoElement).playbackRate),
				(value) => value === 1.75, 'physical playback speed before reset');
			await popup.$eval('.vol-slider', (element) => {
				const slider = element as HTMLInputElement;
				slider.value = '80';
				slider.dispatchEvent(new Event('input', { bubbles: true }));
				slider.dispatchEvent(new Event('change', { bubbles: true }));
			});
			await popup.waitForFunction(() => (
				(document.querySelector('.vol-slider') as HTMLInputElement | null)?.value === '80'
			));
			await popup.click('.btn-reset');
			await popup.waitForFunction(() => {
				const reset = document.querySelector('.btn-reset');
				const slider = document.querySelector('.vol-slider') as HTMLInputElement | null;
				const speed = document.querySelector('.speed-input') as HTMLInputElement | null;
				const eq = [...document.querySelectorAll<HTMLInputElement>('.eq-input')];
				return reset?.getAttribute('aria-busy') !== 'true'
					&& slider?.value === '100'
					&& speed?.value === '1.00'
					&& eq.every((input) => Number(input.value) === 0);
			}, { timeout: 20_000 }).catch(async (error) => {
				const state = await popup.evaluate(() => ({
					busy: document.querySelector('.btn-reset')?.getAttribute('aria-busy'),
					disabled: (document.querySelector('.btn-reset') as HTMLButtonElement | null)?.disabled,
					slider: (document.querySelector('.vol-slider') as HTMLInputElement | null)?.value,
					speed: (document.querySelector('.speed-input') as HTMLInputElement | null)?.value,
					toast: document.querySelector('[role="alert"]')?.textContent,
				}));
				throw new Error(`Popup reset did not settle: ${JSON.stringify({ state, popupDiagnostics })}`, {
					cause: error,
				});
			});
			expect(await fixturePage.$eval('video', (element) => (element as HTMLVideoElement).playbackRate)).toBe(1);
		} finally {
			await popup.select('#set-lang', originalLanguage).catch(() => undefined);
			await popup.waitForFunction(
				(expected) => document.documentElement.lang === expected,
				{ timeout: 5_000 },
				originalLanguage,
			).catch(() => undefined);
			await closeActionPopup(popup);
		}
		expect(popupDiagnostics).toEqual([]);

		const options = await browser.newPage();
		await options.setViewport({ width: 390, height: 800, deviceScaleFactor: 1 });
		await options.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });
		await options.waitForSelector('#slots-list .slot-row');
		expect(await options.$$eval('#slots-list .slot-row', (rows) => rows.length))
			.toBe(EXTENSION_COMMAND_COUNT);
		try {
			for (const language of ['en-US', 'zh-CN']) {
				await options.select('#lang-select', language);
				await options.waitForFunction(
					(expected) => document.documentElement.lang === expected,
					{},
					language,
				);
				await assertPageAudit(options, `options ${language}`);
			}
		} finally {
			await options.select('#lang-select', originalLanguage).catch(() => undefined);
			await options.waitForFunction(
				(expected) => document.documentElement.lang === expected,
				{ timeout: 5_000 },
				originalLanguage,
			).catch(() => undefined);
			await options.close();
		}
	}, 35_000);

	test('toggles native PiP from one Popup click without a second prompt', async () => {
		await fixturePage.bringToFront();
		const errorsBefore = fixtureErrors.length;
		await evaluateServiceWorker(async ({ url }) => {
			const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === url);
			if (tab?.id === undefined) throw new Error(`Unable to find PiP fixture tab: ${url}`);
			await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				world: 'ISOLATED',
				func: () => {
					const scope = window as Window & {
						__spectraOriginalRequestPictureInPicture?: HTMLVideoElement['requestPictureInPicture'];
						__spectraOriginalExitPictureInPicture?: Document['exitPictureInPicture'];
						__spectraPipActivation?: boolean;
					};
					if (!scope.__spectraOriginalRequestPictureInPicture) {
						scope.__spectraOriginalRequestPictureInPicture = HTMLVideoElement.prototype.requestPictureInPicture;
					}
					Object.defineProperty(document, 'pictureInPictureEnabled', {
						configurable: true,
						value: true,
					});
					Object.defineProperty(document, 'pictureInPictureElement', {
						configurable: true,
						value: null,
					});
					const fixtureVideo = document.querySelector('video');
					if (!fixtureVideo) throw new Error('PiP fixture video is missing');
					fixtureVideo.disablePictureInPicture = true;
					scope.__spectraOriginalExitPictureInPicture = document.exitPictureInPicture;
					HTMLVideoElement.prototype.requestPictureInPicture = function requestPictureInPicture() {
						scope.__spectraPipActivation = navigator.userActivation.isActive;
						if (!scope.__spectraPipActivation) {
							return Promise.reject(new DOMException('A user gesture is required', 'NotAllowedError'));
						}
						if (this.disablePictureInPicture) {
							return Promise.reject(new DOMException('Picture-in-Picture is disabled', 'InvalidStateError'));
						}
						Object.defineProperty(document, 'pictureInPictureElement', {
							configurable: true,
							value: this,
						});
						this.dispatchEvent(new Event('enterpictureinpicture'));
						return Promise.resolve({ width: 320, height: 180 } as PictureInPictureWindow);
					};
					document.exitPictureInPicture = () => {
						const current = document.pictureInPictureElement;
						Object.defineProperty(document, 'pictureInPictureElement', {
							configurable: true,
							value: null,
						});
						current?.dispatchEvent(new Event('leavepictureinpicture'));
						return Promise.resolve();
					};
				},
			});
		}, { url: fixturePage.url() });
		const popupTarget = await openActionPopupTarget();
		const popup = await popupTarget.asPage();
		const diagnostics: string[] = [];
		popup.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));
		popup.on('console', (message) => {
			if (message.type() === 'error' || message.type() === 'warning') {
				diagnostics.push(`console.${message.type()}: ${message.text()}`);
			}
		});
		try {
			await popup.waitForSelector('.glass-card');
			await popup.$eval('.btn-pip', (element) => (element as HTMLButtonElement).click());
			await popup.waitForFunction(
				() => {
					const button = document.querySelector('.btn-pip');
					return button?.getAttribute('aria-pressed') === 'true'
						&& button.getAttribute('aria-busy') !== 'true';
				},
				{ timeout: 3_000 },
			);
			const popupState = await popup.evaluate(() => ({
				pressed: document.querySelector('.btn-pip')?.getAttribute('aria-pressed'),
				busy: document.querySelector('.btn-pip')?.getAttribute('aria-busy'),
				toast: document.querySelector('.preset-toast')?.textContent,
			}));
			expect({ popupState, diagnostics }).toEqual({
				popupState: { pressed: 'true', busy: null },
				diagnostics: [],
			});
			expect(await fixturePage.$('#spectra-toast-host')).toBeNull();

			await popup.$eval('.btn-pip', (element) => (element as HTMLButtonElement).click());
			await popup.waitForFunction(() => {
				const button = document.querySelector('.btn-pip');
				return button?.getAttribute('aria-pressed') === 'false'
					&& button.getAttribute('aria-busy') !== 'true';
			});
			expect(diagnostics).toEqual([]);
			expect(fixtureErrors.slice(errorsBefore)).toEqual([]);
		} finally {
			await closeActionPopup(popup);
			await evaluateServiceWorker(async ({ url }) => {
				const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === url);
				if (tab?.id === undefined) return;
				await chrome.scripting.executeScript({
					target: { tabId: tab.id },
					world: 'ISOLATED',
					func: () => {
						const scope = window as Window & {
							__spectraOriginalRequestPictureInPicture?: HTMLVideoElement['requestPictureInPicture'];
							__spectraOriginalExitPictureInPicture?: Document['exitPictureInPicture'];
							__spectraPipActivation?: boolean;
						};
						if (scope.__spectraOriginalRequestPictureInPicture) {
							HTMLVideoElement.prototype.requestPictureInPicture = scope.__spectraOriginalRequestPictureInPicture;
							delete scope.__spectraOriginalRequestPictureInPicture;
						}
						if (scope.__spectraOriginalExitPictureInPicture) {
							document.exitPictureInPicture = scope.__spectraOriginalExitPictureInPicture;
							delete scope.__spectraOriginalExitPictureInPicture;
						}
						document.querySelectorAll('video').forEach((video) => {
							video.disablePictureInPicture = false;
						});
						delete scope.__spectraPipActivation;
						Reflect.deleteProperty(document, 'pictureInPictureEnabled');
						Reflect.deleteProperty(document, 'pictureInPictureElement');
					},
				});
			}, { url: fixturePage.url() });
		}
	}, 20_000);

	test('saves a global preset from the card action without opening settings', async () => {
		await fixturePage.bringToFront();
		const target = await openActionPopupTarget();
		const popup = await target.asPage();
		let fixtureTabId: number | undefined;
		try {
			await popup.waitForSelector('.btn-save-global', { timeout: 8_000 });
			const result = await popup.evaluate(async () => {
				const send = (type: string, payload: Record<string, unknown>) => chrome.runtime.sendMessage({
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					type,
					payload,
				});
				const before = await send('spectra.settings.get', {});
				if (!before?.ok) throw new Error(before?.error?.message ?? 'Unable to read settings baseline');
				const button = document.querySelector<HTMLButtonElement>('.btn-save-global');
				if (!button) throw new Error('Save-as-global button is missing');
				button.click();
				await new Promise((resolve) => setTimeout(resolve, 1_500));
				const after = await send('spectra.settings.get', {});
				if (!after?.ok) throw new Error(after?.error?.message ?? 'Unable to read saved settings');
				const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
				return {
					revision: after.data.revision,
					tabId: typeof activeTab?.id === 'number' ? activeTab.id : null,
					created: Object.keys(after.data.audioPresets)
						.filter((name) => !Object.hasOwn(before.data.audioPresets, name)),
					toastError: document.querySelector('.popup-toast-error')?.textContent ?? null,
				};
			});
			expect(result.toastError).toBeNull();
			expect(result.created).toHaveLength(1);
			fixtureTabId = result.tabId ?? undefined;
			// Remove the auto-named preset so reruns read a clean seeded state.
			const cleanup = await popup.evaluate(async ({ name, revision }) => {
				const response = await chrome.runtime.sendMessage({
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					type: 'spectra.settings.patch',
					payload: { expectedRevision: revision, patch: { scope: 'audio-preset', name, value: null } },
				});
				return response?.ok === true;
			}, { name: result.created[0], revision: result.revision });
			expect(cleanup).toBe(true);
		} finally {
			await popup.close();
			if (fixtureTabId !== undefined) {
				await submitEffectiveVolume(fixtureTabId, 100).catch(() => undefined);
				await submitPopupControlIntent(
					fixtureTabId,
					{ patch: { mediaMuted: false, speed: 1 } },
				).catch(() => undefined);
			}
		}
	}, 30_000);
});

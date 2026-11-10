import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { launchPuppeteerBrowser } from '../../../../scripts/browser-driver';
import { SPECTRA_PAGE_MEDIA_EVENT, SPECTRA_PAGE_MEDIA_REQUEST_ATTRIBUTE, SPECTRA_PAGE_MEDIA_RESULT_ATTRIBUTE } from '../../src/shared/page-media-bridge';
import { SMOKE_TONE_WAV, acquireSmokeRuntime, browser, collectPageErrors, evaluateServiceWorker, eventually, fixturePage, fixtureUrl, getTabId, openExtensionClient, patchExtensionSettings, readBadgeText, readContentBootstrapStatus, readContentStatus, restartServiceWorker, sendFromActionPopup, submitEffectiveVolume, submitPopupControlIntent, waitForContentBootstrapStatus, waitForContentStatus } from './harness';
import { installAudioContextProbe, prepareSmokeSession, releaseSmokeRuntimes, startSmokeSession, teardownSmokeSession } from './harness';

describe('SPECTRA built extension smoke: page-media', () => {
	beforeAll(async () => {
		const options = await prepareSmokeSession();
		const launched = await launchPuppeteerBrowser(options, {
			owner: 'apps/extension-spectra/test/smoke/page-media.spec.ts',
			profile: { kind: 'temporary', prefix: 'spectra-smoke-', isolated: true },
		});
		await startSmokeSession(launched);
	}, 60_000);

	afterAll(async () => {
		await teardownSmokeSession();
	});

	test('leaves the page audio graph connect and disconnect contract intact', async () => {
		const page = await browser.newPage();
		try {
			await page.goto(`${fixtureUrl}?audio-graph-ownership=1`, { waitUntil: 'domcontentloaded' });
		const result = await page.evaluate(async () => {
			const context = new AudioContext();
			try {
				const source = context.createOscillator();
				const connected = source.connect(context.destination);
				// A hidden output gain rewrites the edge and makes this native
				// disconnect throw: the page no longer owns the graph it created.
				source.disconnect(context.destination);
				return { destinationPreserved: connected === context.destination };
			} finally {
				await context.close();
			}
		});
		expect(result).toEqual({ destinationPreserved: true });
		} finally {
			await page.close();
		}
	});

	test('restores cold page-native volume and speed across refresh without showing a badge', async () => {
		const coldUrl = `${fixtureUrl}?cold-native-refresh=1`;
		const coldPage = await browser.newPage();
		const coldErrors: string[] = [];
		collectPageErrors(coldPage, coldErrors);
		try {
			await coldPage.goto(coldUrl, { waitUntil: 'domcontentloaded' });
			const initialBootstrap = await waitForContentBootstrapStatus(coldUrl);
			const tabId = await getTabId(coldUrl);
			expect(initialBootstrap).toMatchObject({ ready: false, runtimeRevision: null });
			expect(await readBadgeText(tabId)).toBe('');

			await coldPage.evaluate(() => {
				const media = document.querySelector<HTMLMediaElement>('#v');
				if (!media) throw new Error('Cold native fixture media is missing');
				media.volume = 0.64;
				media.playbackRate = 1.5;
				media.preservesPitch = false;
				media.dispatchEvent(new Event('volumechange'));
				media.dispatchEvent(new Event('ratechange'));
			});

			await eventually(
				() => evaluateServiceWorker(async (targetTabId) => {
					const key = `tab_session_${targetTabId}`;
					const stored = (await chrome.storage.session.get(key))[key] as {
						patch?: Record<string, unknown>;
					} | undefined;
					return stored?.patch ?? null;
				}, tabId),
				(patch) => patch?.volumeBase === 64
					&& patch.mediaMuted === false
					&& patch.speed === 1.5
					&& patch.preservePitch === false,
				'cold native session projection',
			);
			expect(await readContentBootstrapStatus(coldUrl)).toMatchObject({
				ready: false,
				runtimeRevision: null,
			});
			expect(await readBadgeText(tabId)).toBe('');

			await coldPage.reload({ waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(coldUrl);
			await eventually(
				() => coldPage.evaluate(() => {
					const media = document.querySelector<HTMLMediaElement>('#v');
					return {
						volume: media?.volume ?? null,
						speed: media?.playbackRate ?? null,
						preservePitch: media?.preservesPitch ?? null,
					};
				}),
				(state) => state.volume !== null
					&& Math.abs(state.volume - 0.64) < 0.000_001
					&& state.speed === 1.5
					&& state.preservePitch === false,
				'cold native refresh restoration',
			);
			expect(await readBadgeText(tabId)).toBe('');
		} finally {
			await coldPage.close().catch(() => undefined);
		}
		expect(coldErrors).toEqual([]);
	}, 35_000);

	test('drops a muted recommendation preview but preserves explicit intent for a same-origin detail', async () => {
		const origin = new URL(fixtureUrl).origin;
		const recommendationUrl = `${origin}/recommend.html`;
		const detailUrl = `${origin}/watch/42`;
		const page = await browser.newPage();
		const pageErrors: string[] = [];
		collectPageErrors(page, pageErrors);
		try {
			await page.goto(recommendationUrl, { waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(recommendationUrl);
			const tabId = await getTabId(recommendationUrl);
			await page.evaluate(() => {
				const media = document.querySelector<HTMLMediaElement>('#v');
				if (!media) throw new Error('Recommendation preview media is missing');
				media.muted = true;
				media.dispatchEvent(new Event('volumechange'));
			});
			await eventually(
				() => evaluateServiceWorker(async (targetTabId) => {
					const key = `tab_session_${targetTabId}`;
					const stored = (await chrome.storage.session.get(key))[key] as {
						identity?: { resourceUrl?: string };
						patch?: Record<string, unknown>;
					} | undefined;
					return stored ?? null;
				}, tabId),
				(stored) => stored?.identity?.resourceUrl === recommendationUrl
					&& stored.patch?.mediaMuted === true,
				'recommendation mute session projection',
			);
			await page.bringToFront();
			const explicit = await submitPopupControlIntent(tabId, {
				patch: { speed: 1.5 },
			});
			if (!explicit.ok) {
				throw new Error(explicit.error?.message ?? 'Unable to set explicit recommendation speed');
			}
			await eventually(
				() => evaluateServiceWorker(async (targetTabId) => {
					const key = `tab_session_${targetTabId}`;
					const stored = (await chrome.storage.session.get(key))[key] as {
						portablePatch?: Record<string, unknown>;
					} | undefined;
					return stored?.portablePatch ?? null;
				}, tabId),
				(patch) => patch?.speed === 1.5,
				'explicit cross-resource session projection',
			);

			await page.goto(detailUrl, { waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(detailUrl);
			await eventually(
				() => page.evaluate(() => {
					const media = document.querySelector<HTMLMediaElement>('#v');
					return {
						muted: media?.muted ?? null,
						speed: media?.playbackRate ?? null,
					};
				}),
				(state) => state.muted === false && state.speed === 1.5,
				'detail document keeps native mute and explicit speed',
			);
			const detailProjection = await evaluateServiceWorker(async (targetTabId) => {
				const key = `tab_session_${targetTabId}`;
				return (await chrome.storage.session.get(key))[key] as {
					identity?: { resourceUrl?: string };
					patch?: Record<string, unknown>;
					portablePatch?: Record<string, unknown>;
				} | undefined;
			}, tabId);
			expect(detailProjection).toMatchObject({
				identity: { resourceUrl: detailUrl },
				patch: { speed: 1.5 },
				portablePatch: { speed: 1.5 },
			});
			expect(detailProjection?.patch).toEqual({ speed: 1.5 });
		} finally {
			await page.close().catch(() => undefined);
		}
		expect(pageErrors).toEqual([]);
	}, 35_000);

	test('tracks SPA media additions and removals without activating Capture', async () => {
		// This case deletes the fixture's media element for good, so it runs on its
		// own tab: the shared fixture document is what every later case reads, and
		// a document whose media was removed cannot answer them.
		const spaPage = await browser.newPage();
		const spaErrors: string[] = [];
		collectPageErrors(spaPage, spaErrors);
		const spaUrl = `${fixtureUrl}?spa-media=1`;
		try {
			await installAudioContextProbe(spaPage);
			await spaPage.goto(spaUrl, { waitUntil: 'domcontentloaded' });
			await acquireSmokeRuntime(spaPage.url());
			await spaPage.evaluate(() => {
				document.querySelector('#v')?.remove();
				history.pushState({}, '', '/spa/empty');
			});
			expect((await waitForContentStatus((status) => !status.hasAudio, 5_000, () => spaPage.url())).hasAudio).toBe(false);

			await spaPage.evaluate(() => {
				const container = document.createElement('section');
				container.id = 'spa-media';
				const video = document.createElement('video');
				video.id = 'v';
				video.controls = true;
				video.setAttribute('aria-label', 'SPA smoke test video');
				container.append(video);
				document.body.append(container);
				history.pushState({}, '', '/spa/media');
			});
			expect((await waitForContentStatus((status) => status.hasAudio, 5_000, () => spaPage.url())).hasAudio).toBe(true);
			expect(await spaPage.evaluate(() => {
				return (window as Window & { __spectraAudioContextCount?: number })
					.__spectraAudioContextCount;
			})).toBe(0);

			const initialGeneration = (await readContentStatus(spaPage.url())).generation ?? 0;
			await spaPage.evaluate(() => history.pushState({}, '', '/spa/media?route=2'));
			const queryGeneration = (await waitForContentStatus(
				(status) => (status.generation ?? 0) > initialGeneration,
				5_000,
				() => spaPage.url(),
			)).generation ?? 0;
			await spaPage.evaluate(() => { location.hash = 'details'; });
			const hashGeneration = (await waitForContentStatus(
				(status) => (status.generation ?? 0) > queryGeneration,
				5_000,
				() => spaPage.url(),
			)).generation ?? 0;
			expect(hashGeneration).toBeGreaterThan(queryGeneration);
			expect(await spaPage.evaluate(() => location.search)).toBe('?route=2');
			expect(await spaPage.evaluate(() => location.hash)).toBe('#details');
			expect(spaErrors).toEqual([]);
		} finally {
			// Release before closing: a lease on a closed tab would be unresolvable.
			await releaseSmokeRuntimes();
			await spaPage.close();
		}
	});

	test('discovers one exact page-media controller for semantic volume, mute, and speed', async () => {
		const state = await fixturePage.evaluate(({ eventName, requestAttribute, resultAttribute }) => {
			const video = document.querySelector<HTMLVideoElement>('#v');
			const player = video?.parentElement;
			const outerPlayer = player?.parentElement;
			if (!video || !player || !outerPlayer) throw new Error('SPA video is missing');
			let volumeBase = 100;
			let mediaMuted = false;
			let speed = 1;
			const volumeController = { video } as {
				video: HTMLVideoElement;
				getVolume(): number;
				setVolume(value: number): void;
			};
			const controller = player as HTMLElement & {
				spectraExactController?: typeof volumeController;
				spectraRateController?: {
					video: HTMLVideoElement;
					playbackRate: number;
					setPlaybackRateByUser(value: number): void;
				};
				isMuted(): boolean;
				setMuted(value: boolean): void;
			};
			volumeController.getVolume = () => volumeBase;
			volumeController.setVolume = (value) => {
				volumeBase = value;
				video.volume = value / 100 * 0.6131;
			};
			controller.spectraExactController = volumeController;
			controller.isMuted = () => mediaMuted;
			controller.setMuted = (value) => {
				mediaMuted = value;
				video.muted = value;
			};
			const rateController = {
				video,
				playbackRate: speed,
				setPlaybackRateByUser(value: number) {
					this.playbackRate = value;
					speed = value;
					video.playbackRate = value;
				},
			};
			controller.spectraRateController = rateController;
			const decoyState = { volumeBase: 17, mediaMuted: true, speed: 2.5, writes: 0 };
			const decoy = outerPlayer as HTMLElement & {
				getVolume(): number;
				setVolume(value: number): void;
				isMuted(): boolean;
				setMuted(value: boolean): void;
				getPlaybackRate(): number;
				setPlaybackRate(value: number): void;
			};
			decoy.getVolume = () => decoyState.volumeBase;
			decoy.setVolume = (value) => { decoyState.volumeBase = value; decoyState.writes += 1; };
			decoy.isMuted = () => decoyState.mediaMuted;
			decoy.setMuted = (value) => { decoyState.mediaMuted = value; decoyState.writes += 1; };
			decoy.getPlaybackRate = () => decoyState.speed;
			decoy.setPlaybackRate = (value) => { decoyState.speed = value; decoyState.writes += 1; };
			video.volume = 0.6131;

			const transact = (operation: 'read' | 'write', field: string, value?: number | boolean) => {
				const requestId = crypto.randomUUID();
				video.setAttribute(requestAttribute, JSON.stringify({ requestId, operation, field, value }));
				video.dispatchEvent(new Event(eventName));
				const result = JSON.parse(video.getAttribute(resultAttribute) ?? '{}');
				video.removeAttribute(requestAttribute);
				video.removeAttribute(resultAttribute);
				return result;
			};
			const initialVolume = transact('read', 'volumeBase');
			const writtenVolume = transact('write', 'volumeBase', 50);
			const writtenMute = transact('write', 'mediaMuted', true);
			const writtenSpeed = transact('write', 'speed', 1.5);
			const result = {
				initialVolume,
				writtenVolume,
				writtenMute,
				writtenSpeed,
				page: { volumeBase, mediaMuted, speed },
				decoy: decoyState,
				native: { volume: video.volume, muted: video.muted, speed: video.playbackRate },
			};
			Reflect.deleteProperty(controller, 'spectraExactController');
			Reflect.deleteProperty(controller, 'spectraRateController');
			for (const key of ['isMuted', 'setMuted'] as const) {
				Reflect.deleteProperty(controller, key);
			}
			for (const key of [
				'getVolume', 'setVolume', 'isMuted', 'setMuted', 'getPlaybackRate', 'setPlaybackRate',
			] as const) Reflect.deleteProperty(decoy, key);
			video.volume = 1;
			video.muted = false;
			video.playbackRate = 1;
			return result;
		}, {
			eventName: SPECTRA_PAGE_MEDIA_EVENT,
			requestAttribute: SPECTRA_PAGE_MEDIA_REQUEST_ATTRIBUTE,
			resultAttribute: SPECTRA_PAGE_MEDIA_RESULT_ATTRIBUTE,
		});
		expect(state.initialVolume).toMatchObject({ supported: true, actual: 100 });
		expect(state.writtenVolume).toMatchObject({ supported: true, actual: 50 });
		expect(state.writtenMute).toMatchObject({ supported: true, actual: true });
		expect(state.writtenSpeed).toMatchObject({ supported: true, actual: 1.5 });
		expect(state.page).toEqual({ volumeBase: 50, mediaMuted: true, speed: 1.5 });
		expect(state.decoy).toEqual({ volumeBase: 17, mediaMuted: true, speed: 2.5, writes: 0 });
		expect(state.native).toEqual({ volume: 0.30655, muted: true, speed: 1.5 });
	});

	test('falls through a capped page controller and acknowledges high DOM playback speed once', async () => {
		const cappedUrl = `${fixtureUrl}?page-speed-cap=2`;
		const cappedPage = await browser.newPage();
		const extensionClient = await openExtensionClient();
		try {
			await cappedPage.goto(cappedUrl, { waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(cappedUrl);
			// Snapshot reads are passive and do not wait for retained restoration.
			// Establish a controller-confirmed baseline through the writer actor
			// before testing the exact baseline that a capped attempt must restore.
			const tabId = await getTabId(cappedUrl);
			const initialized = await extensionClient.evaluate(async (id) => chrome.runtime.sendMessage({
				protocolVersion: 2, requestId: crypto.randomUUID(), tabId: id,
				type: 'spectra.control.snapshot.get', payload: { tabId: id },
			}), tabId);
			expect(initialized.ok).toBe(true);
			await cappedPage.bringToFront();
			const seeded = await submitPopupControlIntent(tabId, { patch: { speed: 1.5 } });
			expect(seeded).toMatchObject({ ok: true, data: { fields: { speed: {
				phase: 'applied', strategy: 'page-native', actual: 1.5,
			} } } });
			const controllerBaseline = await cappedPage.evaluate(() => (
				(window as Window & { __spectraPageMediaState?: { speed: number } }).__spectraPageMediaState?.speed
			));
			expect(controllerBaseline).toBe(1.5);
			const acknowledgement = await submitPopupControlIntent(
				tabId,
				{ patch: { speed: 4 } },
			);
			expect(acknowledgement).toMatchObject({
				ok: true,
				data: {
					fields: {
						speed: {
							phase: 'applied',
							strategy: 'dom-native',
							actual: 4,
						},
					},
				},
			});
			await eventually(
				() => cappedPage.evaluate(() => {
					const video = document.querySelector<HTMLVideoElement>('#v');
					const state = (window as Window & {
						__spectraPageMediaState?: { speed: number };
					}).__spectraPageMediaState;
					return {
						pageSpeed: state?.speed ?? null,
						domSpeed: video?.playbackRate ?? null,
					};
				}),
				(state) => state.pageSpeed === controllerBaseline && state.domSpeed === 4,
				'high-speed DOM fallback beyond the page controller range',
			);
			const snapshot = await extensionClient.evaluate(async (targetTabId) => (
				chrome.runtime.sendMessage({
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					tabId: targetTabId,
					type: 'spectra.control.snapshot.get',
					payload: { tabId: targetTabId },
				})
			), tabId);
			expect(snapshot).toMatchObject({
				ok: true,
				data: {
					fields: {
						speed: {
							strategy: 'dom-native',
							actual: 4,
						},
					},
				},
			});
		} finally {
			await extensionClient.close();
			await cappedPage.close().catch(() => undefined);
		}
	}, 35_000);

	test('automatically restores speed through a controller-backed same-document SPA modal', async () => {
		const spaUrl = `${fixtureUrl}?spa-controller-shell=1`;
		const spaPage = await browser.newPage();
		const extensionClient = await openExtensionClient();
		try {
			await spaPage.goto(spaUrl, { waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(spaUrl);
			await spaPage.bringToFront();
			const tabId = await getTabId(spaUrl);
			const seeded = await submitPopupControlIntent(
				tabId,
				{ patch: { speed: 2 } },
			);
			expect(seeded).toMatchObject({
				ok: true,
				data: { fields: { speed: { phase: 'applied', actual: 2 } } },
			});

			const documentToken = await spaPage.evaluate(() => {
				const previous = document.querySelector<HTMLVideoElement>('#v');
				if (!previous) throw new Error('SPA shell video is missing');
				const source = previous.currentSrc || previous.src;
				previous.remove();
				const container = document.createElement('div') as HTMLDivElement & {
					xgplayer?: {
						video: HTMLVideoElement;
						playbackRate: number;
						setPlaybackRateByUser(value: number): void;
					};
				};
				container.style.width = '640px';
				container.style.height = '360px';
				const video = document.createElement('video');
				video.id = 'v';
				video.muted = true;
				video.src = source;
				video.style.width = '640px';
				video.style.height = '360px';
				const state = { speed: 1, writes: 0 };
				container.xgplayer = {
					video,
					playbackRate: 1,
					setPlaybackRateByUser(value) {
						this.playbackRate = value;
						state.speed = value;
						state.writes += 1;
						video.playbackRate = value;
					},
				};
				container.append(video);
				document.body.append(container);
				const token = crypto.randomUUID();
				(window as Window & {
					__spectraPageMediaState?: typeof state;
					__spectraSpaDocumentToken?: string;
				}).__spectraPageMediaState = state;
				(window as Window & {
					__spectraSpaDocumentToken?: string;
				}).__spectraSpaDocumentToken = token;
				history.pushState({}, '', '/spa-modal?modal_id=spectra-fixture');
				return token;
			});
			await eventually(
				() => spaPage.evaluate(() => {
					const video = document.querySelector<HTMLVideoElement>('#v');
					const scope = window as Window & {
						__spectraPageMediaState?: { speed: number; writes: number };
						__spectraSpaDocumentToken?: string;
					};
					return {
						documentToken: scope.__spectraSpaDocumentToken ?? null,
						pageSpeed: scope.__spectraPageMediaState?.speed ?? null,
						writes: scope.__spectraPageMediaState?.writes ?? null,
						domSpeed: video?.playbackRate ?? null,
						url: location.href,
					};
				}),
				(state) => state.documentToken === documentToken
					&& state.pageSpeed === 2
					&& state.writes === 1
					&& state.domSpeed === 2
					&& state.url.includes('/spa-modal?modal_id='),
				'automatic same-document SPA speed restore through the page controller',
				8_000,
			);
			const snapshot = await eventually(() => extensionClient.evaluate(async (targetTabId) => (
				chrome.runtime.sendMessage({
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					tabId: targetTabId,
					type: 'spectra.control.snapshot.get',
					payload: { tabId: targetTabId },
				})
			), tabId), (response) => response.ok
				&& response.data?.fields.speed?.controlled === true
				&& response.data.fields.speed.writeState === 'confirmed',
				'automatic restore ACK commits after the physical write');
			expect(snapshot).toMatchObject({
				ok: true,
				data: {
					fields: {
						speed: {
							phase: 'applied',
							controlled: true,
							desired: 2,
							writeState: 'confirmed',
							actual: 2,
						},
					},
				},
			});
		} finally {
			await extensionClient.close();
			await spaPage.close().catch(() => undefined);
		}
	}, 35_000);

	test.each([true, false])('replays speed when a pre-rendered same-document SPA modal becomes active (hide feed: %s)', async (hideFeed) => {
		const spaUrl = `${fixtureUrl}?spa-prerendered-modal=1`;
		const spaPage = await browser.newPage();
		try {
			await spaPage.goto(spaUrl, { waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(spaUrl);
			await spaPage.bringToFront();
			const tabId = await getTabId(spaUrl);
			await spaPage.evaluate(() => {
				const feed = document.querySelector<HTMLVideoElement>('#v');
				if (!feed) throw new Error('SPA feed video is missing');
				feed.style.width = '320px';
				feed.style.height = '180px';
				const modal = document.createElement('video');
				modal.id = 'modal-video';
				modal.style.display = 'none';
				modal.style.width = '1280px';
				modal.style.height = '720px';
				const rateLabel = document.createElement('span');
				rateLabel.id = 'modal-rate-label';
				rateLabel.textContent = '1.0x';
				modal.addEventListener('ratechange', () => {
					rateLabel.textContent = `${modal.defaultPlaybackRate.toFixed(1)}x`;
				});
				document.body.append(modal, rateLabel);
			});

			const restored = await submitPopupControlIntent(
				tabId,
				{ patch: { speed: 2 } },
			);
			expect(restored).toMatchObject({
				ok: true,
				data: { fields: { speed: { phase: 'applied', actual: 2 } } },
			});
			expect(await spaPage.evaluate(() => {
				const feed = document.querySelector<HTMLVideoElement>('#v');
				const modal = document.querySelector<HTMLVideoElement>('#modal-video');
				return {
					feedRate: feed?.playbackRate ?? null,
					modalRate: modal?.playbackRate ?? null,
					label: document.querySelector('#modal-rate-label')?.textContent ?? null,
				};
			})).toEqual({ feedRate: 2, modalRate: 1, label: '1.0x' });
			await spaPage.click('#v');

			await spaPage.evaluate((hidePrevious) => {
				const feed = document.querySelector<HTMLVideoElement>('#v');
				if (feed) {
					feed.pause();
					if (hidePrevious) feed.style.display = 'none';
				}
				const modal = document.querySelector<HTMLVideoElement>('#modal-video');
				if (!modal) throw new Error('SPA modal video is missing');
				modal.style.display = 'block';
				history.pushState({}, '', '/spa-modal?modal_id=spectra-fixture');
				// A pre-rendered player can become the active source without adding a
				// new <video>. Its native play lifecycle is therefore the exact media
				// identity boundary for desired-state replay.
				modal.dispatchEvent(new Event('play'));
			}, hideFeed);
			await eventually(
				() => spaPage.evaluate(() => {
					const modal = document.querySelector<HTMLVideoElement>('#modal-video');
					return {
						currentRate: modal?.playbackRate ?? null,
						defaultRate: modal?.defaultPlaybackRate ?? null,
						label: document.querySelector('#modal-rate-label')?.textContent ?? null,
						url: location.href,
					};
				}),
				(state) => state.currentRate === 2
					&& state.defaultRate === 2
					&& state.label === '2.0x'
					&& state.url.includes('/spa-modal?modal_id='),
				'pre-rendered SPA modal speed and page-UI projection',
				8_000,
			);
		} finally {
			await spaPage.close().catch(() => undefined);
		}
	}, 35_000);

	test.each(['hidden', 'detached'] as const)('returns from a %s SPA live player and replays speed onto the already-playing feed', async (close) => {
		const spaUrl = `${fixtureUrl}?spa-live-close=${close}`;
		const page = await browser.newPage();
		const client = await openExtensionClient();
		try {
			await page.goto(spaUrl, { waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(spaUrl);
			await page.bringToFront();
			const tabId = await getTabId(spaUrl);
			await page.evaluate(async (toneBytes) => {
				const feed = document.querySelector<HTMLVideoElement>('#v');
				if (!feed) throw new Error('SPA feed is missing');
				feed.muted = true;
				feed.loop = true;
				feed.style.width = '320px';
				feed.style.height = '180px';
				feed.src = URL.createObjectURL(new Blob([Uint8Array.from(toneBytes)], { type: 'audio/wav' }));
				await feed.play();
			}, [...SMOKE_TONE_WAV]);
			const seeded = await submitPopupControlIntent(tabId, { patch: { speed: 2 } });
			expect(seeded).toMatchObject({ ok: true, data: { fields: { speed: { phase: 'applied', actual: 2 } } } });
			const feedTarget = seeded.ok ? seeded.data.target : null;
			expect(feedTarget).not.toBeNull();
			await page.evaluate(async () => {
				const feed = document.querySelector<HTMLVideoElement>('#v');
				if (!feed) throw new Error('SPA feed is missing');
				const modal = document.createElement('video');
				modal.id = 'live-modal';
				modal.muted = true;
				modal.loop = true;
				modal.src = feed.currentSrc || feed.src;
				modal.style.cssText = 'position:fixed;inset:0;width:640px;height:360px';
				document.body.append(modal);
				await modal.play();
			});
			await eventually(() => page.evaluate(() => document.querySelector<HTMLVideoElement>('#live-modal')?.playbackRate),
				(rate) => rate === 2, 'new SPA live target inherits the document speed');
			const live = await submitPopupControlIntent(tabId, { patch: { speed: 1.5 } });
			expect(live).toMatchObject({ ok: true, data: { fields: { speed: { phase: 'applied', actual: 1.5 } } } });
		await page.evaluate((closeMode) => {
			const modal = document.querySelector<HTMLVideoElement>('#live-modal');
			const feed = document.querySelector<HTMLVideoElement>('#v');
			if (!modal || !feed || feed.paused) throw new Error('Expected a live modal above an already-playing feed');
			(window as Window & { __spectraRetainedLive?: HTMLVideoElement }).__spectraRetainedLive = modal;
			// The feed does not emit play again. Returning must come from the
			// registry's close/visibility lifecycle, even without a URL change.
			if (closeMode === 'detached') modal.remove();
			else { modal.pause(); modal.style.display = 'none'; }
		}, close);
			const snapshot = await eventually(() => client.evaluate(async (targetTabId) => chrome.runtime.sendMessage({
				protocolVersion: 2, requestId: crypto.randomUUID(), tabId: targetTabId,
				type: 'spectra.control.snapshot.get', payload: { tabId: targetTabId },
			}), tabId), (response) => response.ok
				&& response.data?.activeMedia?.mediaId === feedTarget?.mediaId
				&& response.data.fields.speed?.controlled === true
				&& response.data.fields.speed.actual === 2,
				'closed SPA live target returns speed ownership to the existing feed');
			expect(snapshot.data.activeMedia).toMatchObject(feedTarget);
			expect(await page.evaluate(() => document.querySelector<HTMLVideoElement>('#v')?.playbackRate)).toBe(2);
			const changed = await submitPopupControlIntent(tabId, { patch: { speed: 1.4 } });
			expect(changed).toMatchObject({ ok: true, data: { target: feedTarget, fields: { speed: { actual: 1.4, phase: 'applied' } } } });
			expect(await page.evaluate(() => document.querySelector<HTMLVideoElement>('#v')?.playbackRate)).toBe(1.4);
			await page.evaluate(async () => {
				const modal = (window as Window & { __spectraRetainedLive?: HTMLVideoElement }).__spectraRetainedLive;
				if (!modal) throw new Error('Retained live scene is missing');
				modal.style.display = '';
				if (!modal.isConnected) document.body.append(modal);
				await modal.play();
			});
			await eventually(() => client.evaluate(async (targetTabId) => chrome.runtime.sendMessage({
				protocolVersion: 2, requestId: crypto.randomUUID(), tabId: targetTabId,
				type: 'spectra.control.snapshot.get', payload: { tabId: targetTabId },
			}), tabId), (response) => response.ok
				&& response.data?.activeMedia?.mediaId !== feedTarget?.mediaId
				&& response.data.fields.speed?.controlled === true
				&& response.data.fields.speed.actual === 1.5,
			'returning live scene retains 1.5x instead of the feed document fallback 1.4x');
			expect(await page.evaluate(() => document.querySelector<HTMLVideoElement>('#live-modal')?.playbackRate)).toBe(1.5);
		} finally {
			await client.close();
			await page.close().catch(() => undefined);
		}
	}, 35_000);

	test('restores 2x when returning twice to a reset video after a realtime live room rejects speed', async () => {
		const url = `${fixtureUrl}?retained-video-live-return=1`;
		const page = await browser.newPage();
		const client = await openExtensionClient();
		try {
			await page.goto(url, { waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(url);
			await page.bringToFront();
			const tabId = await getTabId(url);
			await page.evaluate(async (toneBytes) => {
				const feed = document.querySelector<HTMLVideoElement>('#v');
				if (!feed) throw new Error('Retained feed is missing');
				feed.muted = true;
				feed.loop = true;
				feed.src = URL.createObjectURL(new Blob([Uint8Array.from(toneBytes)], { type: 'audio/wav' }));
				await feed.play();
			}, [...SMOKE_TONE_WAV]);
			const seeded = await submitPopupControlIntent(tabId, { patch: { speed: 2 } });
			expect(seeded).toMatchObject({ ok: true, data: { fields: { speed: { phase: 'applied', actual: 2 } } } });
			const feedTarget = seeded.ok ? seeded.data.target : null;
			for (let visit = 0; visit < 2; visit += 1) {
				await page.evaluate(async () => {
					const feed = document.querySelector<HTMLVideoElement>('#v');
					if (!feed) throw new Error('Retained feed is missing');
					// A player can reset its retained video before hiding it, without
					// changing its source identity. This must not erase the 2x template.
					feed.pause();
					feed.playbackRate = 1;
					await new Promise<void>((resolve) => feed.addEventListener('ratechange', () => resolve(), { once: true }));
					feed.style.display = 'none';
					const canvas = document.createElement('canvas');
					canvas.width = 640; canvas.height = 360;
					canvas.getContext('2d')?.fillRect(0, 0, 640, 360);
					const live = document.createElement('video');
					live.id = 'realtime-room'; live.muted = true;
					live.style.cssText = 'position:fixed;inset:0;width:640px;height:360px';
					live.srcObject = canvas.captureStream(1);
					document.body.append(live);
					await live.play();
				});
				await eventually(() => client.evaluate(async (id) => chrome.runtime.sendMessage({
					protocolVersion: 2, requestId: crypto.randomUUID(), tabId: id,
					type: 'spectra.control.snapshot.get', payload: { tabId: id },
				}), tabId), (r) => r.ok && r.data?.activeMedia?.mediaId !== feedTarget?.mediaId
					&& r.data?.fields.speed?.actual === 1, 'realtime room observes its physical 1x');
				const rejected = await submitPopupControlIntent(tabId, { patch: { speed: 2 } });
				expect(rejected).toMatchObject({ ok: true, data: { fields: { speed: {
					phase: 'error', actual: null, controlled: false,
				} } } });
				expect(await page.evaluate(() => document.querySelector<HTMLVideoElement>('#realtime-room')?.playbackRate)).toBe(1);
				if (visit === 0) await restartServiceWorker();
				await page.evaluate(async () => {
					const live = document.querySelector<HTMLVideoElement>('#realtime-room');
					const feed = document.querySelector<HTMLVideoElement>('#v');
					if (!live || !feed) throw new Error('Expected the room above its retained video');
					live.remove();
					if (live.srcObject instanceof MediaStream) for (const track of live.srcObject.getTracks()) track.stop();
					feed.style.display = '';
					await feed.play();
				});
				await eventually(() => page.evaluate(() => document.querySelector<HTMLVideoElement>('#v')?.playbackRate),
					(rate) => rate === 2, `retained video gets 2x after live visit ${visit + 1}`);
				await eventually(() => client.evaluate(async (id) => chrome.runtime.sendMessage({
					protocolVersion: 2, requestId: crypto.randomUUID(), tabId: id,
					type: 'spectra.control.snapshot.get', payload: { tabId: id },
				}), tabId), (r) => r.ok && r.data?.activeMedia?.mediaId === feedTarget?.mediaId
					&& r.data.fields.speed?.phase === 'applied' && r.data.fields.speed.actual === 2,
					'returned video control matches physical speed');
			}
			const released = await sendFromActionPopup({
				protocolVersion: 2, requestId: crypto.randomUUID(), tabId,
				type: 'spectra.control.operation.submit', payload: { tabId, source: 'popup', target: null,
					operation: 'restore-page-settings', payload: {} },
			});
			expect(released).toMatchObject({ ok: true });
			await eventually(() => readContentBootstrapStatus(url), (status) => status.ready === false,
				'page settings release retires the shared initial/explicit media-template lease');
		} finally { await client.close(); await page.close().catch(() => undefined); }
	}, 35_000);

	test('does not acknowledge or replay a rejected speed on a realtime MediaStream', async () => {
		const url = `${fixtureUrl}?unsupported-live-rate=1`;
		const page = await browser.newPage();
		const client = await openExtensionClient();
		try {
			await page.goto(url, { waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(url);
			await page.bringToFront();
			const tabId = await getTabId(url);
			await page.evaluate(async () => {
				const media = document.querySelector<HTMLVideoElement>('#v');
				if (!media) throw new Error('Realtime fixture media is missing');
				const canvas = document.createElement('canvas');
				canvas.width = 320;
				canvas.height = 180;
				const context = canvas.getContext('2d');
				if (!context) throw new Error('Realtime fixture needs a canvas context');
				context.fillRect(0, 0, canvas.width, canvas.height);
				media.muted = true;
				media.srcObject = canvas.captureStream(1);
				await media.play();
			});
			// The shared-origin session may retain earlier successful test values.
			// Establish a real supported baseline; only the later 2x must fail.
			const baseline = await submitPopupControlIntent(tabId, { patch: { speed: 1 } });
			expect(baseline).toMatchObject({ ok: true, data: { fields: { speed: { phase: 'applied', actual: 1 } } } });
			const rejected = await submitPopupControlIntent(tabId, { patch: { speed: 2 } });
			// A realtime MediaStream has no timeline either — `duration` is
			// `Infinity` — so the rate is refused before the write instead of being
			// written and answered with a readback mismatch seconds later.
			expect(rejected).toMatchObject({ ok: true, data: { fields: { speed: {
				phase: 'error', actual: null, controlled: false,
				lastError: { code: 'capability-unavailable', retryable: false },
			} } } });
			expect(await page.evaluate(() => document.querySelector<HTMLVideoElement>('#v')?.playbackRate)).toBe(1);
			await page.evaluate(async (toneBytes) => {
				const old = document.querySelector<HTMLVideoElement>('#v');
				if (!(old?.srcObject instanceof MediaStream)) throw new Error('Realtime fixture stream is missing');
				for (const track of old.srcObject.getTracks()) track.stop();
				const next = document.createElement('video');
				next.id = 'v';
				next.muted = true;
				next.src = URL.createObjectURL(new Blob([Uint8Array.from(toneBytes)], { type: 'audio/wav' }));
				old.replaceWith(next);
				await next.play();
			}, [...SMOKE_TONE_WAV]);
			await eventually(() => client.evaluate(async (targetTabId) => chrome.runtime.sendMessage({
				protocolVersion: 2, requestId: crypto.randomUUID(), tabId: targetTabId,
				type: 'spectra.control.snapshot.get', payload: { tabId: targetTabId },
			}), tabId), (response) => response.ok
				&& response.data?.activeMedia?.mediaId !== (rejected.ok ? rejected.data.target?.mediaId : null)
				&& response.data.fields.speed?.actual === 1
				&& response.data.fields.speed.desired === 1,
				'replacement observes 1x without replaying the rejected 2x intent');
			expect(await page.evaluate(() => document.querySelector<HTMLVideoElement>('#v')?.playbackRate)).toBe(1);
		} finally {
			await client.close();
			await page.close().catch(() => undefined);
		}
	}, 35_000);

	test('upgrades restored DOM speed when a same-document SPA modal controller mounts later', async () => {
		const spaUrl = `${fixtureUrl}?spa-speed-shell=1`;
		const spaPage = await browser.newPage();
		try {
			await spaPage.goto(spaUrl, { waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(spaUrl);
			await spaPage.bringToFront();
			const tabId = await getTabId(spaUrl);
			const documentToken = await spaPage.evaluate(() => {
				const token = crypto.randomUUID();
				(window as Window & { __spectraSpaDocumentToken?: string })
					.__spectraSpaDocumentToken = token;
				return token;
			});
			const restored = await submitPopupControlIntent(
				tabId,
				{ patch: { speed: 2 } },
			);
			expect(restored).toMatchObject({
				ok: true,
				data: {
					fields: {
						speed: {
							phase: 'applied',
							strategy: 'dom-native',
							actual: 2,
						},
					},
				},
			});

			const mounted = await spaPage.evaluate((expectedDocumentToken) => {
				const video = document.querySelector<HTMLVideoElement>('#v');
				const host = video?.parentElement as (HTMLElement & {
					getPlaybackRate?: () => number;
					setPlaybackRate?: (value: number) => void;
				}) | null;
				if (!video || !host) throw new Error('SPA modal speed fixture is missing');
				const state = { speed: 1, writes: 0 };
				(window as Window & {
					__spectraPageMediaState?: typeof state;
				}).__spectraPageMediaState = state;
				host.getPlaybackRate = () => state.speed;
				host.setPlaybackRate = (value) => {
					state.speed = value;
					state.writes += 1;
					video.playbackRate = value;
				};
				history.pushState({}, '', '/spa-modal?modal_id=spectra-fixture');
				return {
					documentToken: (window as Window & {
						__spectraSpaDocumentToken?: string;
					}).__spectraSpaDocumentToken,
					expectedDocumentToken,
					pageSpeed: state.speed,
					domSpeed: video.playbackRate,
					url: location.href,
				};
			}, documentToken);
			expect(mounted).toMatchObject({
				documentToken,
				expectedDocumentToken: documentToken,
				pageSpeed: 1,
				domSpeed: 2,
			});
			expect(mounted.url).toContain('/spa-modal?modal_id=');
			// Route settlement wakes the retained 2x obligation before any new
			// explicit adjustment. Prove this automatic writer separately, so the
			// subsequent 2.5x request still has an exact one-write assertion.
			await eventually(() => spaPage.evaluate(() => {
				const state = (window as Window & {
					__spectraPageMediaState?: { speed: number; writes: number };
				}).__spectraPageMediaState;
				return { pageSpeed: state?.speed, writes: state?.writes,
					domSpeed: document.querySelector<HTMLVideoElement>('#v')?.playbackRate };
			}), (state) => state.pageSpeed === 2 && state.domSpeed === 2 && state.writes === 1,
			'route-settled controller maturation restores 2x exactly once');

			const adjusted = await submitPopupControlIntent(
				tabId,
				{ patch: { speed: 2.5 } },
			);
			expect(adjusted).toMatchObject({
				ok: true,
				data: {
					fields: {
						speed: {
							phase: 'applied',
							strategy: 'page-native',
							actual: 2.5,
						},
					},
				},
			});
			await eventually(
				() => spaPage.evaluate(() => {
					const video = document.querySelector<HTMLVideoElement>('#v');
					const state = (window as Window & {
						__spectraPageMediaState?: { speed: number; writes: number };
						__spectraSpaDocumentToken?: string;
					}).__spectraPageMediaState;
					return {
						documentToken: (window as Window & {
							__spectraSpaDocumentToken?: string;
						}).__spectraSpaDocumentToken,
						pageSpeed: state?.speed ?? null,
						writes: state?.writes ?? null,
						domSpeed: video?.playbackRate ?? null,
					};
				}),
				(state) => state.documentToken === documentToken
					&& state.pageSpeed === 2.5
					&& state.writes === 2
					&& state.domSpeed === 2.5,
				'same-document SPA page-controller writer upgrade',
			);
		} finally {
			await spaPage.close().catch(() => undefined);
		}
	}, 35_000);

	test('keeps native volume on the visible live stream when a hidden preview starts and changes properties', async () => {
		const settingsClient = await openExtensionClient('options.html');
		const settings = await patchExtensionSettings(settingsClient, {
			scope: 'global', changes: { visualizerEnabled: false },
		});
		const page = await browser.newPage();
		try {
			await page.goto(`${fixtureUrl}?live-preview-owner=1`, { waitUntil: 'load' });
			await page.evaluate(async () => {
				const video = document.querySelector<HTMLVideoElement>('#v');
				if (!video) throw new Error('Missing main video');
				video.style.cssText = 'width:640px;height:360px';
				const canvas = document.createElement('canvas');
				canvas.width = 640;
				canvas.height = 360;
				canvas.getContext('2d')?.fillRect(0, 0, 640, 360);
				const stream = canvas.captureStream(1);
				// Native volume needs an actual audio track. A video-only stream
				// intentionally exercises the separate document-output owner instead.
				const context = new AudioContext();
				const source = context.createOscillator();
				const audio = context.createMediaStreamDestination();
				source.connect(audio); source.start();
				await context.resume();
				for (const track of audio.stream.getAudioTracks()) stream.addTrack(track);
				video.srcObject = stream;
				await video.play();
			});
			await acquireSmokeRuntime(page.url(), 'live-preview-owner');
			const tabId = await getTabId(page.url());
			await page.bringToFront();
			await submitEffectiveVolume(tabId, 80);
			await page.evaluate(async () => {
				const main = document.querySelector<HTMLVideoElement>('#v');
				if (!(main?.srcObject instanceof MediaStream)) throw new Error('Missing live stream');
				const preview = document.createElement('video');
				preview.id = 'background-preview';
				preview.style.display = 'none';
				preview.muted = true;
				preview.srcObject = main.srcObject.clone();
				document.body.append(preview);
				await preview.play();
				preview.volume = 0.25;
				preview.playbackRate = 1.5;
				await new Promise<void>((resolve) => preview.addEventListener('volumechange', () => resolve(), { once: true }));
			});
			await page.bringToFront();
			await submitEffectiveVolume(tabId, 40);
			expect(await page.evaluate(() => ({
				main: document.querySelector<HTMLVideoElement>('#v')?.volume,
				preview: document.querySelector<HTMLVideoElement>('#background-preview')?.volume,
			}))).toEqual({ main: 0.4, preview: 0.25 });
		} finally {
			await page.close();
			await patchExtensionSettings(settingsClient, {
				scope: 'global', changes: { visualizerEnabled: settings.previous.globalSettings.visualizerEnabled },
			});
			await settingsClient.close();
		}
	}, 25_000);

	test('scrolling the same player out and back does not restore an older volume', async () => {
		const page = await browser.newPage();
		try {
			await page.goto(`${fixtureUrl}?scroll-owned-volume=1`, { waitUntil: 'load' });
			await page.evaluate(async bytes => {
				const video = document.querySelector<HTMLVideoElement>('#v');
				if (!video) throw new Error('Missing scroll player');
				document.documentElement.style.cssText = 'overflow:auto;height:auto';
				document.body.style.cssText = 'display:block;min-height:3000px;overflow:visible';
				video.style.cssText = 'display:block;width:640px;height:360px';
				video.src = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'audio/wav' }));
				video.loop = true; await video.play();
			}, [...SMOKE_TONE_WAV]);
			const tabId = await getTabId(page.url());
			await page.bringToFront();
			await submitEffectiveVolume(tabId, 40);
			await page.$eval('#v', video => { (video as HTMLVideoElement).volume = 0.8; });
			await eventually(() => readBadgeText(tabId), text => text === '80', 'page volume owns current actual');
			const selection = () => evaluateServiceWorker(async id => {
				const key = `spectra.control.tab.${id}`;
				return (await chrome.storage.local.get(key))[key]?.mediaObservation?.selection as number | undefined;
			}, tabId);
			const before = await selection();
			for (const top of [1500, 0]) {
				await page.evaluate(async y => {
					const video = document.querySelector('#v');
					if (!video) throw new Error('Missing scroll player');
					await new Promise<void>(resolve => {
						const observer = new IntersectionObserver(entries => {
							if (entries.some(entry => entry.isIntersecting === (y === 0))) {
								observer.disconnect(); requestAnimationFrame(() => resolve());
							}
						});
						observer.observe(video); window.scrollTo(0, y);
					});
				}, top);
			}
			await new Promise(resolve => setTimeout(resolve, 150));
			expect(await selection()).toBe(before);
			expect(await page.$eval('#v', video => (video as HTMLVideoElement).volume)).toBe(0.8);
			expect(await readBadgeText(tabId)).toBe('80');
		} finally { await page.close(); }
	}, 20_000);

	test('fullscreen lifecycle preserves the site volume, mute, and playback rate', async () => {
		// A preceding regression restarts the worker. Finish this document's
		// initialization before exercising a subsequent page-owned gesture.
		const tabId = await getTabId(fixturePage.url());
		await fixturePage.bringToFront();
		await sendFromActionPopup({ protocolVersion: 2, requestId: crypto.randomUUID(), tabId,
			type: 'spectra.control.snapshot.get', payload: { tabId } });
		await fixturePage.evaluate(() => {
			const video = document.querySelector<HTMLVideoElement>('#v');
			if (!video) throw new Error('SPA video is missing');
			video.volume = 0.37;
			video.muted = true;
			video.playbackRate = 0.75;
			document.dispatchEvent(new Event('fullscreenchange'));
			document.dispatchEvent(new Event('webkitfullscreenchange'));
		});
		// The lifecycle event is a *notification*, not a synchronization point: the
		// page-side gesture is adopted asynchronously. Wait for the extension to
		// observe it, then assert the element was never rewritten.
		const status = await eventually(
			() => readContentStatus(),
			(state) => state.config?.volume === 37
				&& state.config.volumeBase === 37
				&& state.config.boost === 1
				&& state.config.muted === true
				&& state.config.speed === 0.75,
			'fullscreen lifecycle adopts the page-owned volume, mute, and rate',
		);
		expect(status).toMatchObject({
			desiredMode: 'bypass',
			actualMode: 'bypass',
			mode: 'bypass',
			phase: 'idle',
			lastError: null,
			config: {
				volume: 37,
				volumeBase: 37,
				boost: 1,
				muted: true,
				speed: 0.75,
			},
		});
		expect(await fixturePage.evaluate(() => {
			const video = document.querySelector<HTMLVideoElement>('#v');
			return {
				volume: video?.volume,
				muted: video?.muted,
				playbackRate: video?.playbackRate,
				audioContexts: (window as Window & { __spectraAudioContextCount?: number })
					.__spectraAudioContextCount,
			};
		})).toEqual({
			volume: 0.37,
			muted: true,
			playbackRate: 0.75,
			audioContexts: 0,
		});
	});
});

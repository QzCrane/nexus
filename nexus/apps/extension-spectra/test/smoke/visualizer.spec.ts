import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { launchPuppeteerBrowser } from '../../../../scripts/browser-driver';
import type { CDPSession, Page } from 'puppeteer';
import type { AudioSessionSnapshot } from '@nexus/contracts';
import { DEFAULT_AUDIO_CONFIG, SMOKE_TONE_WAV, acquireSmokeRuntime, browser, closeActionPopup, collectPageErrors, configureRuntime, eventually, extensionId, fixturePage, fixtureUrl, getTabId, hasOffscreenAudioTab, installPageMediaControllerHarness, installSyntheticCaptureHarness, installTabCaptureStreamIdStub, installVisualizerBatchProbe, openActionPopupTarget, openExtensionClient, patchExtensionSettings, readContentStatus, readCurrentAudioSession, readSiteRouteRegistry, readSyntheticCaptureState, readVisualizerBatchCount, readVisualizerBatchProbe, removePageMediaControllerHarness, removeVisualizerBatchProbe, submitEffectiveVolume, waitForContentBootstrapStatus } from './harness';
import { prepareSmokeSession, startSmokeSession, teardownSmokeSession } from './harness';

describe('SPECTRA built extension smoke: visualizer', () => {
	beforeAll(async () => {
		const options = await prepareSmokeSession();
		const launched = await launchPuppeteerBrowser(options, {
			owner: 'apps/extension-spectra/test/smoke/visualizer.spec.ts',
			profile: { kind: 'temporary', prefix: 'spectra-smoke-', isolated: true },
		});
		await startSmokeSession(launched);
	}, 60_000);

	afterAll(async () => {
		await teardownSmokeSession();
	});

	test('detects direct audio with empty placeholders and renders spectrum across 0, 40, 100 and 110', async () => {
		const visualizerErrors: string[] = [];
		const popupErrors: string[] = [];
		const visualizerPage = await browser.newPage();
		const settingsClient = await openExtensionClient('options.html');
		collectPageErrors(visualizerPage, visualizerErrors);
		const visualizerUrl = `${fixtureUrl}?dynamic-visualizer=1`;
		const visualizerDomain = new URL(visualizerUrl).hostname;
		let popup: Page | null = null;
		let previousVisualizerEnabled = true;
		const nativeVolumes = [0, 40, 100] as const;
		try {
			const settings = await patchExtensionSettings(settingsClient, {
				scope: 'global',
				changes: { visualizerEnabled: true },
			});
			previousVisualizerEnabled = settings.previous.globalSettings.visualizerEnabled;
			await visualizerPage.goto(visualizerUrl, { waitUntil: 'domcontentloaded' });
			await visualizerPage.bringToFront();
			await visualizerPage.evaluate(async (toneBytes) => {
				const fixture = document.querySelector<HTMLVideoElement>('#v');
				if (!fixture) throw new Error('Visualizer media fixture is missing');
				const media = document.createElement('audio');
				media.id = fixture.id;
				media.controls = true;
				media.src = URL.createObjectURL(new Blob([Uint8Array.from(toneBytes)], { type: 'audio/wav' }));
				media.loop = true;
				fixture.replaceWith(media);
				// SPA players retain both a selected preload and an empty placeholder.
				// Neither visibility nor an empty DOM node may force tab Capture.
				const preload = document.createElement('audio');
				preload.src = media.src;
				preload.preload = 'metadata';
				const placeholder = document.createElement('video');
				placeholder.id = 'empty-player-placeholder';
				document.body.append(preload, placeholder);
				await new Promise<void>((resolveReady, rejectReady) => {
					media.addEventListener('canplay', () => resolveReady(), { once: true });
					media.addEventListener('error', () => {
						rejectReady(new Error(media.error?.message ?? `Media error ${String(media.error?.code)}`));
					}, { once: true });
					setTimeout(() => rejectReady(new Error(
						`Media load timeout: ready=${media.readyState}, network=${media.networkState}, error=${media.error?.message ?? 'none'}`,
					)), 5_000);
					media.load();
				});
				await media.play();
			}, [...SMOKE_TONE_WAV]);
			await waitForContentBootstrapStatus(visualizerUrl);
			await visualizerPage.bringToFront();
			const visualizerTabId = await getTabId(visualizerUrl);
			const native = await configureRuntime(visualizerUrl, {
				...DEFAULT_AUDIO_CONFIG,
				volume: nativeVolumes[0],
				volumeBase: nativeVolumes[0],
				eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
			});
			expect(native).toMatchObject({ actualMode: 'bypass', phase: 'idle' });
			// The first runtime acquisition may create the shared Options lease page,
			// which becomes Chrome's active tab. Restore the media tab immediately
			// before opening the action Popup so this test exercises the sole
			// foreground subscriber that is authorized to request transient Capture.
			await visualizerPage.bringToFront();
			await installVisualizerBatchProbe();
			const popupTarget = await openActionPopupTarget();
			popup = await popupTarget.asPage();
			collectPageErrors(popup, popupErrors);
			await popup.waitForSelector('.glass-card');

			const processorObservation = await eventually(
				async () => ({
					status: await readContentStatus(visualizerUrl),
					probe: await readVisualizerBatchProbe(),
					popup: await popup?.evaluate(() => {
						const canvas = document.querySelector<HTMLCanvasElement>('#main-stage .viz-canvas');
						const island = document.querySelector<HTMLElement>('#main-stage .viz-island');
						const bounds = canvas?.getBoundingClientRect();
						return {
							hidden: document.hidden,
							visibilityState: document.visibilityState,
							canvasConnected: canvas?.isConnected ?? false,
							canvasBounds: bounds
								? { width: bounds.width, height: bounds.height }
								: null,
							islandHidden: island?.classList.contains('hidden') ?? null,
							islandDisplay: island ? getComputedStyle(island).display : null,
							visualizerResources: performance.getEntriesByType('resource')
								.map((entry) => entry.name)
								.filter((name) => name.includes('visualizer') || name.includes('loop')),
						};
					}) ?? null,
				}),
				({ status }) => status.actualMode === 'webaudio'
					&& status.phase === 'active'
					&& status.config?.volume === nativeVolumes[0],
				'native-volume page WebAudio visualizer activation',
				15_000,
			);
			expect(processorObservation.status).toMatchObject({
				actualMode: 'webaudio',
				phase: 'active',
				config: { volume: nativeVolumes[0], volumeBase: nativeVolumes[0], boost: 1 },
			});
			const detectedRoutes = await eventually(
				() => readSiteRouteRegistry(settingsClient),
				(snapshot) => snapshot.entries.some((entry) => (
					entry.domain === visualizerDomain
					&& entry.route === 'direct'
					&& entry.source === 'auto'
				)),
				'acknowledged automatic direct-route record',
			);
			expect(detectedRoutes.entries).toContainEqual(expect.objectContaining({
				domain: visualizerDomain,
				route: 'direct',
				source: 'auto',
			}));
			expect(await hasOffscreenAudioTab(visualizerTabId)).toBe(false);
			await popup.waitForFunction(() => {
				const canvas = document.querySelector<HTMLCanvasElement>('#main-stage .viz-canvas');
				if (!canvas) return false;
				const pixels = canvas.getContext('2d')?.getImageData(
					0,
					0,
					canvas.width,
					Math.max(1, canvas.height - 4),
				).data;
				return Boolean(pixels?.some((value, index) => index % 4 === 3 && value > 0));
			}, { timeout: 15_000 });
			for (const volume of nativeVolumes.slice(1)) {
				await configureRuntime(visualizerUrl, {
					...DEFAULT_AUDIO_CONFIG,
					volume,
					volumeBase: volume,
					eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
				});
				const activeAtNativeVolume = await eventually(
					() => readContentStatus(visualizerUrl),
					(status) => status.actualMode === 'webaudio'
						&& status.phase === 'active'
						&& status.config?.volume === volume,
					`native-volume ${volume} page WebAudio visualizer continuity`,
				);
				expect(activeAtNativeVolume.config).toMatchObject({ volume, volumeBase: volume, boost: 1 });
				expect(await hasOffscreenAudioTab(visualizerTabId)).toBe(false);
			}
			await popup.$eval('.vol-slider', (element) => {
				const slider = element as HTMLInputElement;
				slider.value = '110';
				slider.dispatchEvent(new Event('input', { bubbles: true }));
			});
			const boosted = await eventually(
				() => readContentStatus(visualizerUrl),
				(status) => status.actualMode === 'webaudio' && status.phase === 'active'
					&& status.config?.volume === 110,
				'automatically detected direct source physical 110 ACK with empty placeholder',
			);
			expect(boosted.config).toMatchObject({ volume: 110, volumeBase: 100, boost: 1.1 });
			expect(await hasOffscreenAudioTab(visualizerTabId)).toBe(false);
			await configureRuntime(visualizerUrl, {
				...DEFAULT_AUDIO_CONFIG,
				eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
			});
			const activeProbe = await eventually(
				readVisualizerBatchProbe,
				(probe) => probe.events.some((event) => {
					const payload = event.payload as { captureTabId?: unknown; tabIds?: unknown };
					return payload.captureTabId === visualizerTabId
						&& Array.isArray(payload.tabIds)
						&& payload.tabIds.includes(visualizerTabId);
				}),
				'active visualizer sampling',
			);
			expect(activeProbe.count).toBeGreaterThan(0);

			await closeActionPopup(popup);
			popup = null;
			const bypass = await eventually(
				() => readContentStatus(visualizerUrl),
				(status) => status.actualMode === 'bypass' && status.phase === 'idle',
				10_000,
			);
			expect(bypass).toMatchObject({ actualMode: 'bypass', phase: 'idle' });
			let settledProbeCount = -1;

			// Release evidence is twofold. The preferred signal is the popup's
			// final empty batch request, but an abrupt popup teardown can destroy
			// that in-flight message after the background has already processed the
			// authoritative disconnect tombstone (bypass above). Accept the stream
			// settling with no further demands as equivalent so slow CI machines
			// are not failed by a lost fire-and-forget request.
			const release = await eventually(
				async () => {
					const probe = await readVisualizerBatchProbe();
					const emptyAnnounced = probe.events.some((event) => {
						const payload = event.payload as { captureTabId?: unknown; tabIds?: unknown };
						return payload.captureTabId === null
							&& Array.isArray(payload.tabIds)
							&& payload.tabIds.length === 0;
					});
					return { probe, emptyAnnounced };
				},
				({ probe, emptyAnnounced }) => {
					if (emptyAnnounced) return true;
					settledProbeCount = settledProbeCount < 0 ? probe.count : settledProbeCount;
					return probe.count === settledProbeCount && probe.count > 0;
				},
				'visualizer subscription release or batch stream settle',
			);
			const settledCount = release.probe.count;
			await new Promise((resolveWait) => setTimeout(resolveWait, 50));
			expect(await readVisualizerBatchCount()).toBe(settledCount);
		} finally {
			if (popup) await closeActionPopup(popup);
			await removeVisualizerBatchProbe();
			await patchExtensionSettings(settingsClient, {
				scope: 'global',
				changes: { visualizerEnabled: previousVisualizerEnabled },
			}).catch(() => undefined);
			await settingsClient.close().catch(() => undefined);
			await visualizerPage.close().catch(() => undefined);
		}
		expect(popupErrors).toEqual([]);
		expect(visualizerErrors).toEqual([]);
	}, 40_000);

	test('never starts Capture for a neutral visualizer on an unsafe stream source', async () => {
		const settingsClient = await openExtensionClient('options.html');
		const unsafePage = await browser.newPage();
		let popup: Page | null = null;
		const settings = await patchExtensionSettings(settingsClient, {
			scope: 'global',
			changes: { visualizerEnabled: true },
		});
		try {
			await installSyntheticCaptureHarness();
			await installTabCaptureStreamIdStub();
			const unsafeUrl = `${fixtureUrl}?unsafe-neutral-visualizer=1`;
			await unsafePage.goto(unsafeUrl, { waitUntil: 'domcontentloaded' });
			await unsafePage.evaluate(async () => {
				const video = document.querySelector<HTMLVideoElement>('#v');
				if (!video) throw new Error('Unsafe visualizer fixture is missing');
				const canvas = document.createElement('canvas');
				canvas.width = 64;
				canvas.height = 64;
				canvas.getContext('2d')?.fillRect(0, 0, 64, 64);
				video.srcObject = canvas.captureStream(1);
				await video.play();
			});
			await waitForContentBootstrapStatus(unsafeUrl);
			await acquireSmokeRuntime(unsafeUrl, 'unsafe-neutral-visualizer');
			await unsafePage.bringToFront();
			const tabId = await getTabId(unsafeUrl);
			const captureCallsBeforePopup = (await readSyntheticCaptureState()).calls;
			const popupTarget = await openActionPopupTarget();
			popup = await popupTarget.asPage();
			await popup.waitForSelector('#main-stage .viz-canvas');
			const contentSubscriberId = `smoke-unsafe-${crypto.randomUUID()}`;
			const subscriberAck = await popup.evaluate(async ({ targetTabId, subscriberId }) => (
				chrome.runtime.sendMessage({
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					type: 'spectra.audio.visualizer.batch',
					payload: {
						subscriberId,
						generation: 1,
						tabIds: [targetTabId],
						captureTabId: targetTabId,
					},
				})
			), { targetTabId: tabId, subscriberId: contentSubscriberId });
			expect(subscriberAck).toMatchObject({
				ok: true,
				data: {
					subscriberId: contentSubscriberId,
					generation: 1,
					frames: { [String(tabId)]: null },
				},
			});
			await popup.waitForFunction(() => {
				const slider = document.querySelector<HTMLElement>('.vol-slider');
				return slider
					? getComputedStyle(slider).getPropertyValue('--slider-accent').trim() === '#2563eb'
					: false;
			});
			await popup.evaluate(() => {
				type ColorFrame = {
					handle: string;
					label: string;
					fillWidth: string;
					accent: string;
					fill: string;
					value: string;
				};
				type ColorTraceScope = Window & typeof globalThis & {
					__spectraColorTrace?: ColorFrame[];
					__spectraRecordColor?: () => void;
					__spectraColorObserver?: MutationObserver;
					__spectraColorAnimationFrame?: number;
				};
				const scope = window as ColorTraceScope;
				const slider = document.querySelector<HTMLElement>('.vol-slider');
				const fill = document.querySelector<HTMLElement>('.slider-fill');
				const value = document.querySelector<HTMLElement>('.vol-number');
				if (!slider || !fill || !value) throw new Error('Popup color controls are incomplete');
				const record = () => {
					scope.__spectraColorTrace?.push({
						handle: (slider as HTMLInputElement).value,
						label: value.textContent?.trim() ?? '',
						fillWidth: fill.style.width,
						accent: getComputedStyle(slider).getPropertyValue('--slider-accent').trim(),
						fill: getComputedStyle(fill).backgroundColor,
						value: getComputedStyle(value).color,
					});
				};
				scope.__spectraColorTrace = [];
				scope.__spectraRecordColor = record;
				scope.__spectraColorObserver?.disconnect();
				scope.__spectraColorObserver = new MutationObserver(record);
				for (const element of [slider, fill, value]) {
					scope.__spectraColorObserver.observe(element, {
						attributes: true,
						childList: true,
						characterData: true,
						subtree: true,
						attributeFilter: ['class', 'style'],
					});
				}
				const sampleRenderedFrame = () => {
					record();
					scope.__spectraColorAnimationFrame = requestAnimationFrame(sampleRenderedFrame);
				};
				if (scope.__spectraColorAnimationFrame !== undefined) {
					cancelAnimationFrame(scope.__spectraColorAnimationFrame);
				}
				scope.__spectraColorAnimationFrame = requestAnimationFrame(sampleRenderedFrame);
				record();
			});

			const neutral = await eventually(
				() => readContentStatus(unsafeUrl),
				(status) => status.config?.volume === 100
					&& status.config.volumeBase === 100
					&& status.config.boost === 1
					&& status.actualMode === 'bypass'
					&& status.phase === 'idle',
				'unsafe neutral visualizer remains native bypass',
			);
			expect(neutral).toMatchObject({
				actualMode: 'bypass',
				phase: 'idle',
				config: { volume: 100, volumeBase: 100, boost: 1 },
				lastError: null,
			});
			expect(await hasOffscreenAudioTab(tabId)).toBe(false);
			expect((await readSyntheticCaptureState()).calls).toBe(captureCallsBeforePopup);
			await new Promise((resolveWait) => setTimeout(resolveWait, 250));
			expect((await readSyntheticCaptureState()).calls).toBe(captureCallsBeforePopup);
			expect(await hasOffscreenAudioTab(tabId)).toBe(false);

			const volumeTransitions = [
				{ volume: 110, mode: 'capture', domVolume: 1 },
				{ volume: 50, mode: 'bypass', domVolume: 0.5 },
				{ volume: 110, mode: 'capture', domVolume: 1 },
				{ volume: 100, mode: 'bypass', domVolume: 1 },
			] as const;
			let expectedCaptureStarts = captureCallsBeforePopup;
			for (const transition of volumeTransitions) {
				await popup.evaluate(() => {
					const scope = window as Window & typeof globalThis & {
						__spectraColorTrace?: unknown[];
						__spectraRecordColor?: () => void;
					};
					scope.__spectraColorTrace = [];
					scope.__spectraRecordColor?.();
				});
				const immediateHandle = await popup.$eval('.vol-slider', (element, value) => {
					const slider = element as HTMLInputElement;
					slider.value = String(value);
					slider.dispatchEvent(new Event('input', { bubbles: true }));
					slider.dispatchEvent(new Event('change', { bubbles: true }));
					return slider.value;
				}, transition.volume);
				expect(immediateHandle).toBe(String(transition.volume));
				const expectedBoost = transition.volume > 100 ? transition.volume / 100 : 1;
				const expectedBase = Math.min(transition.volume, 100);
				const status = await eventually(
					() => readContentStatus(unsafeUrl),
					(current) => current.config?.volume === transition.volume
						&& current.config.volumeBase === expectedBase
						&& current.config.boost === expectedBoost
						&& current.actualMode === transition.mode
						&& current.phase === (transition.mode === 'capture' ? 'active' : 'idle'),
					`unsafe visualizer volume ${transition.volume} physical ACK`,
					15_000,
				);
				expect(status).toMatchObject({
					actualMode: transition.mode,
					phase: transition.mode === 'capture' ? 'active' : 'idle',
					config: {
						volume: transition.volume,
						volumeBase: expectedBase,
						boost: expectedBoost,
					},
				});
				expect(await unsafePage.$eval('#v', (element) => (
					Math.round((element as HTMLVideoElement).volume * 100) / 100
				))).toBe(transition.domVolume);

				if (transition.mode === 'capture') {
					expectedCaptureStarts += 1;
					expect(await readCurrentAudioSession(tabId)).toMatchObject({
						ok: true,
						data: { actualMode: 'capture', phase: 'active' },
					});
					expect(await hasOffscreenAudioTab(tabId)).toBe(true);
					expect((await readSyntheticCaptureState()).calls).toBe(expectedCaptureStarts);
				} else {
					expect(await readCurrentAudioSession(tabId)).toMatchObject({
						ok: true,
						data: { actualMode: 'bypass', phase: 'idle' },
					});
					await eventually(
						() => hasOffscreenAudioTab(tabId),
						(active) => !active,
						`unsafe visualizer Capture graph retired at ${transition.volume}`,
					);
					expect((await readSyntheticCaptureState()).calls).toBe(expectedCaptureStarts);
				}
				await new Promise((resolveWait) => setTimeout(resolveWait, 150));
				const presentationTrace = await popup.evaluate(() => {
					const scope = window as Window & typeof globalThis & {
						__spectraColorTrace?: Array<{
							handle: string;
							label: string;
							fillWidth: string;
							accent: string;
							fill: string;
							value: string;
						}>;
					};
					return (scope.__spectraColorTrace ?? [])
						.filter((frame, index, frames) => (
							index === 0 || JSON.stringify(frame) !== JSON.stringify(frames[index - 1])
						));
				});
				const blue = '#2563eb|rgb(37, 99, 235)|rgb(37, 99, 235)';
				const purple = '#7c3aed|rgb(124, 58, 237)|rgb(124, 58, 237)';
				const expectedColor = transition.mode === 'capture' ? purple : blue;
				const expectedLabel = `${transition.volume}%`;
				const expectedFillPercent = (transition.volume / 800) * 100;
				const newValueFrames = presentationTrace.filter((frame) => frame.label === expectedLabel);
const settledFrame = newValueFrames[newValueFrames.length - 1];
expect(settledFrame).toMatchObject({
handle: String(transition.volume),
label: expectedLabel,
accent: expectedColor.split('|')[0],
fill: expectedColor.split('|')[1],
value: expectedColor.split('|')[2],
});
expect(Number.parseFloat(settledFrame?.fillWidth ?? '')).toBeCloseTo(expectedFillPercent);
expect(newValueFrames.every((frame) => (
Math.abs(Number.parseFloat(frame.fillWidth) - expectedFillPercent) < 0.000_001
))).toBe(true);
				const colorTrace = presentationTrace
					.map(({ accent, fill, value }) => `${accent}|${fill}|${value}`)
					.filter((frame, index, frames) => index === 0 || frame !== frames[index - 1]);
				expect(colorTrace).toEqual(
					transition.mode === 'capture' ? [blue, purple] : [purple, blue],
				);
			}
			await new Promise((resolveWait) => setTimeout(resolveWait, 250));
			expect((await readSyntheticCaptureState()).calls).toBe(expectedCaptureStarts);
			expect(await hasOffscreenAudioTab(tabId)).toBe(false);
			const subscriberRelease = await popup.evaluate(async ({ subscriberId }) => (
				chrome.runtime.sendMessage({
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					type: 'spectra.audio.visualizer.batch',
					payload: {
						subscriberId,
						generation: 2,
						tabIds: [],
						captureTabId: null,
					},
				})
			), { subscriberId: contentSubscriberId });
			expect(subscriberRelease).toMatchObject({
				ok: true,
				data: { subscriberId: contentSubscriberId, generation: 2, frames: {} },
			});
		} finally {
			await popup?.evaluate(() => {
				const scope = window as Window & typeof globalThis & {
					__spectraColorObserver?: MutationObserver;
					__spectraColorAnimationFrame?: number;
				};
				scope.__spectraColorObserver?.disconnect();
				if (scope.__spectraColorAnimationFrame !== undefined) {
					cancelAnimationFrame(scope.__spectraColorAnimationFrame);
				}
			}).catch(() => undefined);
			if (popup) await closeActionPopup(popup).catch(() => undefined);
			await unsafePage.close().catch(() => undefined);
			await patchExtensionSettings(settingsClient, {
				scope: 'global',
				changes: { visualizerEnabled: settings.previous.globalSettings.visualizerEnabled },
			}).catch(() => undefined);
			await settingsClient.close().catch(() => undefined);
		}
	}, 20_000);

	test('paints the first visible Popup card from the newest settled processor lifecycle', async () => {
		await installPageMediaControllerHarness();
		await installSyntheticCaptureHarness();
		await installTabCaptureStreamIdStub();
		const settingsClient = await openExtensionClient('options.html');
		const settings = await patchExtensionSettings(settingsClient, {
			scope: 'global',
			changes: { visualizerEnabled: false },
		});
		const tabId = await getTabId(fixturePage.url());
		const openWithStaleSession = async (
			staleSession: AudioSessionSnapshot,
			expectedColor: 'blue' | 'purple',
		): Promise<void> => {
			const popup = await browser.newPage();
			popup.setDefaultTimeout(5_000);
			await popup.evaluateOnNewDocument(({ targetTabId, injectedSession }) => {
				type FirstPaintScope = Window & typeof globalThis & {
					__spectraFirstPaintColors?: string[];
					__spectraFirstPaintFrame?: number;
				};
				const scope = window as FirstPaintScope;
				const originalSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
				chrome.runtime.sendMessage = ((message: unknown, ...args: unknown[]) => {
					if (message && typeof message === 'object'
						&& (message as { type?: unknown }).type === 'spectra.audio.session.get') {
						return Promise.resolve({ ok: true, data: injectedSession });
					}
					return Reflect.apply(originalSendMessage, chrome.runtime, [message, ...args]);
				}) as typeof chrome.runtime.sendMessage;
				scope.__spectraFirstPaintColors = [];
				const scan = () => {
					const card = document.querySelector<HTMLElement>(`.glass-card[data-tab-id="${targetTabId}"]`);
					const slider = card?.querySelector<HTMLElement>('.vol-slider');
					const fill = card?.querySelector<HTMLElement>('.slider-fill');
					const value = card?.querySelector<HTMLElement>('.vol-number');
					if (!card || !slider || !fill || !value
						|| card.hidden || getComputedStyle(card).display === 'none') return;
					const frame = [
						getComputedStyle(slider).getPropertyValue('--slider-accent').trim(),
						getComputedStyle(fill).backgroundColor,
						getComputedStyle(value).color,
					].join('|');
					const trace = scope.__spectraFirstPaintColors;
					if (trace && trace.at(-1) !== frame) trace.push(frame);
				};
				new MutationObserver(scan).observe(document, {
					attributes: true,
					childList: true,
					subtree: true,
					attributeFilter: ['class', 'hidden', 'style'],
				});
				const sample = () => {
					scan();
					scope.__spectraFirstPaintFrame = requestAnimationFrame(sample);
				};
				scope.__spectraFirstPaintFrame = requestAnimationFrame(sample);
			}, { targetTabId: tabId, injectedSession: staleSession });
			try {
				await fixturePage.bringToFront();
				await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
				await popup.waitForSelector(`.glass-card[data-tab-id="${tabId}"] .vol-slider`);
				await new Promise((resolveWait) => setTimeout(resolveWait, 250));
				const trace = await popup.evaluate(() => (
					(window as Window & typeof globalThis & { __spectraFirstPaintColors?: string[] })
						.__spectraFirstPaintColors ?? []
				));
				const blue = '#2563eb|rgb(37, 99, 235)|rgb(37, 99, 235)';
				const purple = '#7c3aed|rgb(124, 58, 237)|rgb(124, 58, 237)';
				expect(trace).toEqual([expectedColor === 'purple' ? purple : blue]);
			} finally {
				await popup.close().catch(() => undefined);
			}
		};
		try {
			await fixturePage.bringToFront();
			await submitEffectiveVolume(tabId, 100);
			const bypassSession = await readCurrentAudioSession(tabId);
			if (!bypassSession.ok || !bypassSession.data) throw new Error('Missing bypass session');
			await openWithStaleSession({
				...bypassSession.data,
				generation: Math.max(0, bypassSession.data.generation - 1),
				desiredMode: 'capture',
				actualMode: 'capture',
				phase: 'active',
			}, 'blue');

			await fixturePage.bringToFront();
			await submitEffectiveVolume(tabId, 350);
			const captureSession = await readCurrentAudioSession(tabId);
			if (!captureSession.ok || !captureSession.data) throw new Error('Missing Capture session');
			await openWithStaleSession({
				...captureSession.data,
				generation: Math.max(0, captureSession.data.generation - 1),
				desiredMode: 'bypass',
				actualMode: 'bypass',
				phase: 'idle',
			}, 'purple');
		} finally {
			await fixturePage.bringToFront().catch(() => undefined);
			await submitEffectiveVolume(tabId, 100).catch(() => undefined);
			await removePageMediaControllerHarness();
			await patchExtensionSettings(settingsClient, {
				scope: 'global',
				changes: { visualizerEnabled: settings.previous.globalSettings.visualizerEnabled },
			}).catch(() => undefined);
			await settingsClient.close().catch(() => undefined);
		}
	}, 25_000);

	test('keeps visualizer IPC and Capture at zero when the feature is disabled', async () => {
		const settingsClient = await openExtensionClient('options.html');
		const settings = await patchExtensionSettings(settingsClient, {
			scope: 'global',
			changes: { visualizerEnabled: false },
		});
		await fixturePage.bringToFront();
		const bypass = await configureRuntime(fixturePage.url(), {
			...DEFAULT_AUDIO_CONFIG,
			eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
		});
		expect(bypass).toMatchObject({ actualMode: 'bypass', phase: 'idle' });
		await installVisualizerBatchProbe();
		let popup: Page | null = null;
		let popupClient: CDPSession | null = null;
		try {
			const popupTarget = await openActionPopupTarget(5_000);
			popup = await popupTarget.asPage();
			if (!popup) throw new Error('Unable to attach to the visualizer action popup page');
			popupClient = await popup.createCDPSession();
			await popupClient.send('Runtime.enable');

			await new Promise((resolveWait) => setTimeout(resolveWait, 100));
			const initialProbe = await readVisualizerBatchProbe();
			expect(initialProbe.count, JSON.stringify(initialProbe.events)).toBe(0);
			expect(await readContentStatus(fixturePage.url())).toMatchObject({
				actualMode: 'bypass',
				phase: 'idle',
			});
			expect(await popup.$eval('.viz-island', (element) => element.classList.contains('hidden')))
				.toBe(true);

			await closeActionPopup(popup);
			popup = null;
			await new Promise((resolveWait) => setTimeout(resolveWait, 50));
			const countAfterClose = await readVisualizerBatchCount();
			await new Promise((resolveWait) => setTimeout(resolveWait, 50));
			expect(await readVisualizerBatchCount()).toBe(countAfterClose);
		} finally {
			if (popup) await closeActionPopup(popup).catch(() => undefined);
			await popupClient?.detach().catch(() => undefined);
			await removeVisualizerBatchProbe();
			await patchExtensionSettings(settingsClient, {
				scope: 'global',
				changes: { visualizerEnabled: settings.previous.globalSettings.visualizerEnabled },
			}).catch(() => undefined);
			await settingsClient.close().catch(() => undefined);
		}
	}, 10_000);
});

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { launchPuppeteerBrowser } from '../../../../scripts/browser-driver';
import { createRemoteProof } from '../../src/remote/protocol';
import { requireValue } from '../helpers/require-value';
import { DEFAULT_AUDIO_CONFIG, acquireSmokeRuntime, browser, configureRuntime, deliverOffscreenTestRemote, detachOffscreenPeerRuntimeDebugger, evaluateServiceWorker, eventually, extensionId, fixturePage, fixtureUrl, getOffscreenContextCount, getTabId, installOffscreenPeerRuntimeProbe, installPageMediaControllerHarness, installSyntheticCaptureHarness, installTabCaptureStreamIdStub, openExtensionClient, openOffscreenTestRemote, patchExtensionSettings, peerRuntimeDebugEvents, pressDefaultHotkeyFromContent, readBadgeColor, readContentStatus, readCurrentAudioSession, readOffscreenPeerRuntimeProbe, readOffscreenSnapshot, readOffscreenTestRemoteMessages, readOsdFeedback, readPageMediaControllerHarness, readPopupVolumePresentation, readSyntheticCaptureState, releaseSmokeRuntime, releaseSyntheticCapture, removePageMediaControllerHarness, restartServiceWorker, restoreOffscreenPeerRuntimeProbe, sendCaptureRequest, sendFromActionPopup, server, startOsdFeedbackProbe, submitEffectiveVolume, tapDefaultShortcut, waitForContentBootstrapStatus, waitForContentStatus, withDiagnosticTimeout } from './harness';
import type { ContentStatus, RemotePublicSession, SmokeRuntimeLease } from './harness';
import { prepareSmokeSession, startSmokeSession, teardownSmokeSession } from './harness';

describe('SPECTRA built extension smoke: capture', () => {
	beforeAll(async () => {
		const options = await prepareSmokeSession();
		const launched = await launchPuppeteerBrowser(options, {
			owner: 'apps/extension-spectra/test/smoke/capture.spec.ts',
			profile: { kind: 'temporary', prefix: 'spectra-smoke-', isolated: true },
		});
		await startSmokeSession(launched);
	}, 60_000);

	afterAll(async () => {
		await teardownSmokeSession();
	});

	test('rejects unadmitted capture requests without creating an offscreen host', async () => {
		const secondaryUrl = `${fixtureUrl}?secondary=1`;
		const secondary = await browser.newPage();
		await secondary.goto(secondaryUrl, { waitUntil: 'domcontentloaded' });
		await waitForContentBootstrapStatus(secondaryUrl);
		const extensionClient = await browser.newPage();
		await extensionClient.goto(`chrome-extension://${extensionId}/options.html`, {
			waitUntil: 'domcontentloaded',
		});

		const primaryUrl = fixturePage.url();
		const contextsBefore = await getOffscreenContextCount();
		let leases: SmokeRuntimeLease[] = [];
		try {
			leases = await Promise.all([
				acquireSmokeRuntime(primaryUrl, 'capture-denied-primary'),
				acquireSmokeRuntime(secondaryUrl, 'capture-denied-secondary'),
			]);
			const result = await extensionClient.evaluate(async ({ urls }) => {
				const tabs = await chrome.tabs.query({});
				const tabIds = urls.map((url) => {
					const tabId = tabs.find((tab) => tab.url === url)?.id;
					if (tabId === undefined) throw new Error(`Unable to find capture tab: ${url}`);
					return tabId;
				});
				const config = {
					enabled: true,
					volume: 100,
					volumeBase: 100,
					boost: 1,
					muted: false,
					compressor: false,
					mono: false,
					bass: false,
					eqValues: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
					pan: 0,
					delay: 0,
					speed: 1,
					preservePitch: true,
				};
				const captureRequest = async (tabId: number, enabled: boolean, generation: number) => {
					const [injection] = await chrome.scripting.executeScript({
						target: { tabId },
						world: 'ISOLATED',
						func: async (request) => chrome.runtime.sendMessage({
							protocolVersion: 2,
							requestId: crypto.randomUUID(),
							tabId: request.tabId,
							generation: request.generation,
							type: 'spectra.audio.capture.set',
							payload: {
								enabled: request.enabled,
								config: request.config,
							},
						}),
						args: [{ tabId, enabled, generation, config }],
					});
					return injection?.result;
				};
				const starts = await Promise.all(tabIds.map((tabId, index) => (
					captureRequest(tabId, true, index + 1)
				)));
				const contexts = await chrome.runtime.getContexts({
					contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
				});
				const stops = await Promise.all(tabIds.map((tabId, index) => (
					captureRequest(tabId, false, index + 100)
				)));
				const waitForStatus = async (
					tabId: number,
					predicate: (status: { mode?: string; phase?: string }) => boolean,
				) => {
					const deadline = Date.now() + 5_000;
					let status: { mode?: string; phase?: string; config?: typeof config } = {};
					while (Date.now() < deadline) {
						const response = await chrome.tabs.sendMessage(tabId, {
							protocolVersion: 2,
							requestId: crypto.randomUUID(),
							tabId,
							type: 'spectra.audio.runtime.get',
							payload: {},
						});
						if (!response?.ok) throw new Error(response?.error?.message ?? 'Unable to read capture fixture runtime');
						status = { ...response.data, mode: response.data.actualMode };
						if (predicate(status)) return status;
						await new Promise((resolveWait) => setTimeout(resolveWait, 10));
					}
					throw new Error(`Timed out waiting for tab ${tabId} status: ${JSON.stringify(status)}`);
				};
				const stoppedStatuses = await Promise.all(tabIds.map((tabId) => waitForStatus(
					tabId,
					(status) => status.mode === 'bypass' && status.phase === 'idle',
				)));

				return {
					tabIds,
					starts,
					contexts: contexts.length,
					stops,
					stoppedStatuses,
				};
			}, { urls: [primaryUrl, secondaryUrl] });
			// A denied request cannot create a host; an unrelated idle host may retire.
			expect(result.contexts).toBeLessThanOrEqual(contextsBefore);
			for (const start of result.starts) {
				expect(start).toMatchObject({
					ok: false,
					error: { code: 'invalid_request', message: 'Malformed capture request' },
				});
			}
			for (const stop of result.stops) {
				expect(stop).toMatchObject({ ok: true, data: { phase: 'idle', active: false } });
			}
			expect(result.stoppedStatuses).toEqual([
				expect.objectContaining({ mode: 'bypass', phase: 'idle' }),
				expect.objectContaining({ mode: 'bypass', phase: 'idle' }),
			]);
		} finally {
			await Promise.all(leases.map((lease) => releaseSmokeRuntime(lease)));
			await extensionClient.close();
			await secondary.close();
		}
	}, 35_000);

	test('loads PeerJS once only after explicit Remote create on a Capture-only host', async () => {
		const captureOnly = await browser.newPage();
		const extensionClient = await openExtensionClient();
		const captureOnlyUrl = `${fixtureUrl}?peer-lazy-capture=1`;
		let session: RemotePublicSession | null = null;
		let vendorRequests = 0;
		let tabId = 0;
		let latestCaptureGeneration = 0;
		try {
			await captureOnly.goto(captureOnlyUrl, { waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(captureOnlyUrl);
			tabId = await getTabId(captureOnlyUrl);
			await installTabCaptureStreamIdStub();
			await installSyntheticCaptureHarness();

			const denied = await sendCaptureRequest(extensionClient, tabId, true, 1);
			expect(denied).toMatchObject({
				ok: false,
				error: { code: 'invalid_request', message: 'Malformed capture request' },
			});
			// No one-shot admission was supplied. The request is rejected before it
			// can allocate a host or advance the authoritative session generation.
			latestCaptureGeneration = 0;
			expect(await getOffscreenContextCount()).toBe(1);
			expect((await readOffscreenSnapshot()).remoteTabs).toEqual([]);
			expect(await readOffscreenPeerRuntimeProbe()).toEqual({
				peerType: 'undefined',
				vendorAssignments: 0,
				peerConstructions: 0,
				peerDestructions: 0,
			});

			await captureOnly.bringToFront();
			await submitEffectiveVolume(tabId, 130);
			const started = await eventually(
				() => readContentStatus(captureOnlyUrl),
				(status) => status.config?.volume === 130
					&& status.phase === 'active'
					&& status.actualMode === 'capture',
				15_000,
			);
			const startGeneration = requireValue(
				started.generation,
				'Capture admission did not return a generation',
			);
			expect(started).toMatchObject({
				generation: startGeneration,
				phase: 'active',
				actualMode: 'capture',
			});
			latestCaptureGeneration = startGeneration;
			const initialSnapshot = await eventually(
				readOffscreenSnapshot,
				(snapshot) => snapshot.audioTabs.some((entry) => (
					entry.tabId === tabId && entry.generation === startGeneration
				)),
				'shared offscreen host acknowledges initial active capture tab',
				10_000,
			);
			expect(initialSnapshot.audioTabs).toEqual(expect.arrayContaining([
				expect.objectContaining({ tabId, generation: startGeneration }),
			]));
			expect(await readOffscreenPeerRuntimeProbe()).toMatchObject({
				peerType: 'undefined',
			});

			await installOffscreenPeerRuntimeProbe(false, () => {
				vendorRequests += 1;
			});

			const physicalBeforeRemote = await readSyntheticCaptureState();
			const processorBeforeRemote = (await readOffscreenSnapshot()).audioTabs.find((entry) => entry.tabId === tabId);
			const creation = await sendFromActionPopup<{
				ok: boolean;
				data?: RemotePublicSession;
				error?: { message?: string };
			}>({
				protocolVersion: 2,
				tabId,
				type: 'spectra.remote.session.create',
				payload: { tabId },
			});
			if (!creation.ok || !creation.data) {
				throw new Error(creation.error?.message ?? 'PeerJS lazy-load session creation failed');
			}
			session = creation.data;
			const observedVendorRequests = await eventually(
				() => Promise.resolve(vendorRequests),
				(count) => count === 1,
				'one local PeerJS ESM request',
				5_000,
			);
			expect(observedVendorRequests).toBe(1);
			const loaded = await eventually(
				readOffscreenPeerRuntimeProbe,
				(probe) => probe.peerType === 'undefined'
					&& probe.vendorAssignments === 0
					&& probe.peerConstructions === 1,
				`one explicit PeerJS vendor load (${peerRuntimeDebugEvents.join(',')})`,
				5_000,
			);
			expect(loaded).toMatchObject({
				peerType: 'undefined',
				vendorAssignments: 0,
				peerConstructions: 1,
				peerDestructions: 0,
			});
			// CDP observes the exact local ESM request; the constructor counter proves
			// that the imported module supplied the Peer implementation without a
			// global assignment.
			expect(vendorRequests).toBe(1);
			expect(await getOffscreenContextCount()).toBe(1);
			// Slow CI machines can still be waking the capture owner when the
			// session creation returns; wait for the shared host to acknowledge the
			// tab instead of racing a single snapshot read.
			const currentCapture = await readContentStatus(captureOnlyUrl);
			const sharedHost = await eventually(
				readOffscreenSnapshot,
				(snapshot) => snapshot.audioTabs.some((entry) => (
					entry.tabId === tabId && entry.generation === currentCapture.generation
				)),
				'shared offscreen host acknowledges the capture tab',
			);
			expect(sharedHost.audioTabs).toEqual(expect.arrayContaining([
				expect.objectContaining({ tabId, generation: currentCapture.generation,
					graphSignature: processorBeforeRemote?.graphSignature,
					normalizedActualConfig: processorBeforeRemote?.normalizedActualConfig }),
			]));
			expect((await readSyntheticCaptureState()).calls).toBe(physicalBeforeRemote.calls);
			expect((await readSyntheticCaptureState()).processorStates).toEqual(physicalBeforeRemote.processorStates);
			expect(sharedHost.remoteTabs).toEqual([{ tabId, sessionId: session.sessionId }]);

			const repeated = await sendFromActionPopup<{
				ok: boolean;
				data?: RemotePublicSession;
			}>({
				protocolVersion: 2,
				tabId,
				type: 'spectra.remote.session.create',
				payload: { tabId },
			});
			expect(repeated).toMatchObject({
				ok: true,
				data: { sessionId: session.sessionId, tabId },
			});
			expect(await readOffscreenPeerRuntimeProbe()).toMatchObject({
				vendorAssignments: loaded.vendorAssignments,
				peerConstructions: loaded.peerConstructions,
				peerDestructions: loaded.peerDestructions,
			});
			expect(vendorRequests).toBe(1);
		} finally {
			if (session) {
				await sendFromActionPopup({
					protocolVersion: 2,
					tabId,
					type: 'spectra.remote.session.close',
					payload: { tabId, sessionId: session.sessionId },
				}).catch(() => undefined);
			}
			await detachOffscreenPeerRuntimeDebugger();
			if (tabId > 0) {
				await sendCaptureRequest(
					extensionClient,
					tabId,
					false,
					latestCaptureGeneration + 1,
				).catch(() => undefined);
			}
			await extensionClient.close().catch(() => undefined);
			await captureOnly.close().catch(() => undefined);
		}
	}, 45_000);

	test('creates an acknowledged capture processor with a real synthetic MediaStream', async () => {
		await installSyntheticCaptureHarness();
		await installTabCaptureStreamIdStub();
		const extensionClient = await openExtensionClient();
		const tabId = await getTabId(fixturePage.url());
		try {
			await fixturePage.bringToFront();
			await submitEffectiveVolume(tabId, 130);
			const started = await waitForContentStatus(
				(status) => status.config?.volume === 130
					&& status.phase === 'active'
					&& status.actualMode === 'capture',
				15_000,
			);
			expect(started).toMatchObject({
				phase: 'active',
				actualMode: 'capture',
				config: { volume: 130, volumeBase: 100, boost: 1.3 },
			});
			const host = await readOffscreenSnapshot();
			expect(host.audioTabs).toEqual(expect.arrayContaining([
				expect.objectContaining({ tabId, generation: started.generation }),
			]));
			expect(await getOffscreenContextCount()).toBe(1);
			const harness = await readSyntheticCaptureState();
			expect(harness.calls).toBeGreaterThan(0);
			expect(harness.processorStates.filter((state) => state === 'running')).toHaveLength(1);

			const stopped = await sendCaptureRequest(
				extensionClient,
				tabId,
				false,
				(started.generation ?? 0) + 1,
			);
			expect(stopped).toMatchObject({ ok: true, data: { phase: 'idle', active: false } });
			expect((await readOffscreenSnapshot()).audioTabs).toEqual([]);
		} finally {
			await extensionClient.close();
		}
	}, 35_000);

	test('resumes acknowledged Capture after the fullscreen boundary succeeds', async () => {
		await installSyntheticCaptureHarness();
		await installTabCaptureStreamIdStub();
		const extensionClient = await openExtensionClient();
		const tabId = await getTabId(fixturePage.url());
		// Headless Chrome rejects the browser fullscreen endpoint even when CDP
		// supplies a user gesture. Replace only that endpoint before document_start;
		// the production MAIN bridge and Capture/offscreen lifecycle stay intact.
		const fullscreenStub = await fixturePage.evaluateOnNewDocument(() => {
			Object.defineProperty(Element.prototype, 'requestFullscreen', {
				configurable: true,
				enumerable: false,
				writable: true,
				value: function syntheticFullscreenSuccess(this: Element): Promise<void> {
					document.documentElement.dataset.fullscreenNativeBoundary = this.id || 'anonymous';
					return Promise.resolve();
				},
			});
		});
		let latestGeneration = 0;
		let stage = 'fresh document bootstrap';
		try {
			await fixturePage.reload({ waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(fixturePage.url());
			await fixturePage.bringToFront();
			stage = 'Popup Capture activation';
			await submitEffectiveVolume(tabId, 180);
			const captured = await waitForContentStatus(
				(status) => status.mode === 'capture'
					&& status.phase === 'active'
					&& status.config?.volume === 180,
				15_000,
			);
			latestGeneration = captured.generation ?? 0;

			stage = 'native fullscreen request';
			const fullscreenClient = await fixturePage.createCDPSession();
			try {
				const evaluation = await fullscreenClient.send('Runtime.evaluate', {
					expression: `(() => {
						const video = document.querySelector('#v');
						if (!video) throw new Error('Fullscreen fixture video is missing');
						document.documentElement.dataset.fullscreenHandoffResult = 'pending';
						void video.requestFullscreen().then(
							() => { document.documentElement.dataset.fullscreenHandoffResult = 'success'; },
							(error) => {
								document.documentElement.dataset.fullscreenHandoffResult = 'error:' + String(error);
							},
						);
					})()`,
					awaitPromise: false,
					returnByValue: true,
					userGesture: true,
				});
				if (evaluation.exceptionDetails) {
					throw new Error(evaluation.exceptionDetails.exception?.description
						?? evaluation.exceptionDetails.text);
				}
			} finally {
				await fullscreenClient.detach().catch(() => undefined);
			}
			const fullscreenResult = await eventually(
				() => fixturePage.evaluate(() => ({
					result: document.documentElement.dataset.fullscreenHandoffResult ?? 'missing',
					nativeBoundary: document.documentElement.dataset.fullscreenNativeBoundary ?? null,
				})),
				(value) => value.result !== 'pending',
				'native fullscreen completion',
				10_000,
			);
			expect(fullscreenResult).toEqual({ result: 'success', nativeBoundary: 'v' });

			stage = 'Capture continuation resume';
			const resumed = await waitForContentStatus(
				(status) => status.mode === 'capture'
					&& status.phase === 'active'
					&& (status.generation ?? 0) > latestGeneration,
				15_000,
			);
			latestGeneration = resumed.generation ?? latestGeneration;
			expect((await readOffscreenSnapshot()).audioTabs).toEqual(expect.arrayContaining([
				expect.objectContaining({ tabId, generation: latestGeneration }),
			]));
		} catch (error) {
			throw new Error(`Fullscreen Capture smoke failed during ${stage}`, { cause: error });
		} finally {
			await withDiagnosticTimeout('leave fullscreen during handoff cleanup', () => fixturePage.evaluate(async () => {
				delete document.documentElement.dataset.fullscreenHandoffResult;
				if (document.fullscreenElement) await document.exitFullscreen();
			}), 3_000).catch(() => undefined);
			await withDiagnosticTimeout(
				'restore native volume during handoff cleanup',
				() => submitEffectiveVolume(tabId, 100),
				8_000,
			).catch(() => undefined);
			await withDiagnosticTimeout(
				'restore runtime during handoff cleanup',
				() => configureRuntime(fixturePage.url(), DEFAULT_AUDIO_CONFIG),
				5_000,
			).catch(() => undefined);
			await fixturePage.removeScriptToEvaluateOnNewDocument(fullscreenStub.identifier)
				.catch(() => undefined);
			await withDiagnosticTimeout(
				'reload native fullscreen boundary after handoff cleanup',
				() => fixturePage.reload({ waitUntil: 'domcontentloaded' }),
				8_000,
			).catch(() => undefined);
			await extensionClient.close().catch(() => undefined);
		}
	}, 60_000);

	test('prefers an acknowledged page-native volume above 100 and captures only past the site limit', async () => {
		// The preceding fullscreen fixture ends with a real reload. Own the new
		// document READY boundary before installing its page controller; under a
		// slow production bundle, DOMContentLoaded alone can precede bootstrap
		// HELLO and would let this test exercise the DOM fallback instead.
		await waitForContentBootstrapStatus(fixturePage.url());
		await installPageMediaControllerHarness();
		await installSyntheticCaptureHarness();
		await installTabCaptureStreamIdStub();
		const extensionClient = await openExtensionClient();
		const visualizerSettings = await patchExtensionSettings(extensionClient, {
			scope: 'global',
			changes: { visualizerEnabled: false },
		});
		await fixturePage.bringToFront();
		const tabId = await getTabId(fixturePage.url());
		const previousScaleHints = await extensionClient.evaluate(async () => (
			(await chrome.storage.local.get('siteVolumeScales')).siteVolumeScales ?? null
		));
		try {
			await submitEffectiveVolume(tabId, 80);
			expect(await readPageMediaControllerHarness()).toMatchObject({
				volumeBase: 80,
				domMuted: false,
			});
			// Reproduce a late player mount: a shared hostname hint can still be
			// negative even though this exact player has acknowledged a native write.
			await extensionClient.evaluate(async (hostname) => {
				const stored = await chrome.storage.local.get('siteVolumeScales');
				await chrome.storage.local.set({ siteVolumeScales: {
					...stored.siteVolumeScales,
					[hostname]: { supported: false, updatedAt: Date.now() },
				} });
			}, new URL(fixturePage.url()).hostname);
			const captureCallsBeforeNativeAmplification = (await readSyntheticCaptureState()).calls;
			await submitEffectiveVolume(tabId, 130);
			const native130 = await waitForContentStatus(
				(status) => status.config?.volume === 130
					&& status.config.volumeBase === 130
					&& status.config.boost === 1
					&& status.phase === 'idle'
					&& status.actualMode === 'bypass',
				15_000,
			);
			expect(native130).toMatchObject({
				phase: 'idle',
				actualMode: 'bypass',
				config: { volume: 130, volumeBase: 130, boost: 1 },
			});
			expect((await readSyntheticCaptureState()).calls).toBe(captureCallsBeforeNativeAmplification);
			expect((await readOffscreenSnapshot()).audioTabs.some((entry) => entry.tabId === tabId)).toBe(false);
			expect(await readPageMediaControllerHarness()).toMatchObject({
				volumeBase: 130,
				domVolume: 0.79703,
			});
			const native130Presentation = await readPopupVolumePresentation('#2563eb', '130');
			expect(native130Presentation).toMatchObject({
				sliderCount: 1,
				min: '0',
				max: '800',
				value: '130',
				fillColor: 'rgb(37, 99, 235)',
				valueColor: 'rgb(37, 99, 235)',
				sliderAccent: '#2563eb',
			});
			expect(await readBadgeColor(tabId)).toEqual([37, 99, 235, 255]);

			const captureCycles = [
				{ exitVolume: 80, domVolume: 0.49048 },
				{ exitVolume: 0, domVolume: 0 },
				{ exitVolume: 100, domVolume: 0.6131 },
			] as const;
			for (const [cycle, { exitVolume, domVolume }] of captureCycles.entries()) {
				await submitEffectiveVolume(tabId, 350);
				const captured = await waitForContentStatus(
					(status) => status.mode === 'capture' && status.phase === 'active'
						&& status.config?.volume === 350
						&& status.config.volumeBase === 100
						&& status.config.boost === 3.5,
					15_000,
				);
				expect(captured).toMatchObject({
					mode: 'capture',
					actualMode: 'capture',
					phase: 'active',
					config: { volume: 350, volumeBase: 100, boost: 3.5 },
				});
				expect(await readPageMediaControllerHarness()).toMatchObject({ volumeBase: 100 });
				expect(await readCurrentAudioSession(tabId)).toMatchObject({
					ok: true,
					data: { actualMode: 'capture', phase: 'active' },
				});
				const cycleSnapshot = await eventually(
					readOffscreenSnapshot,
					(snapshot) => snapshot.audioTabs.some((entry) => entry.tabId === tabId),
					'offscreen host acknowledges cycle capture tab',
					10_000,
				);
				expect(cycleSnapshot.audioTabs).toEqual(
					expect.arrayContaining([expect.objectContaining({ tabId })]),
				);
				const capturePresentation = await readPopupVolumePresentation('#7c3aed', '350');
				expect(capturePresentation).toMatchObject({
					sliderCount: 1,
					min: '0',
					max: '800',
					value: '350',
					fillColor: 'rgb(124, 58, 237)',
					valueColor: 'rgb(124, 58, 237)',
					sliderAccent: '#7c3aed',
				});
				expect(await readBadgeColor(tabId)).toEqual([124, 58, 237, 255]);

				await submitEffectiveVolume(tabId, exitVolume);
				const released = await waitForContentStatus(
					(status) => status.mode === 'bypass' && status.actualMode === 'bypass'
						&& status.phase === 'idle'
						&& status.config?.volume === exitVolume
						&& status.config.volumeBase === exitVolume
						&& status.config.boost === 1,
					15_000,
				);
				expect(released).toMatchObject({
					mode: 'bypass',
					actualMode: 'bypass',
					phase: 'idle',
					config: { volume: exitVolume, volumeBase: exitVolume, boost: 1 },
				});
				expect(await readPageMediaControllerHarness()).toMatchObject({
					volumeBase: exitVolume,
					domVolume,
				});
				expect(await readCurrentAudioSession(tabId)).toMatchObject({
					ok: true,
					data: { actualMode: 'bypass', phase: 'idle' },
				});
				await eventually(
					() => readOffscreenSnapshot(),
					(snapshot) => !snapshot.audioTabs.some((entry) => entry.tabId === tabId),
					`Capture graph retired after cycle ${cycle + 1}`,
				);
				const releasedSnapshot = await extensionClient.evaluate(async (targetTabId) => chrome.runtime.sendMessage({
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					tabId: targetTabId,
					type: 'spectra.control.snapshot.get',
					payload: { tabId: targetTabId },
				}), tabId);
				expect(releasedSnapshot).toMatchObject({
					ok: true,
					data: { fields: { volumeBase: { actual: exitVolume, strategy: 'page-native' } } },
				});
			}

			const native100Presentation = await readPopupVolumePresentation('#2563eb', '100');
			expect(native100Presentation).toMatchObject({
				value: '100',
				fillColor: 'rgb(37, 99, 235)',
				valueColor: 'rgb(37, 99, 235)',
				sliderAccent: '#2563eb',
			});
			await fixturePage.bringToFront();
			// Create the feedback surface at that acknowledged native baseline,
			// then let physical shortcuts cross 100 without acquiring Capture.
			await tapDefaultShortcut(fixturePage, 'ArrowDown');
			await waitForContentStatus(
				(status) => status.mode === 'bypass' && status.phase === 'idle'
					&& status.config?.volume === 90,
				15_000,
			);
			await pressDefaultHotkeyFromContent(tabId, 'volume_up');
			await waitForContentStatus(
				(status) => status.mode === 'bypass' && status.phase === 'idle'
					&& status.config?.volume === 100,
				15_000,
			);
			await startOsdFeedbackProbe(fixturePage, '%', true);
			const captureCallsBeforeShortcut = (await readSyntheticCaptureState()).calls;
			await pressDefaultHotkeyFromContent(tabId, 'volume_up');
			await waitForContentStatus(
				(status) => status.mode === 'bypass' && status.phase === 'idle'
					&& status.config?.volume === 110
					&& status.config.volumeBase === 110
					&& status.config.boost === 1,
				15_000,
			);
			expect((await readSyntheticCaptureState()).calls).toBe(captureCallsBeforeShortcut);
			const native110Presentation = await readPopupVolumePresentation('#2563eb', '110');
			expect(native110Presentation).toMatchObject({
				value: '110',
				fillColor: 'rgb(37, 99, 235)',
				valueColor: 'rgb(37, 99, 235)',
				sliderAccent: '#2563eb',
			});

			await tapDefaultShortcut(fixturePage, 'ArrowDown');
			await waitForContentStatus(
				(status) => status.mode === 'bypass' && status.phase === 'idle'
					&& status.config?.volume === 100,
				15_000,
			);
			await eventually(
				() => readOsdFeedback(fixturePage, 'volume'),
				(feedback) => feedback.label === '100%'
					&& feedback.color === native100Presentation.fillColor,
				'acknowledged native OSD after the reverse boundary',
			);
			const boundaryFrames = (await readOsdFeedback(fixturePage, 'volume', true)).frames;
			const compactPairs = boundaryFrames
				.map(({ label, color }) => `${label}|${color}`)
				.filter((pair, index, pairs) => index === 0 || pair !== pairs[index - 1]);
			expect(compactPairs).toEqual([
				`100%|${native100Presentation.fillColor}`,
				`110%|${native110Presentation.fillColor}`,
				`100%|${native100Presentation.fillColor}`,
			]);
		} finally {
			await readOsdFeedback(fixturePage, 'volume', true).catch(() => undefined);
			await releaseSyntheticCapture();
			const status = await readContentStatus().catch(() => ({ generation: 0 } as ContentStatus));
			await sendCaptureRequest(
				extensionClient,
				tabId,
				false,
				(status.generation ?? 0) + 1,
				DEFAULT_AUDIO_CONFIG,
			).catch(() => undefined);
			await submitEffectiveVolume(tabId, 100).catch(() => undefined);
			await configureRuntime(fixturePage.url(), DEFAULT_AUDIO_CONFIG).catch(() => undefined);
			await removePageMediaControllerHarness();
			await patchExtensionSettings(extensionClient, {
				scope: 'global',
				changes: {
					visualizerEnabled: visualizerSettings.previous.globalSettings.visualizerEnabled,
				},
			}).catch(() => undefined);
			await extensionClient.evaluate(async (previous) => {
				if (previous === null) await chrome.storage.local.remove('siteVolumeScales');
				else await chrome.storage.local.set({ siteVolumeScales: previous });
			}, previousScaleHints);
			await extensionClient.close();
		}
	}, 60_000);

	test('restores active capture across worker restart and shares one host with authenticated remote', async () => {
		await installSyntheticCaptureHarness();
		await installTabCaptureStreamIdStub();
		// A status reader must not create another Popup's observation/visualizer leases.
		const extensionClient = await openExtensionClient('options.html');
		const secondary = await browser.newPage();
		const tabId = await getTabId(fixturePage.url());
		const secondaryUrl = `${fixtureUrl}?remote-secondary=1`;
		let session: RemotePublicSession | null = null;
		try {
			await configureRuntime(fixturePage.url(), DEFAULT_AUDIO_CONFIG);
			await waitForContentStatus((status) => status.mode === 'bypass' && status.phase === 'idle');
			await secondary.goto(secondaryUrl, { waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(secondaryUrl);

			await fixturePage.reload({ waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(fixturePage.url());
			await fixturePage.bringToFront();
			await submitEffectiveVolume(tabId, 130);
			const started = await waitForContentStatus(
				(status) => status.config?.volume === 130
					&& status.config?.boost === 1.3
					&& status.mode === 'capture'
					&& status.phase === 'active',
				15_000,
			);
			// The initiating Action Popup has closed, but its last asynchronous
			// projection can still be settling. Sample the current owners together;
			// never freeze a transient session generation and wait for time to reverse.
			const capture = await eventually(async () => {
				const audio = await readCurrentAudioSession(tabId);
				const content = await readContentStatus();
				const processor = (await readOffscreenSnapshot()).audioTabs.find((entry) => entry.tabId === tabId);
				return { audio, content, processor };
			}, ({ audio, content, processor }) => audio.ok
				&& typeof audio.data?.generation === 'number'
				&& audio.data.actualMode === 'capture' && audio.data.phase === 'active'
				&& content.generation === audio.data.generation
				&& processor?.generation === audio.data.generation
				&& content.actualMode === 'capture' && content.phase === 'active'
				&& content.config?.volume === 130 && content.config.boost === 1.3,
			'current content, session and physical capture generation convergence', 10_000);
			const captureGeneration = requireValue(capture.audio.data?.generation, 'Missing Capture generation');
			expect(captureGeneration).toBeGreaterThanOrEqual(started.generation ?? 0);
			const physicalBeforeRestart = await readSyntheticCaptureState();
			await restartServiceWorker();

			const recovered = await readCurrentAudioSession(tabId);
			expect(recovered).toMatchObject({
				ok: true,
				data: { generation: captureGeneration, phase: 'active', actualMode: 'capture' },
			});
			expect(await getOffscreenContextCount()).toBe(1);
			expect((await readOffscreenSnapshot()).audioTabs).toEqual(expect.arrayContaining([
				expect.objectContaining({ tabId, generation: captureGeneration }),
			]));
			expect((await readSyntheticCaptureState()).calls).toBe(physicalBeforeRestart.calls);
			expect((await readSyntheticCaptureState()).processorStates).toEqual(physicalBeforeRestart.processorStates);
			// The Chrome integration owns extension-side offscreen/background/content
			// recovery, authentication and command routing. PeerJS signaling availability
			// is an external transport fact and must not make this product proof depend
			// on the public 0.peerjs.com service.
			await installOffscreenPeerRuntimeProbe(true);

			const creation = await sendFromActionPopup<{
				ok: boolean;
				data?: RemotePublicSession;
				error?: { message?: string };
			}>({
				protocolVersion: 2,
				tabId,
				type: 'spectra.remote.session.create',
				payload: { tabId },
			});
			if (!creation?.ok) {
				throw new Error(creation?.error?.message ?? 'PeerJS remote session creation failed');
			}
			session = creation.data as RemotePublicSession;
			const sharedHost = await readOffscreenSnapshot();
			expect(await getOffscreenContextCount()).toBe(1);
			expect(sharedHost.audioTabs).toEqual(expect.arrayContaining([
				expect.objectContaining({ tabId, generation: captureGeneration }),
			]));
			expect(sharedHost.remoteTabs).toContainEqual({ tabId, sessionId: session.sessionId });

			const wrongConnection = await openOffscreenTestRemote(session);
			const wrongMessages = await eventually(
				() => readOffscreenTestRemoteMessages(wrongConnection),
				(messages) => messages.some((message) => message.type === 'spectra.remote.challenge'),
				'wrong-secret challenge',
			);
			const wrongChallenge = wrongMessages.find(
				(message) => message.type === 'spectra.remote.challenge',
			);
			await deliverOffscreenTestRemote(wrongConnection, {
				type: 'spectra.remote.authenticate',
				protocolVersion: 3,
				sessionId: session.sessionId,
				proof: 'A'.repeat(43),
			});
			expect(wrongChallenge).toMatchObject({
				type: 'spectra.remote.challenge',
				sessionId: session.sessionId,
			});
			const rejectedMessages = await eventually(
				() => readOffscreenTestRemoteMessages(wrongConnection),
				(messages) => messages.some((message) => (
					message.type === 'spectra.remote.auth-result' && message.ok === false
				)),
				'wrong-secret remote authentication rejection',
			);
			const rejected = rejectedMessages.find((message) => (
				message.type === 'spectra.remote.auth-result' && message.ok === false
			));
			expect(rejected).toMatchObject({ error: 'AUTH_FAILED' });
			expect((await readContentStatus()).config?.volume).toBe(130);

			const authenticatedConnection = await openOffscreenTestRemote(session);
			const challengeMessages = await eventually(
				() => readOffscreenTestRemoteMessages(authenticatedConnection),
				(messages) => messages.some((message) => message.type === 'spectra.remote.challenge'),
				'authenticated remote challenge',
			);
			const challenge = challengeMessages.find(
				(message) => message.type === 'spectra.remote.challenge',
			);
			if (typeof challenge.nonce !== 'string') throw new Error('Remote challenge nonce is missing');
			const proof = await createRemoteProof(session.secret, session.sessionId, challenge.nonce);
			await deliverOffscreenTestRemote(authenticatedConnection, {
				type: 'spectra.remote.authenticate',
				protocolVersion: 3,
				sessionId: session.sessionId,
				proof,
			});
			const authenticatedMessages = await eventually(
				() => readOffscreenTestRemoteMessages(authenticatedConnection),
				(messages) => (
					messages.some((message) => message.type === 'spectra.remote.auth-result' && message.ok === true)
					&& messages.some((message) => message.type === 'spectra.remote.state')
						? messages
						: undefined
				),
				'authenticated remote state',
			);
			const initialRemoteState = authenticatedMessages.findLast(
				(message) => message.type === 'spectra.remote.state',
			);
			expect(initialRemoteState).toMatchObject({
				volume: 130,
				volumeBase: 100,
				boost: 1.3,
				actualMode: 'capture',
				phase: 'active',
				tabTitle: 'SPECTRA extension smoke fixture',
			});
			const messageCountBeforeRestart = authenticatedMessages.length;
			expect((await readOffscreenSnapshot()).remoteTabs).toContainEqual({ tabId, sessionId: session.sessionId });

			// The offscreen host survives the worker. Its recovered generation must
			// authorize the first post-restart command instead of forcing a sync-only drop.
			await withDiagnosticTimeout(
				'restart service worker with an authenticated remote session',
				restartServiceWorker,
				45_000,
			);
			await withDiagnosticTimeout(
				'read recovered remote generation after worker restart',
				async () => {
					await eventually(
						() => readOffscreenTestRemoteMessages(authenticatedConnection),
						(messages) => messages.slice(messageCountBeforeRestart).findLast((message) => (
							message.type === 'spectra.remote.state'
							&& typeof message.generation === 'number'
							&& message.actualMode === 'capture'
							&& message.phase === 'active'
						)),
						'recovered remote state',
					);
				},
				5_000,
			);
			const recoveredMessages = await readOffscreenTestRemoteMessages(authenticatedConnection);
			const recoveredRemoteState = recoveredMessages.slice(messageCountBeforeRestart).findLast(
				(message) => message.type === 'spectra.remote.state'
					&& typeof message.generation === 'number'
					&& message.actualMode === 'capture'
					&& message.phase === 'active',
			);
			if (typeof recoveredRemoteState?.generation !== 'number') {
				throw new Error('Recovered remote state generation is missing');
			}
			expect(recoveredRemoteState).toMatchObject({
				volume: 130,
				volumeBase: 100,
				boost: 1.3,
			});
			expect(await readContentStatus()).toMatchObject({
				mode: 'capture',
				phase: 'active',
				config: { volume: 130, volumeBase: 100, boost: 1.3 },
			});
			await deliverOffscreenTestRemote(authenticatedConnection, {
				type: 'spectra.remote.command',
				protocolVersion: 3,
				sessionId: session.sessionId,
				sessionEpoch: 1,
				commandId: 'E'.repeat(22),
				sequence: 1,
				generation: recoveredRemoteState.generation,
				command: 'volume_up',
			});
			try {
				await eventually(
					() => readContentStatus(),
					(status) => status.config?.volume === 140 && status.config?.boost === 1.4,
					'first remote command after service-worker recovery',
					10_000,
				);
			} catch (error) {
				const [hostStatus, hostSnapshot, audioSession, controlSnapshot, remoteMessages] = await Promise.all([
					evaluateServiceWorker(async (targetTabId) => chrome.runtime.sendMessage({
						target: 'offscreen',
						type: 'REMOTE_HOST_GET_STATUS',
						tabId: targetTabId,
					}), tabId).catch(() => null),
					readOffscreenSnapshot().catch(() => null),
					readCurrentAudioSession(tabId).catch(() => null),
					extensionClient.evaluate(async (targetTabId) => chrome.runtime.sendMessage({
						protocolVersion: 2,
						requestId: crypto.randomUUID(),
						tabId: targetTabId,
						type: 'spectra.control.snapshot.get',
						payload: { tabId: targetTabId },
					}), tabId).catch(() => null),
					readOffscreenTestRemoteMessages(authenticatedConnection).catch(() => null),
				]);
				throw new Error(
					`First remote command was not applied after worker recovery: ${JSON.stringify({
						hostStatus,
						hostSnapshot,
						audioSession,
						controlSnapshot,
						remoteMessages,
					})}`,
					{ cause: error },
				);
			}
			const secondaryTabId = await getTabId(secondaryUrl);
			const secondarySnapshot = await extensionClient.evaluate(async (targetTabId) => chrome.runtime.sendMessage({
				protocolVersion: 2,
				requestId: crypto.randomUUID(),
				tabId: targetTabId,
				type: 'spectra.control.snapshot.get',
				payload: { tabId: targetTabId },
			}), secondaryTabId);
			expect(secondarySnapshot).toMatchObject({
				ok: true,
				data: {
					fields: {
						volumeBase: { actual: 100 },
					},
				},
			});
			// Reset through the user-control owner, not only its Content projection.
			// Otherwise opening the next Popup can legitimately reapply the retained
			// remote boost and turn a low-level stop assertion into a timing race.
			expect(await sendFromActionPopup({
				protocolVersion: 2,
				tabId,
				type: 'spectra.control.operation.submit',
				payload: { tabId, source: 'popup', target: null, operation: 'audio-reset', payload: {} },
			})).toMatchObject({ ok: true, data: { result: { reset: true } } });
			const resetStatus = await waitForContentStatus(
				(status) => status.actualMode === 'bypass'
					&& status.phase === 'idle'
					&& status.config?.volume === 100
					&& status.config?.boost === 1,
			);

			const stopGeneration = Math.max(502, (resetStatus.generation ?? 501) + 1);
			const stopped = await sendCaptureRequest(extensionClient, tabId, false, stopGeneration);
			expect(stopped).toMatchObject({
				ok: true,
				data: { generation: stopGeneration, actualMode: 'bypass', phase: 'idle', active: false },
			});
			expect(await readCurrentAudioSession(tabId)).toMatchObject({
				ok: true,
				data: { generation: stopGeneration, actualMode: 'bypass', phase: 'idle' },
			});
			await configureRuntime(fixturePage.url(), DEFAULT_AUDIO_CONFIG);
			await configureRuntime(secondaryUrl, DEFAULT_AUDIO_CONFIG);
			expect((await readContentStatus(secondaryUrl)).config?.volume).toBe(100);

			const closed = await sendFromActionPopup({
				protocolVersion: 2,
				tabId,
				type: 'spectra.remote.session.close',
				payload: { tabId, sessionId: session.sessionId },
			});
			expect(closed).toEqual({ ok: true, data: { closed: true } });
			session = null;
			await eventually(
				readOffscreenSnapshot,
				(snapshot) => snapshot.remoteTabs.length === 0 && snapshot.audioTabs.length === 0,
				'remote and capture lease cleanup',
			);
			await configureRuntime(fixturePage.url(), DEFAULT_AUDIO_CONFIG);
		} finally {
			if (session) {
				await sendFromActionPopup({
					protocolVersion: 2,
					tabId,
					type: 'spectra.remote.session.close',
					payload: { tabId, sessionId: session.sessionId },
				}).catch(() => undefined);
			}
			await sendCaptureRequest(extensionClient, tabId, false, 599).catch(() => undefined);
			await configureRuntime(fixturePage.url(), DEFAULT_AUDIO_CONFIG).catch(() => undefined);
			await restoreOffscreenPeerRuntimeProbe().catch(() => undefined);
			await Promise.all([extensionClient.close(), secondary.close()]);
		}
	}, 120_000);

	test('cleans active capture on immediate navigation and close after worker restart', async () => {
		await installSyntheticCaptureHarness();
		await installTabCaptureStreamIdStub();
		const navigating = await browser.newPage();
		const closing = await browser.newPage();
		const navigatingUrl = `${fixtureUrl}?restart-navigation=1`;
		const closingUrl = `${fixtureUrl}?restart-close=1`;
		try {
			await Promise.all([
				navigating.goto(navigatingUrl, { waitUntil: 'domcontentloaded' }),
				closing.goto(closingUrl, { waitUntil: 'domcontentloaded' }),
			]);
			await Promise.all([
				waitForContentBootstrapStatus(navigatingUrl),
				waitForContentBootstrapStatus(closingUrl),
			]);
			const [navigatingTabId, closingTabId] = await Promise.all([
				getTabId(navigatingUrl),
				getTabId(closingUrl),
			]);
			await navigating.bringToFront();
			await submitEffectiveVolume(navigatingTabId, 130);
			const navigatingStarted = await eventually(
				() => readContentStatus(navigatingUrl),
				(status) => status.actualMode === 'capture'
					&& status.phase === 'active'
					&& status.config?.volume === 130,
				15_000,
			);
			await closing.bringToFront();
			await submitEffectiveVolume(closingTabId, 130);
			const closingStarted = await eventually(
				() => readContentStatus(closingUrl),
				(status) => status.actualMode === 'capture'
					&& status.phase === 'active'
					&& status.config?.volume === 130,
				15_000,
			);
			expect([navigatingStarted, closingStarted]).toEqual([
				expect.objectContaining({
					phase: 'active',
					actualMode: 'capture',
					config: expect.objectContaining({ volume: 130 }),
				}),
				expect.objectContaining({
					phase: 'active',
					actualMode: 'capture',
					config: expect.objectContaining({ volume: 130 }),
				}),
			]);

			await restartServiceWorker();
			await Promise.all([
				navigating.goto(`http://localhost:${server.port}/smoke-test.html?after-restart=1`, {
					waitUntil: 'domcontentloaded',
				}),
				closing.close(),
			]);
			await eventually(
				readOffscreenSnapshot,
				(snapshot) => !snapshot.audioTabs.some(
					(audio) => audio.tabId === navigatingTabId || audio.tabId === closingTabId,
				),
				'navigation and tab-close capture cleanup',
				15_000,
			);
			expect(await getOffscreenContextCount()).toBe(1);
		} finally {
			await navigating.close().catch(() => undefined);
			await closing.close().catch(() => undefined);
		}
	}, 60_000);
});

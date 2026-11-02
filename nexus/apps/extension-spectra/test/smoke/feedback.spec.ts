import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { launchPuppeteerBrowser } from '../../../../scripts/browser-driver';
import type { Page } from 'puppeteer';
import { SPECTRA_CONTENT_RUNTIME_REVISION } from '@nexus/contracts';
import { requireValue } from '../helpers/require-value';
import { DEFAULT_AUDIO_CONFIG, acquireSmokeRuntime, browser, collectPageErrors, configureRuntime, evaluateServiceWorker, eventually, fixturePage, fixtureUrl, getTabId, holdDefaultShortcut, inspectContentRuntime, openExtensionClient, readContentBootstrapStatus, readOsdFeedback, reinjectContent, releaseSmokeRuntime, sendFromActionPopup, setGlobalLanguage, setHotkeyTarget, startOsdFeedbackProbe, submitEffectiveVolume, submitPopupControlIntent, tapDefaultShortcut, waitForContentBootstrapStatus, withDiagnosticTimeout } from './harness';
import type { OsdFeedbackSnapshot, SmokeRuntimeLease } from './harness';
import { prepareSmokeSession, startSmokeSession, teardownSmokeSession } from './harness';

describe('SPECTRA built extension smoke: feedback', () => {
	beforeAll(async () => {
		const options = await prepareSmokeSession();
		const launched = await launchPuppeteerBrowser(options, {
			owner: 'apps/extension-spectra/test/smoke/feedback.spec.ts',
			profile: { kind: 'temporary', prefix: 'spectra-smoke-', isolated: true },
		});
		await startSmokeSession(launched);
	}, 60_000);

	afterAll(async () => {
		await teardownSmokeSession();
	});

	test('renders localized volume and speed feedback in the browser top layer', async () => {
		const targetUrl = fixturePage.url();
		const extensionClient = await openExtensionClient('options.html');
		const tabId = await getTabId(targetUrl);
		let shortcutTargetPage: Page | null = null;
		const originalLanguage = await withDiagnosticTimeout(
			'select zh-CN for the OSD smoke test',
			() => setGlobalLanguage(extensionClient, 'zh-CN'),
			5_000,
		);

		try {
			await configureRuntime(targetUrl, {
				...DEFAULT_AUDIO_CONFIG,
				muted: false,
			});
			await fixturePage.bringToFront();
			await tapDefaultShortcut(fixturePage, 'KeyM');
			await fixturePage.waitForFunction(() => (
				document.querySelector<HTMLMediaElement>('video,audio')?.muted === true
				&& document.querySelector<HTMLElement>('#spectra-osd-host')
					?.shadowRoot?.getElementById('t')?.textContent === '静音'
			), { timeout: 5_000 });
			await tapDefaultShortcut(fixturePage, 'KeyM');
			await fixturePage.waitForFunction(() => (
				document.querySelector<HTMLMediaElement>('video,audio')?.muted === false
			), { timeout: 5_000 });
			const nativeBaseline = await submitPopupControlIntent(tabId, {
				mutations: [
					{ field: 'speed', operation: 'set', value: 1 },
				],
			});
			if (!nativeBaseline?.ok
				|| nativeBaseline.data.fields.speed?.actual !== 1) {
				throw new Error(nativeBaseline?.error?.message ?? 'Unable to establish the native speed baseline');
			}
			const speedShortcutUrl = fixturePage.url();
			await tapDefaultShortcut(fixturePage, 'ArrowLeft');
			await withDiagnosticTimeout('observe the acknowledged 0.9x top-layer OSD', () => (
				fixturePage.waitForFunction(() => {
					const media = document.querySelector<HTMLMediaElement>('video,audio');
					const host = document.querySelector<HTMLElement>('#spectra-osd-host');
					return media?.playbackRate === 0.9
						&& host?.matches(':popover-open') === true
						&& host.shadowRoot?.getElementById('t')?.textContent === '0.9×';
				}, { timeout: 5_000 })
			), 6_000);
			expect(await fixturePage.evaluate(() => {
				const host = document.querySelector<HTMLElement>('#spectra-osd-host');
				if (!host?.matches(':popover-open')) return false;
				host.hidePopover();
				document.dispatchEvent(new Event('fullscreenchange'));
				return host.matches(':popover-open');
			})).toBe(true);
			expect(fixturePage.url()).toBe(speedShortcutUrl);
			await startOsdFeedbackProbe(fixturePage, '×', true);
			await tapDefaultShortcut(fixturePage, 'ArrowRight');
			await withDiagnosticTimeout('observe the acknowledged 1.0x OSD', () => (
				fixturePage.waitForFunction(() => (
					document.querySelector<HTMLMediaElement>('video,audio')?.playbackRate === 1
					&& document.querySelector<HTMLElement>('#spectra-osd-host')
						?.shadowRoot?.getElementById('t')?.textContent === '1.0×'
				), { timeout: 5_000 })
			), 6_000);
			const speedLabels = [
				...new Set((await readOsdFeedback(fixturePage, 'speed', true)).frames.map(({ label }) => label)),
			];
			expect(speedLabels).toContain('0.9×');
			expect(speedLabels).toContain('1.0×');
			expect(speedLabels.every((label) => label === '0.9×' || label === '1.0×')).toBe(true);
			expect(fixturePage.url()).toBe(speedShortcutUrl);
			const speedMarkers = await fixturePage.evaluate(() => {
				const host = document.querySelector<HTMLElement>('#spectra-osd-host');
				const markers = [...host?.shadowRoot?.querySelectorAll<HTMLElement>('#marks .mk') ?? []];
				return markers.map((marker) => ({
					label: marker.dataset.label,
					lane: marker.classList.contains('upper') ? 'upper' : 'lower',
					left: Number.parseFloat(marker.style.left),
				}));
			});
			expect(speedMarkers.map(({ label, lane }) => ({ label, lane }))).toEqual([
				{ label: '1×', lane: 'lower' },
				{ label: '2×', lane: 'upper' },
			]);
			expect(speedMarkers[0]?.left).toBeCloseTo((1 - 0.1) / (16 - 0.1) * 100, 4);
			expect(speedMarkers[1]?.left).toBeCloseTo((2 - 0.1) / (16 - 0.1) * 100, 4);

			const shortcutTargetUrl = `${fixtureUrl}?shortcut-speed-target=1`;
			shortcutTargetPage = await browser.newPage();
			await shortcutTargetPage.goto(shortcutTargetUrl, { waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(shortcutTargetUrl);
			const shortcutTargetTabId = await getTabId(shortcutTargetUrl);
			const targetBaseline = await submitPopupControlIntent(shortcutTargetTabId, {
				mutations: [{ field: 'speed', operation: 'set', value: 1 }],
			});
			if (!targetBaseline.ok || targetBaseline.data.fields.speed?.actual !== 1) {
				throw new Error(targetBaseline.error?.message ?? 'Unable to initialize shortcut target speed');
			}
			await setHotkeyTarget(extensionClient, shortcutTargetTabId);
			await fixturePage.bringToFront();
			await tapDefaultShortcut(fixturePage, 'ArrowRight');
			const activeShortcutTargetPage = requireValue(
				shortcutTargetPage,
				'Expected the selected shortcut target page to be initialized',
			);
			await withDiagnosticTimeout(
				'observe selected-target speed and foreground Toast',
				() => eventually(
					async () => {
						const [targetRate, foreground] = await Promise.all([
							activeShortcutTargetPage.evaluate(() => (
								document.querySelector<HTMLMediaElement>('video,audio')?.playbackRate ?? null
							)),
							fixturePage.evaluate(() => {
								const host = document.querySelector<HTMLElement>('#spectra-osd-host');
								return {
									rate: document.querySelector<HTMLMediaElement>('video,audio')?.playbackRate ?? null,
									open: host?.matches(':popover-open') === true,
									text: host?.shadowRoot?.getElementById('t')?.textContent ?? null,
									metaHidden: host?.shadowRoot?.getElementById('meta')?.hasAttribute('hidden') ?? null,
									meta: host?.shadowRoot?.getElementById('meta')?.textContent ?? null,
								};
							}),
						]);
						return { targetRate, foreground };
					},
					(state) => state.targetRate === 1.1
						&& state.foreground.rate === 1
						&& state.foreground.open
						&& state.foreground.text === '1.1×'
						&& state.foreground.metaHidden === false
						&& state.foreground.meta?.includes('127.0.0.1') === true,
					'selected-target speed and foreground Toast',
					5_000,
				),
				6_000,
			);
			expect(await shortcutTargetPage.evaluate(() => (
				document.querySelector<HTMLMediaElement>('video,audio')?.playbackRate
			))).toBe(1.1);
			await setHotkeyTarget(extensionClient, null);
			await shortcutTargetPage.close();
			shortcutTargetPage = null;
			await fixturePage.bringToFront();
			await startOsdFeedbackProbe(fixturePage, '×');
			let speedBeforeRelease: OsdFeedbackSnapshot | null = null;
			await holdDefaultShortcut(fixturePage, 'ArrowRight', 11, 35, 35, async () => {
				speedBeforeRelease = await readOsdFeedback(fixturePage, 'speed');
			});
			const heldSpeedTarget = requireValue<OsdFeedbackSnapshot>(
				speedBeforeRelease, 'Expected held speed target before keyup',
			);
			const speedAtRelease = await readOsdFeedback(fixturePage, 'speed');
			await eventually(
				() => readOsdFeedback(fixturePage, 'speed'),
				(feedback) => feedback.actual !== null
					&& feedback.label === `${feedback.actual.toFixed(1)}×`,
				'released speed feedback matching physical playback rate',
			);
			await fixturePage.evaluate(() => new Promise<void>((resolveFrame) => {
				requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()));
			}));
			const heldSpeedFeedback = await readOsdFeedback(fixturePage, 'speed', true);
			expect(heldSpeedTarget).toMatchObject({
				visible: true,
				label: '2.2×',
				color: 'rgb(16, 185, 129)',
			});
			expect(heldSpeedFeedback).toMatchObject({
				visible: true,
				label: `${heldSpeedFeedback.actual.toFixed(1)}×`,
				tone: speedAtRelease.tone,
				color: speedAtRelease.color,
			});
			// Release retires unsent repeats. One final same-gesture ACK may correct
			// the requested number to the physical result without restarting motion.
			expect(heldSpeedFeedback.actual).toBeGreaterThanOrEqual(
				requireValue(speedAtRelease.actual, 'Expected physical playback rate at release'),
			);
			expect(heldSpeedFeedback.actual).toBeLessThanOrEqual(2.2);
			expect(heldSpeedFeedback.frames.length).toBeLessThanOrEqual(speedAtRelease.frames.length + 1);
			const heldSpeedLabels = [...new Set(
				heldSpeedTarget.frames.map(({ label }) => label),
			)];
			expect(heldSpeedLabels).toEqual([
				'1.1×', '1.2×', '1.3×', '1.4×', '1.5×', '1.6×',
				'1.7×', '1.8×', '1.9×', '2.0×', '2.1×', '2.2×',
			]);
			const heldSpeedWidths = heldSpeedTarget.frames.map(({ width }) => width);
			expect(heldSpeedWidths.every((width, index) => (
				index === 0 || width >= requireValue(
					heldSpeedWidths[index - 1],
					'Expected a previous held-speed frame width',
				) - 0.001
			))).toBe(true);
			expect(heldSpeedWidths.every((width, index) => (
				index === 0 || width - requireValue(
					heldSpeedWidths[index - 1],
					'Expected a previous held-speed frame width',
				) <= 0.65
			))).toBe(true);
			await withDiagnosticTimeout('wait for the released speed OSD display window', () => (
				fixturePage.waitForFunction(() => (
					document.querySelector<HTMLElement>('#spectra-osd-host')
						?.shadowRoot?.getElementById('o')?.classList.contains('v') === false
				), { timeout: 2_500 })
			), 3_000);
			await submitEffectiveVolume(tabId, 90);
			await withDiagnosticTimeout('observe the below-100 volume baseline', () => (
				fixturePage.waitForFunction(() => (
					Math.round((document.querySelector<HTMLMediaElement>('video,audio')?.volume ?? -1) * 100) === 90
				), { timeout: 5_000 })
			), 6_000);
			await startOsdFeedbackProbe(fixturePage, '%', true);
			// Release intentionally discards unstarted repeat pulses. A fixed count
			// of keydowns cannot prove how many writes finished on a busy host.
			// Hold until the real media reaches zero, then test the release boundary.
			await fixturePage.keyboard.down('Alt');
			await fixturePage.keyboard.down('ArrowDown');
			try {
				await eventually(async () => {
					const actual = await fixturePage.evaluate(() => (
						Math.round((document.querySelector<HTMLMediaElement>('video,audio')?.volume ?? -1) * 100)
					));
					if (actual === 0) return actual;
					await new Promise((resolveWait) => setTimeout(resolveWait, 55));
					await fixturePage.keyboard.down('ArrowDown');
					return actual;
				}, (actual) => actual === 0, 'held volume reaches acknowledged zero before release', 5_000);
			} finally {
				await fixturePage.keyboard.up('ArrowDown');
				await fixturePage.keyboard.up('Alt');
			}
			const volumeAtRelease = await readOsdFeedback(fixturePage, 'volume');
			expect(volumeAtRelease.actual).toBe(0);
			expect(volumeAtRelease).toMatchObject({
				muted: false,
				visible: true,
				label: '静音',
				color: 'rgb(156, 163, 175)',
			});
			await new Promise((resolveWait) => setTimeout(resolveWait, 50));
			const releasedState = await readOsdFeedback(fixturePage, 'volume', true);
			expect(releasedState).toEqual(volumeAtRelease);
			const scalarFrames = releasedState.frames;
			const scalarLabels = [...new Set(scalarFrames.map(({ label }) => label))];
			expect(scalarLabels).toEqual([
				'80%', '70%', '60%', '50%', '40%', '30%', '20%', '10%',
			]);
			const scalarWidths = scalarFrames.map(({ width }) => width);
			expect(scalarWidths.every((width, index) => (
				index === 0 || width <= requireValue(
					scalarWidths[index - 1],
					'Expected a previous scalar feedback frame width',
				) + 0.001
			))).toBe(true);
			expect(scalarWidths.every((width, index) => (
				index === 0 || requireValue(
					scalarWidths[index - 1],
					'Expected a previous scalar feedback frame width',
				) - width <= 1.3
			))).toBe(true);
			// MutationObserver callback batching is a browser scheduling detail. The
			// exact label sequence and monotonic widths above are the product contract;
			// duplicate callbacks for one rendered value are not additional evidence.
		} finally {
			await setHotkeyTarget(extensionClient, null).catch(() => undefined);
			await shortcutTargetPage?.close().catch(() => undefined);
			await setGlobalLanguage(extensionClient, originalLanguage);
			await submitEffectiveVolume(tabId, 100).catch(() => undefined);
			await extensionClient.close().catch(() => undefined);
		}
	}, 30_000);

	test('releases feedback hosts and fullscreen promotion across content reinjection', async () => {
		const targetUrl = fixturePage.url();
		const tabId = await getTabId(targetUrl);
		await configureRuntime(targetUrl, {
			...DEFAULT_AUDIO_CONFIG,
			eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
		});
		await fixturePage.bringToFront();

		const waitForReinjectedRuntime = async (cycle: number): Promise<void> => {
			await reinjectContent(tabId);
			await eventually(
				() => inspectContentRuntime(tabId),
				(probe) => probe.listenersReady,
				`feedback runtime reinjection ${cycle}`,
				10_000,
			);
		};
		const readHostCounts = () => fixturePage.evaluate(() => ({
			osd: document.querySelectorAll('#spectra-osd-host').length,
			toast: document.querySelectorAll('#spectra-toast-host').length,
		}));

		try {
			// Establish a clean generation before measuring repeated handoff.
			await waitForReinjectedRuntime(0);
			expect(await readHostCounts()).toEqual({ osd: 0, toast: 0 });

			for (let cycle = 1; cycle <= 3; cycle += 1) {
				await tapDefaultShortcut(fixturePage, 'ArrowRight');
				await fixturePage.waitForFunction(() => (
					document.querySelectorAll('#spectra-osd-host').length === 1
				), { timeout: 5_000 });
				expect(await readHostCounts()).toEqual({ osd: 1, toast: 0 });
				await waitForReinjectedRuntime(cycle);
				await new Promise((resolveWait) => setTimeout(resolveWait, 50));
				expect(await fixturePage.evaluate(() => {
					document.dispatchEvent(new Event('fullscreenchange'));
					return {
						osd: document.querySelectorAll('#spectra-osd-host').length,
						toast: document.querySelectorAll('#spectra-toast-host').length,
					};
				})).toEqual({ osd: 0, toast: 0 });
			}

			await tapDefaultShortcut(fixturePage, 'ArrowLeft');
			await fixturePage.waitForFunction(() => (
				document.querySelectorAll('#spectra-osd-host').length === 1
				&& document.querySelector<HTMLElement>('#spectra-osd-host')
					?.matches(':popover-open') === true
			), { timeout: 5_000 });
			expect(await fixturePage.evaluate(() => {
				const host = document.querySelector<HTMLElement>('#spectra-osd-host');
				if (!host?.matches(':popover-open')) return null;
				host.hidePopover();
				document.dispatchEvent(new Event('fullscreenchange'));
				return {
					count: document.querySelectorAll('#spectra-osd-host').length,
					open: host.matches(':popover-open'),
				};
			})).toEqual({ count: 1, open: true });
		} finally {
			await submitPopupControlIntent(tabId, {
				mutations: [{ field: 'speed', operation: 'set', value: 1 }],
			}).catch(() => undefined);
			await reinjectContent(tabId).catch(() => undefined);
		}
	}, 35_000);

	test('retires feedback on the final runtime lease and reacquires one new generation', async () => {
		const targetUrl = `${fixtureUrl}?final-runtime-lease=1`;
		const page = await browser.newPage();
		const pageErrors: string[] = [];
		collectPageErrors(page, pageErrors);
		let lease: SmokeRuntimeLease | null = null;
		let reacquiredLease: SmokeRuntimeLease | null = null;
		try {
			await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
			expect(await waitForContentBootstrapStatus(targetUrl)).toMatchObject({
				ready: false,
				runtimeRevision: null,
				ownedSources: [],
			});
			const tabId = await getTabId(targetUrl);
			const publishFeedback = (
				owned: SmokeRuntimeLease,
				feedback?: { kind: 'speed'; value: number },
			): Promise<void> => evaluateServiceWorker(async ({ runtime, actualFeedback }) => {
				await chrome.tabs.sendMessage(runtime.tabId, {
					protocolVersion: 2,
					type: 'spectra.hotkey.target.feedback',
					tabId: runtime.tabId,
					payload: {
						action: 'speed_up',
						targetTabId: runtime.tabId,
						targetTitle: 'Final runtime lease',
						targetHostname: '127.0.0.1',
						...(actualFeedback ? { feedback: actualFeedback } : {}),
					},
				}, { documentId: runtime.documentId });
			}, { runtime: owned, actualFeedback: feedback });
			lease = await acquireSmokeRuntime(targetUrl, 'final-feedback-generation');
			await eventually(
				() => readContentBootstrapStatus(targetUrl),
				(status) => status.ready
					&& status.runtimeRevision === SPECTRA_CONTENT_RUNTIME_REVISION,
				'final-lease Content runtime',
				15_000,
			);
			expect(await inspectContentRuntime(tabId, true)).toMatchObject({
				listenersReady: true,
				runtimeRevision: SPECTRA_CONTENT_RUNTIME_REVISION,
				sameRuntime: true,
				oldRuntimeDisposed: false,
			});

			await publishFeedback(lease);
			await publishFeedback(lease, { kind: 'speed', value: 1 });
			await page.waitForFunction(() => (
				document.querySelectorAll('#spectra-osd-host').length === 1
				&& document.querySelectorAll('#spectra-toast-host').length === 1
				&& document.querySelector<HTMLElement>('#spectra-osd-host')
					?.matches(':popover-open') === true
			), { timeout: 5_000 });
			expect(await page.evaluate(() => {
				const scope = window as Window & {
					__spectraFinalFeedbackHosts?: {
						osd?: HTMLElement;
						toast?: HTMLElement;
					};
				};
				scope.__spectraFinalFeedbackHosts = {
					osd: document.querySelector<HTMLElement>('#spectra-osd-host') ?? undefined,
					toast: document.querySelector<HTMLElement>('#spectra-toast-host') ?? undefined,
				};
				return {
					osd: document.querySelectorAll('#spectra-osd-host').length,
					toast: document.querySelectorAll('#spectra-toast-host').length,
				};
			})).toEqual({ osd: 1, toast: 1 });

			// A restored media template is a separate runtime owner, even when its
			// scalar values are neutral. Release it explicitly before asserting that
			// the smoke lease is the final owner of this document generation.
			await page.bringToFront();
			const release = await sendFromActionPopup<{ ok: boolean; error?: { message?: string } }>({
				protocolVersion: 2, tabId, type: 'spectra.control.operation.submit', payload: {
					tabId, source: 'popup', target: null, operation: 'restore-page-settings', payload: {},
				},
			});
			if (!release.ok) throw new Error(release.error?.message ?? 'Unable to release the restored media template');
			await releaseSmokeRuntime(lease);
			lease = null;
			const retired = await eventually(
				async () => ({
					bootstrap: await readContentBootstrapStatus(targetUrl),
					runtime: await inspectContentRuntime(tabId),
					hosts: await page.evaluate(() => ({
						osd: document.querySelectorAll('#spectra-osd-host').length,
						toast: document.querySelectorAll('#spectra-toast-host').length,
					})),
				}),
				(state) => !state.bootstrap.ready
					&& state.bootstrap.runtimeRevision === null
					&& !state.runtime.listenersReady
					&& state.runtime.sameRuntime === true
					&& state.runtime.oldRuntimeDisposed === true
					&& state.hosts.osd === 0
					&& state.hosts.toast === 0,
				'final runtime lease retirement',
				5_000,
			);
			expect(retired.bootstrap).toMatchObject({
				ready: false,
				runtimeRevision: null,
				ownedSources: [],
			});
			expect(retired.hosts).toEqual({ osd: 0, toast: 0 });
			expect(await page.evaluate(() => {
				document.dispatchEvent(new Event('fullscreenchange'));
				return {
					osd: document.querySelectorAll('#spectra-osd-host').length,
					toast: document.querySelectorAll('#spectra-toast-host').length,
				};
			})).toEqual({ osd: 0, toast: 0 });

			reacquiredLease = await acquireSmokeRuntime(targetUrl, 'final-feedback-generation');
			await eventually(
				() => inspectContentRuntime(tabId),
				(state) => state.listenersReady
					&& state.runtimeRevision === SPECTRA_CONTENT_RUNTIME_REVISION
					&& state.sameRuntime === false
					&& state.oldRuntimeDisposed === true,
				'reacquired Content runtime generation',
				15_000,
			);
			await publishFeedback(reacquiredLease);
			await publishFeedback(reacquiredLease, { kind: 'speed', value: 1 });
			await page.waitForFunction(() => (
				document.querySelectorAll('#spectra-osd-host').length === 1
				&& document.querySelectorAll('#spectra-toast-host').length === 1
				&& document.querySelector<HTMLElement>('#spectra-osd-host')
					?.matches(':popover-open') === true
			), { timeout: 5_000 });
			expect(await page.evaluate(() => {
				const scope = window as Window & {
					__spectraFinalFeedbackHosts?: {
						osd?: HTMLElement;
						toast?: HTMLElement;
					};
				};
				const currentOsd = document.querySelector<HTMLElement>('#spectra-osd-host');
				const currentToast = document.querySelector<HTMLElement>('#spectra-toast-host');
				return {
					osd: document.querySelectorAll('#spectra-osd-host').length,
					toast: document.querySelectorAll('#spectra-toast-host').length,
					reusedOsd: currentOsd === scope.__spectraFinalFeedbackHosts?.osd,
					reusedToast: currentToast === scope.__spectraFinalFeedbackHosts?.toast,
				};
			})).toEqual({
				osd: 1,
				toast: 1,
				reusedOsd: false,
				reusedToast: false,
			});
			await releaseSmokeRuntime(reacquiredLease);
			reacquiredLease = null;
			await eventually(
				async () => ({
					bootstrap: await readContentBootstrapStatus(targetUrl),
					hosts: await page.evaluate(() => ({
						osd: document.querySelectorAll('#spectra-osd-host').length,
						toast: document.querySelectorAll('#spectra-toast-host').length,
					})),
				}),
				(state) => !state.bootstrap.ready
					&& state.bootstrap.runtimeRevision === null
					&& state.hosts.osd === 0
					&& state.hosts.toast === 0,
				'reacquired final runtime lease retirement',
				5_000,
			);
			expect(pageErrors).toEqual([]);
		} finally {
			if (reacquiredLease) await releaseSmokeRuntime(reacquiredLease).catch(() => undefined);
			if (lease) await releaseSmokeRuntime(lease).catch(() => undefined);
			await page.close().catch(() => undefined);
		}
	}, 35_000);
});

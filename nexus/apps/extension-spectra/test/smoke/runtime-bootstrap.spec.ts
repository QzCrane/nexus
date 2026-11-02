import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { launchPuppeteerBrowser } from '../../../../scripts/browser-driver';
import { acquireSmokeRuntime, ensureOffscreenHostForSyntheticHarness, evaluateServiceWorker, eventually, extensionId, fixtureErrors, fixturePage, fixtureUrl, getOffscreenContextCount, getTabId, openExtensionClient, readContentBootstrapStatus, readOffscreenSnapshot, readRestartedWorkerState, reinjectContentBootstrap, releaseSmokeRuntimes, resetRuntimeLeaseClient, restartServiceWorker, runtimeLeaseClient, serviceWorkerTarget, waitForContentBootstrapStatus } from './harness';
import type { SmokeRpcResult } from './harness';
import { prepareSmokeSession, startSmokeSession, teardownSmokeSession } from './harness';

// A media fact is the tab's own statement about its current document. This writes
// the one a page holding playable media writes: the fixture is a player shell with
// no source, so its own bootstrap correctly reports no media, and the revision
// jumps past that report's counter so the claim stands for the document's life.
async function reportFixtureMediaFound(tabId: number): Promise<void> {
	const results = await evaluateServiceWorker(async (targetTabId) => chrome.scripting.executeScript({
		target: { tabId: targetTabId },
		func: async (revision: number) => chrome.runtime.sendMessage({
			protocolVersion: 2,
			requestId: crypto.randomUUID(),
			type: 'spectra.tab.media.report',
			payload: {
				hasMediaElement: true,
				userInteracted: false,
				reportRevision: revision,
			},
		}),
		args: [10_000],
	}), tabId);
	const response = results?.[0]?.result as SmokeRpcResult<{ reported: boolean }> | undefined;
	if (!response?.ok) throw new Error(response?.error?.message ?? 'Media report was not accepted');
}

describe('SPECTRA built extension smoke: runtime-bootstrap', () => {
	beforeAll(async () => {
		const options = await prepareSmokeSession();
		const launched = await launchPuppeteerBrowser(options, {
			owner: 'apps/extension-spectra/test/smoke/runtime-bootstrap.spec.ts',
			profile: { kind: 'temporary', prefix: 'spectra-smoke-', isolated: true },
		});
		await startSmokeSession(launched);
	}, 60_000);

	afterAll(async () => {
		await teardownSmokeSession();
	});

	test('loads the MV3 worker and isolated zero-work bootstrap without MAIN', async () => {
		expect(serviceWorkerTarget.url()).toBe(`chrome-extension://${extensionId}/background.js`);
		const commandState = await evaluateServiceWorker(async () => {
			const manifest = chrome.runtime.getManifest() as {
				commands?: Record<string, { suggested_key?: { default?: string } }>;
			};
			return {
				declaredVolumeUp: manifest.commands?.volume_up?.suggested_key?.default,
				commands: Object.fromEntries(
					(await chrome.commands.getAll()).map(({ name, shortcut }) => [name, shortcut]),
				),
			};
		});
		expect(commandState.declaredVolumeUp).toBe('Alt+Up');
		expect(commandState.commands).not.toHaveProperty('toggle_mute');
		expect(commandState.commands).not.toHaveProperty('speed_down');
		expect(commandState.commands).not.toHaveProperty('speed_up');
		expect(commandState.commands.volume_up).toEqual(expect.any(String));
		expect(commandState.commands.volume_up.length).toBeGreaterThan(0);
		expect(commandState.commands).not.toHaveProperty('volume_down');
		expect(await readContentBootstrapStatus()).toMatchObject({
			ready: false,
			runtimeRevision: null,
			ownedSources: [],
		});
		expect(await fixturePage.evaluate(() => ({
			legacyMarker: document.documentElement.dataset.spectraContentLoaded,
			mainRuntime: '__SPECTRA_MAIN_RUNTIME__' in window,
		}))).toEqual({ legacyMarker: undefined, mainRuntime: false });
		expect(fixtureErrors).toEqual([]);
	});

	test('routes the visible-tab v2 request to its sole background owner', async () => {
		// This is a background routing probe, not a Popup lifecycle test. Using
		// Options avoids acquiring a transient active-tab runtime before the next
		// test verifies that an untouched page remains bootstrap-only.
		const client = await openExtensionClient('options.html');
		try {
			const response = await client.evaluate(() => chrome.runtime.sendMessage({
				protocolVersion: 2,
				requestId: crypto.randomUUID(),
				type: 'spectra.tab.visible.list',
				payload: {},
			}));
			expect(response).toMatchObject({ ok: true, data: { tabs: expect.any(Array) } });
		} finally {
			await client.close();
		}
	});

	test('persists media facts eagerly and reuses them across a forced worker stop', async () => {
		// Regression: the media inventory delay must not come back on every popup
		// open. Facts are persisted on every mutation (not only on the best-effort
		// runtime.onSuspend hook), so a forced worker stop cannot lose them.
		await fixturePage.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
		await waitForContentBootstrapStatus(fixtureUrl);
		await fixturePage.bringToFront();
		const tabId = await getTabId(fixturePage.url());
		// The smoke fixture is a player shell with no source, so its own document
		// correctly reports "no media" - the inventory lists a tab only when it
		// holds something playable, not when it holds a <video> slot. This test is
		// about that claim surviving a worker stop, so it states the claim the tab
		// would have made while holding real media and then follows it through
		// storage, a forced stop and a fresh read.
		await reportFixtureMediaFound(tabId);
		const client = await openExtensionClient('options.html');
		try {
			const first = await client.evaluate(() => chrome.runtime.sendMessage({
				protocolVersion: 2,
				requestId: crypto.randomUUID(),
				type: 'spectra.tab.visible.list',
				payload: {},
			})) as SmokeRpcResult<{ tabs: number[] }>;
			expect(first.ok).toBe(true);
			expect(first.data.tabs).toContain(tabId);

			// Deterministic proof that persistence no longer waits for onSuspend:
			// the settled fact must already be in browser-session storage after the scan.
			await eventually(
				() => evaluateServiceWorker(async (targetTabId) => {
					const key = 'spectra.media-facts.v1';
					const raw = (await chrome.storage.session.get(key))[key] as
						Record<string, { outcome?: string }> | undefined;
					return raw?.[String(targetTabId)]?.outcome ?? null;
				}, tabId),
				(outcome) => outcome === 'found',
				'eager media fact persistence after the first scan',
			);

			await restartServiceWorker();

			const after = await client.evaluate(() => chrome.runtime.sendMessage({
				protocolVersion: 2,
				requestId: crypto.randomUUID(),
				type: 'spectra.tab.visible.list',
				payload: {},
			})) as SmokeRpcResult<{ tabs: number[] }>;
			expect(after.ok).toBe(true);
			expect(after.data.tabs).toContain(tabId);
		} finally {
			await client.close();
		}
	}, 30_000);

	test('keeps the v2 config ABI stable while new Content reads the additive site policy', async () => {
		const tabId = await getTabId(fixturePage.url());
		const client = await openExtensionClient('options.html');
		const result = await client.evaluate(async (targetTabId) => {
			const executions = await chrome.scripting.executeScript({
				target: { tabId: targetTabId },
				world: 'ISOLATED',
				func: async () => {
					const send = (type: string) => chrome.runtime.sendMessage({
						protocolVersion: 2,
						requestId: crypto.randomUUID(),
						type,
						payload: {},
					});
					return {
						config: await send('spectra.audio.config.get'),
						policy: await send('spectra.audio.policy.get'),
					};
				},
			});
			return executions[0]?.result;
		}, tabId).finally(() => client.close()) as {
			config: SmokeRpcResult<Record<string, unknown>>;
			policy: SmokeRpcResult<{ config: Record<string, unknown>; mediaRoute: string }>;
		};
		expect(result.config.ok).toBe(true);
		expect(result.policy.ok).toBe(true);
		if (!result.config.ok || !result.policy.ok) return;
		expect(result.config.data.enabled).toBe(true);
		expect(result.config.data.config).toBeUndefined();
		expect(result.policy.data.config.enabled).toBe(true);
		expect(result.policy.data.mediaRoute).toBe('auto');
	});

	test('leaves untouched media transparent and creates no AudioContext', async () => {
		const offscreenBefore = await getOffscreenContextCount();
		const status = await readContentBootstrapStatus();
		const state = await fixturePage.evaluate(() => {
			const video = document.querySelector<HTMLVideoElement>('#v');
			return {
				volume: video?.volume,
				muted: video?.muted,
				playbackRate: video?.playbackRate,
				audioContexts: (window as Window & { __spectraAudioContextCount?: number })
					.__spectraAudioContextCount,
			};
		});
		expect(status).toMatchObject({ ready: false, runtimeRevision: null, ownedSources: [] });
		expect(state).toEqual({ volume: 1, muted: false, playbackRate: 1, audioContexts: 0 });
		expect(offscreenBefore).toBe(0);
		expect(await getOffscreenContextCount()).toBe(0);
	});

	test('keeps one versioned isolated bootstrap across repeated injection', async () => {
		const result = await reinjectContentBootstrap(fixtureUrl);
		expect(result).toMatchObject({ same: true });
		expect(typeof result?.revision).toBe('string');
		expect(await fixturePage.evaluate(() => '__SPECTRA_MAIN_RUNTIME__' in window)).toBe(false);
	});

	test('restarts the MV3 worker and reconciles the existing offscreen host', async () => {
		// This suite owns a fresh profile; establish the active Content runtime and
		// pre-existing offscreen host that worker restart reconciliation must preserve.
		await acquireSmokeRuntime(fixturePage.url(), 'runtime-restart');
		await ensureOffscreenHostForSyntheticHarness();
		expect(await getOffscreenContextCount()).toBe(1);
		await restartServiceWorker();
		const restartedState = await readRestartedWorkerState();
		expect(restartedState.settings).toMatchObject({ ok: true });
		expect(restartedState.contextCount).toBe(1);
		expect(await readOffscreenSnapshot()).toEqual({ audioTabs: [], remoteTabs: [] });
		expect(restartedState.status).toMatchObject({ ok: true, data: { actualMode: 'bypass' } });
		expect(fixtureErrors).toEqual([]);
	}, 35_000);

	test('retires the old Content bootstrap silently after an extension reload', async () => {
		await releaseSmokeRuntimes();
		await runtimeLeaseClient?.close().catch(() => undefined);
		resetRuntimeLeaseClient();
		const errorsBefore = fixtureErrors.length;
		const reloadDiagnostics: string[] = [];
		const onConsole = (message: import('puppeteer').ConsoleMessage) => {
			if ((message.type() === 'error' || message.type() === 'warning')
				&& /SPECTRA|Extension context invalidated/u.test(message.text())) {
				reloadDiagnostics.push(`console.${message.type()}: ${message.text()}`);
			}
		};
		fixturePage.on('console', onConsole);
		const extensionClient = await openExtensionClient();
		try {
			await extensionClient.evaluate(() => {
				chrome.runtime.reload();
			}).catch(() => undefined);
			await extensionClient.close().catch(() => undefined);
			await new Promise((resolveWait) => setTimeout(resolveWait, 200));
			await fixturePage.goto(`${fixtureUrl}?after-extension-reload=1`, {
				waitUntil: 'domcontentloaded',
			});
			await new Promise((resolveWait) => setTimeout(resolveWait, 200));
			expect(fixtureErrors.slice(errorsBefore)).toEqual([]);
			expect(reloadDiagnostics).toEqual([]);
		} finally {
			fixturePage.off('console', onConsole);
			await extensionClient.close().catch(() => undefined);
		}
	}, 30_000);
});

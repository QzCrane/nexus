// goal: project durable settings revisions without turning delivery failures into false commit failures

import {
	createSpectraEvent,
	normalizeHostname,
	selectMediaRouteDecisionForUrl,
	type MediaRouteSettings,
	type SettingsPatch,
	type SettingsSnapshot,
} from '@nexus/contracts';
import { toSettingsUiSnapshot } from '@nexus/contracts/ui-settings-runtime';
import { withContentOSDMessages } from '../shared/i18n/content-osd';
import { swLog } from '../shared/logger';
import { updateShortcutSettings } from './shortcuts';
import { reconcileAllHotkeyRuntimeLeases } from './runtime-loader';
import { forEachBounded } from './bounded-fanout';
import {
	SettingsProjectionQueue,
	type SettingsProjectionWork,
} from './settings-projection-queue';

const PROJECTION_REVISION_KEY = 'spectraSettingsProjectedRevision';
const PROJECTION_RETRY_ALARM = 'spectra-settings-projection-retry';
export const SETTINGS_PROJECTION_TAB_CONCURRENCY = 8;

type SnapshotProvider = () => Promise<SettingsSnapshot>;
type MediaRouteProvider = () => Promise<MediaRouteSettings>;
let snapshotProvider: SnapshotProvider | null = null;
let mediaRouteProvider: MediaRouteProvider | null = null;
let initialized = false;

function isHotkeyScope(scope: SettingsPatch['scope']): boolean {
	return scope === 'hotkey-slots' || scope === 'hotkey-site-mutation';
}

// A non-resident or already-destroyed Content runtime will pull the latest
// durable snapshot at its next bootstrap. Every other delivery failure keeps
// the revision pending so the queue retries instead of recording false success.
export function isExpectedAbsentContentReceiver(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes('Receiving end does not exist')
		|| message.includes('Could not establish connection')
		|| message.includes('message port closed before a response was received')
		|| message.includes('No tab with id')
		|| message.includes('The tab was closed')
		|| message.includes('The frame was removed')
		|| message.includes('Cannot access contents of url');
}

async function deliverContentMessage(
	tabId: number,
	message: unknown,
): Promise<void> {
	try {
		await chrome.tabs.sendMessage(tabId, message);
	} catch (error) {
		if (isExpectedAbsentContentReceiver(error)) return;
		throw error;
	}
}

async function projectSettings(work: SettingsProjectionWork<SettingsSnapshot>): Promise<void> {
	const event = createSpectraEvent('spectra.settings.changed', work.snapshot);
	const uiEvent = createSpectraEvent('spectra.settings.ui.changed', toSettingsUiSnapshot(work.snapshot));
	const extensionBroadcast = Promise.all([
		chrome.runtime.sendMessage(event).catch(() => undefined),
		chrome.runtime.sendMessage(uiEvent).catch(() => undefined),
	]);
	const tabs = work.global || work.hotkeys || work.mediaRoutesAll || work.mediaRouteDomains.length > 0
		? await chrome.tabs.query({})
		: [];

	if (work.mediaRoutesAll || work.mediaRouteDomains.length > 0) {
		if (!mediaRouteProvider) throw new Error('Media route projection provider is unavailable');
		const mediaRoutes = await mediaRouteProvider();
		await forEachBounded(tabs, SETTINGS_PROJECTION_TAB_CONCURRENCY, async (tab) => {
			if (tab.id === undefined || !tab.url) return;
			const hostname = normalizeHostname(tab.url);
			if (!hostname || !work.mediaRoutesAll && !work.mediaRouteDomains.some((domain) => (
				hostname === domain || hostname.endsWith(`.${domain}`)
			))) return;
			const routeEvent = createSpectraEvent('spectra.audio.route.changed', {
				domain: hostname,
				mediaRoute: selectMediaRouteDecisionForUrl(tab.url, mediaRoutes).mediaRoute,
			});
			await deliverContentMessage(tab.id, routeEvent);
		});
	}

	if (work.hotkeys) {
		updateShortcutSettings(work.snapshot.hotkeySettings);
		const hotkeyEvent = createSpectraEvent('spectra.hotkeys.changed', work.snapshot.hotkeySettings);
		await forEachBounded(tabs, SETTINGS_PROJECTION_TAB_CONCURRENCY, async (tab) => {
			if (tab.id === undefined) return;
			await deliverContentMessage(tab.id, hotkeyEvent);
		});
		// Content must observe the settings event before exact-document lease
		// reconciliation can suspend a heavy runtime for lean/none routes.
		await reconcileAllHotkeyRuntimeLeases(work.snapshot.hotkeySettings, tabs);
	}

	if (work.global) {
		const settings = withContentOSDMessages(work.snapshot.globalSettings);
		const contentEvent = createSpectraEvent('spectra.content.settings.changed', settings);
		await forEachBounded(tabs, SETTINGS_PROJECTION_TAB_CONCURRENCY, async (tab) => {
			if (tab.id === undefined) return;
			await deliverContentMessage(tab.id, contentEvent);
		});
	}

	await extensionBroadcast;
}

const projectionQueue = new SettingsProjectionQueue<SettingsSnapshot>({
	project: projectSettings,
	onSuccess: async ({ snapshot }) => {
		await chrome.storage.local.set({ [PROJECTION_REVISION_KEY]: snapshot.revision });
		await chrome.alarms.clear(PROJECTION_RETRY_ALARM).catch(() => false);
	},
	onDeferred: async ({ snapshot }, error) => {
		swLog.warn(`[Settings] Projection revision ${snapshot.revision} deferred`, error);
		chrome.alarms.create(PROJECTION_RETRY_ALARM, { delayInMinutes: 1 });
	},
	delay: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
});

export function scheduleSettingsProjection(
	snapshot: SettingsSnapshot,
	patch: SettingsPatch,
): void {
	projectionQueue.enqueue({
		snapshot,
		global: patch.scope === 'global',
		hotkeys: isHotkeyScope(patch.scope),
		mediaRouteDomains: [],
		mediaRoutesAll: false,
	});
}

export function scheduleMediaRouteProjection(
	snapshot: SettingsSnapshot,
	domain: string,
): void {
	const normalized = normalizeHostname(domain);
	if (!normalized) return;
	projectionQueue.enqueue({
		snapshot,
		global: false,
		hotkeys: false,
		mediaRouteDomains: [normalized],
		mediaRoutesAll: false,
	});
}

export function scheduleAllMediaRouteProjection(snapshot: SettingsSnapshot): void {
	projectionQueue.enqueue({
		snapshot,
		global: false,
		hotkeys: false,
		mediaRouteDomains: [],
		mediaRoutesAll: true,
	});
}

async function recoverSettingsProjection(): Promise<void> {
	if (!snapshotProvider) return;
	const [snapshot, stored] = await Promise.all([
		snapshotProvider(),
		chrome.storage.local.get(PROJECTION_REVISION_KEY),
	]);
	const projectedRevision = stored[PROJECTION_REVISION_KEY];
	if (typeof projectedRevision === 'number' && projectedRevision >= snapshot.revision) return;
	projectionQueue.enqueue({
		snapshot,
		global: true,
		hotkeys: true,
		mediaRouteDomains: [],
		mediaRoutesAll: true,
	});
}

export function initializeSettingsProjection(
	provider: SnapshotProvider,
	routes: MediaRouteProvider,
): void {
	snapshotProvider = provider;
	mediaRouteProvider = routes;
	if (initialized) return;
	initialized = true;
	chrome.alarms.onAlarm.addListener((alarm) => {
		if (alarm.name !== PROJECTION_RETRY_ALARM) return;
		void recoverSettingsProjection().then(
			() => projectionQueue.wake(),
			(error) => swLog.warn('[Settings] Unable to recover deferred projection', error),
		);
	});
	void recoverSettingsProjection().catch((error) => {
		swLog.warn('[Settings] Initial projection recovery failed', error);
		chrome.alarms.create(PROJECTION_RETRY_ALARM, { delayInMinutes: 1 });
	});
}

export const settingsProjectionTestApi = {
	PROJECTION_REVISION_KEY,
	PROJECTION_RETRY_ALARM,
};

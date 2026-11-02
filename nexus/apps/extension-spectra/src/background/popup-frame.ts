// goal: state how many cards the Popup will draw before the Popup exists
//
// The Action Popup's window is sized by its document, and its document cannot
// know what to draw until two round trips have answered. Every attempt to size
// the window from the rendered content therefore had to correct itself after the
// user could already see it - the jump that survived every fix inside the Popup.
//
// The count, however, is known here first. `chrome.action.setPopup` lets a tab
// carry its own popup URL, so the number of cards travels in that URL and the
// render-blocking head script turns it into a height before the first paint.
// Nothing about the decision happens while the window is visible.
//
// The count is a projection, not a promise: a background tab whose media has
// been paused past the retention window is listed by the inventory and still
// dropped by the card, and a document can retire between the count and the open.
// A wrong count costs exactly one correction - and because the Popup records the
// height each announced count settled on, the next open of that same state is
// already right.

import { actionPopupPath } from '../shared/popup-bootstrap';
import { isRestrictedUrl } from '../shared/restricted-url';
import { swLog } from '../shared/logger';
import { readMediaTabInventory } from './media-inventory-runtime';
import { settingsRepository } from './settings-repository';

/**
 * post: how many cards a Popup opened on `activeTab` will render, or null when
 * the question cannot be answered (no active tab, unreadable inventory)
 *
 * The rule mirrors the Popup's own inventory: the active tab always draws a card
 * unless its scheme forbids it, and every other listed media tab draws one in the
 * background stack.
 */
export function popupCardCount(
	activeTab: Pick<chrome.tabs.Tab, 'id' | 'url'> | null | undefined,
	visibleTabIds: readonly number[],
): number | null {
	if (!activeTab || !Number.isSafeInteger(activeTab.id)) return null;
	const activeTabId = Number(activeTab.id);
	const activeCard = isRestrictedUrl(activeTab.url) ? 0 : 1;
	const backgroundCards = visibleTabIds.filter((tabId) => tabId !== activeTabId).length;
	return activeCard + backgroundCards;
}

// One sync per tab, and only the newest one may write: `setPopup` is async, so a
// slow inventory read that started before a tab switch must not repaint the
// popup URL after the switch has been announced.
const syncGeneration = new Map<number, number>();
let generation = 0;

function commitPopupPath(tabId: number, popupPath: string): Promise<void> {
	try {
		return chrome.action.setPopup({ tabId, popup: popupPath }).catch((error: unknown) => {
			// A tab that closed mid-sync, or a browser that refuses the override, only
			// costs the Popup its prediction - which is exactly where it was before.
			swLog.debug(`[PopupFrame] Unable to announce the Popup shape for tab ${tabId}`, error);
		});
	} catch (error) {
		swLog.debug(`[PopupFrame] Action API unavailable for tab ${tabId}`, error);
		return Promise.resolve();
	}
}

/**
 * Whether there is anything to announce to.
 *
 * A host that exposes tabs but not the action API (an integration harness, a
 * stripped-down worker) has no popup to size, and scheduling work against it
 * would only produce rejected promises nobody can act on.
 */
function actionApiAvailable(): boolean {
	try {
		return typeof chrome !== 'undefined' && typeof chrome.action?.setPopup === 'function';
	} catch {
		return false;
	}
}

async function announceForTab(tabId: number): Promise<void> {
	const own = ++generation;
	syncGeneration.set(tabId, own);
	let popupPath = actionPopupPath(null);
	try {
		const tab = await chrome.tabs.get(tabId);
		// The count is only meaningful for the inventory this tab belongs to, so
		// it is read after the tab itself is known.
		const [inventory, settings] = await Promise.all([readMediaTabInventory(), settingsRepository.getSnapshot()]);
		const cards = popupCardCount(tab, inventory.tabs);
		popupPath = actionPopupPath(cards, { hasMainCard: !isRestrictedUrl(tab.url),
			language: settings.globalSettings.lang, visualizerEnabled: settings.globalSettings.visualizerEnabled });
	} catch (error) {
		swLog.debug(`[PopupFrame] Popup shape for tab ${tabId} stays unannounced`, error);
	}
	// A newer announcement for this tab owns the URL now.
	if (syncGeneration.get(tabId) !== own) return;
	await commitPopupPath(tabId, popupPath);
}

/**
 * eff: (re)announces the card count for one tab
 *
 * Called whenever the answer can change: the tab became active, its document
 * committed or navigated, it started or stopped being audible, or a media report
 * added/removed a card on a tab that is already active.
 */
export function syncActionPopup(tabId: number): void {
	if (!Number.isSafeInteger(tabId) || tabId <= 0) return;
	if (!actionApiAvailable()) return;
	void announceForTab(tabId);
}

// Media reports arrive one per tab; a query per report would read the same
// inventory several times for one visible change.
let activeSyncHandle: ReturnType<typeof setTimeout> | null = null;
const ACTIVE_SYNC_COALESCE_MS = 60;

/** Settings ACKs wait for the appearance announcement, not the report timer. */
export async function flushActiveActionPopups(): Promise<void> {
	if (!actionApiAvailable()) return;
	if (activeSyncHandle !== null) clearTimeout(activeSyncHandle);
	activeSyncHandle = null;
	try {
		const tabs = await chrome.tabs.query({ active: true });
		await Promise.all(tabs.map((tab) => tab.id === undefined ? undefined : announceForTab(tab.id)));
	} catch (error) {
		swLog.debug('[PopupFrame] Active appearance announcement unavailable', error);
	}
}

/**
 * eff: (re)announces the card count for the active tab of every window
 *
 * The Action Popup is only ever opened for an active tab, so this is the set that
 * has to be right at the moment of a click.
 */
export function syncActiveActionPopups(): void {
	if (activeSyncHandle !== null) return;
	if (!actionApiAvailable()) return;
	activeSyncHandle = setTimeout(() => {
		activeSyncHandle = null;
		try {
			chrome.tabs.query({ active: true }).then((tabs) => {
				for (const tab of tabs) {
					if (tab.id !== undefined) syncActionPopup(tab.id);
				}
			}).catch((error: unknown) => {
				swLog.debug('[PopupFrame] Active tabs unavailable for a shape announcement', error);
			});
		} catch (error) {
			swLog.debug('[PopupFrame] Active tabs unavailable for a shape announcement', error);
		}
	}, ACTIVE_SYNC_COALESCE_MS);
}

/** eff: forgets a closed tab's announcement bookkeeping */
export function forgetActionPopup(tabId: number): void {
	syncGeneration.delete(tabId);
}

// eff: keeps every active tab's popup URL equal to the shape its Popup would draw
export function initializeActionPopupFrames(): void {
	chrome.tabs.onActivated.addListener((activeInfo) => {
		syncActionPopup(activeInfo.tabId);
	});
	chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
		if (!tab.active) return;
		// `status` marks a committing document, `url` a navigation, `audible` the
		// start and stop of playback. Each of them can add or remove a card.
		if (changeInfo.status === undefined
			&& changeInfo.url === undefined
			&& changeInfo.audible === undefined) return;
		syncActionPopup(tabId);
	});
	chrome.tabs.onRemoved.addListener((tabId) => {
		forgetActionPopup(tabId);
		// A background card may have just disappeared, including on the tab the
		// user is looking at.
		syncActiveActionPopups();
	});
	chrome.windows.onFocusChanged.addListener((windowId) => {
		if (windowId === chrome.windows.WINDOW_ID_NONE) return;
		syncActiveActionPopups();
	});
	// Seeding: the tab that was active when the worker woke never fires
	// `onActivated`, and a fresh worker has announced nothing yet.
	syncActiveActionPopups();
}

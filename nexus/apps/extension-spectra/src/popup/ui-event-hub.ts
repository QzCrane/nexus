// goal: owns the Popup's single guarded Chrome runtime listener and routes UI events directly by tab

import type { SpectraEventEnvelope } from '@nexus/contracts';
import {
	isSpectraUiEventEnvelope,
	type SpectraUiEventType,
} from '@nexus/contracts/ui-runtime';

export type PopupUiEvent = SpectraEventEnvelope<SpectraUiEventType>;
type PopupUiEventSubscriber = (message: PopupUiEvent, sender: chrome.runtime.MessageSender) => void;

const subscribersByTab = new Map<number, Set<PopupUiEventSubscriber>>();
let installedOwner: typeof chrome.runtime.onMessage | null = null;

const runtimeListener = (message: unknown, sender: chrome.runtime.MessageSender = {}): false => {
	if (sender.id !== chrome.runtime.id) return false;
	if (!isSpectraUiEventEnvelope(message) || typeof message.tabId !== 'number') return false;
	const subscribers = subscribersByTab.get(message.tabId);
	if (!subscribers) return false;
	for (const subscriber of [...subscribers]) {
		try {
			subscriber(message, sender);
		} catch (error) {
			console.error('[SPECTRA Popup] UI event subscriber failed:', error);
		}
	}
	return false;
};

function ensureRuntimeListener(): void {
	const owner = chrome.runtime.onMessage;
	if (installedOwner === owner) return;
	installedOwner?.removeListener(runtimeListener);
	owner.addListener(runtimeListener);
	installedOwner = owner;
}

function releaseRuntimeListenerIfIdle(): void {
	if (subscribersByTab.size > 0 || !installedOwner) return;
	installedOwner.removeListener(runtimeListener);
	installedOwner = null;
}

export function subscribePopupTabUiEvents(
	tabId: number,
	subscriber: PopupUiEventSubscriber,
): () => void {
	let subscribers = subscribersByTab.get(tabId);
	if (!subscribers) {
		subscribers = new Set();
		subscribersByTab.set(tabId, subscribers);
	}
	subscribers.add(subscriber);
	ensureRuntimeListener();
	let disposed = false;
	return () => {
		if (disposed) return;
		disposed = true;
		const current = subscribersByTab.get(tabId);
		current?.delete(subscriber);
		if (current?.size === 0) subscribersByTab.delete(tabId);
		releaseRuntimeListenerIfIdle();
	};
}

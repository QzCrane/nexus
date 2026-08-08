// goal: one physical chrome.storage.onChanged listener per HALO JS context
// inv: feature authorities subscribe to this bus instead of registering parallel Chrome listeners

export type HaloStorageChangeListener = (
	changes: Record<string, chrome.storage.StorageChange>,
	areaName: string,
) => void;

const subscribers = new Set<HaloStorageChangeListener>();
let attached = false;

const onStorageChanged: HaloStorageChangeListener = (changes, areaName) => {
	for (const subscriber of [...subscribers]) subscriber(changes, areaName);
};

function attach(): void {
	if (attached) return;
	attached = true;
	chrome.storage.onChanged.addListener(onStorageChanged);
}

function detachIfIdle(): void {
	if (!attached || subscribers.size > 0) return;
	chrome.storage.onChanged.removeListener(onStorageChanged);
	attached = false;
}

export function subscribeHaloStorageChanges(listener: HaloStorageChangeListener): () => void {
	subscribers.add(listener);
	attach();
	return () => {
		subscribers.delete(listener);
		detachIfIdle();
	};
}

export const haloStorageChangeBusTestApi = {
	reset(): void {
		subscribers.clear();
		if (attached) chrome.storage.onChanged.removeListener(onStorageChanged);
		attached = false;
	},
	get subscriberCount(): number { return subscribers.size; },
	get isAttached(): boolean { return attached; },
};

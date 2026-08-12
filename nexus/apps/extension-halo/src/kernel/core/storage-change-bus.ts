// goal: one physical chrome.storage.onChanged listener per HALO JS realm
// inv: separately bundled SidePanel scripts converge through one global bus state

export type HaloStorageChangeListener = (
	changes: Record<string, chrome.storage.StorageChange>,
	areaName: string,
) => void;

interface HaloStorageChangeBusState {
	subscribers: Set<HaloStorageChangeListener>;
	attached: boolean;
	onStorageChanged: HaloStorageChangeListener;
}

const GLOBAL_KEY = '__HALO_STORAGE_CHANGE_BUS_V1__';
type BusGlobal = typeof globalThis & {
	[GLOBAL_KEY]?: HaloStorageChangeBusState;
};

function createState(): HaloStorageChangeBusState {
	const state = {
		subscribers: new Set<HaloStorageChangeListener>(),
		attached: false,
		onStorageChanged: (() => undefined) as HaloStorageChangeListener,
	};
	state.onStorageChanged = (changes, areaName) => {
		// Snapshot before delivery. Re-entrant unsubscribe/resubscribe affects only
		// the next storage event instead of recursively extending this iteration.
		// A broken domain subscriber must never starve later independent domains.
		for (const subscriber of [...state.subscribers]) {
			try {
				subscriber(changes, areaName);
			} catch (error: unknown) {
				console.error('[HALO:StorageChangeBus] Subscriber failed', error);
			}
		}
	};
	return state;
}

function busState(): HaloStorageChangeBusState {
	const shared = globalThis as BusGlobal;
	shared[GLOBAL_KEY] ??= createState();
	return shared[GLOBAL_KEY];
}

function attach(state: HaloStorageChangeBusState): void {
	if (state.attached) return;
	chrome.storage.onChanged.addListener(state.onStorageChanged);
	state.attached = true;
}

function detachIfIdle(state: HaloStorageChangeBusState): void {
	if (!state.attached || state.subscribers.size > 0) return;
	chrome.storage.onChanged.removeListener(state.onStorageChanged);
	state.attached = false;
}

export function subscribeHaloStorageChanges(listener: HaloStorageChangeListener): () => void {
	const state = busState();
	state.subscribers.add(listener);
	attach(state);
	return () => {
		state.subscribers.delete(listener);
		detachIfIdle(state);
	};
}

export const haloStorageChangeBusTestApi = {
	reset(): void {
		const shared = globalThis as BusGlobal;
		const state = shared[GLOBAL_KEY];
		if (!state) return;
		state.subscribers.clear();
		if (state.attached) chrome.storage.onChanged.removeListener(state.onStorageChanged);
		delete shared[GLOBAL_KEY];
	},
	get subscriberCount(): number { return busState().subscribers.size; },
	get isAttached(): boolean { return busState().attached; },
};

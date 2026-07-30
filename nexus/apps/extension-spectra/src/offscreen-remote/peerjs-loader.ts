// goal: load the local opaque PeerJS runtime only for an explicit Remote create
// rule: one offscreen-local single flight; no network fallback, polling or retry timer

const PEER_VENDOR_LOAD_TIMEOUT_MS = 10_000;

interface PeerScriptHandle {
	remove(): void;
}

export interface PeerRuntimeLoaderDependencies {
	hasPeer?: () => boolean;
	resolveUrl?: () => string;
	createScript?: (
		url: string,
		onLoad: () => void,
		onError: () => void,
	) => PeerScriptHandle;
	setTimer?: (callback: () => void, delayMs: number) => number;
	clearTimer?: (timerId: number) => void;
}

export interface PeerRuntimeLoader {
	ensure(): Promise<void>;
	dispose(): void;
}

function defaultHasPeer(): boolean {
	return typeof (globalThis as typeof globalThis & { Peer?: unknown }).Peer === 'function';
}

function defaultCreateScript(
	url: string,
	onLoad: () => void,
	onError: () => void,
): PeerScriptHandle {
	const script = document.createElement('script');
	script.src = url;
	script.async = true;
	script.addEventListener('load', onLoad, { once: true });
	script.addEventListener('error', onError, { once: true });
	document.head.appendChild(script);
	return {
		remove() {
			script.removeEventListener('load', onLoad);
			script.removeEventListener('error', onError);
			script.remove();
		},
	};
}

export function createPeerRuntimeLoader(
	dependencies: PeerRuntimeLoaderDependencies = {},
): PeerRuntimeLoader {
	const hasPeer = dependencies.hasPeer ?? defaultHasPeer;
	const resolveUrl = dependencies.resolveUrl
		?? (() => chrome.runtime.getURL('peerjs-vendor.js'));
	const createScript = dependencies.createScript ?? defaultCreateScript;
	const setTimer = dependencies.setTimer
		?? ((callback, delayMs) => window.setTimeout(callback, delayMs));
	const clearTimer = dependencies.clearTimer ?? ((timerId) => window.clearTimeout(timerId));
	let state: 'idle' | 'loading' | 'ready' | 'disposed' = hasPeer() ? 'ready' : 'idle';
	let pending: Promise<void> | null = null;
	let script: PeerScriptHandle | null = null;
	let timer: number | null = null;
	let rejectPending: ((error: Error) => void) | null = null;

	const resetLoadingState = (): void => {
		if (timer !== null) clearTimer(timer);
		timer = null;
		script?.remove();
		script = null;
		pending = null;
		rejectPending = null;
	};

	const ensure = (): Promise<void> => {
		if (state === 'disposed') return Promise.reject(new Error('PeerJS runtime loader is disposed'));
		if (hasPeer()) {
			state = 'ready';
			return Promise.resolve();
		}
		if (state === 'loading' && pending) return pending;
		state = 'loading';
		pending = new Promise<void>((resolve, reject) => {
			rejectPending = reject;
			const fail = (message: string): void => {
				if (state !== 'loading') return;
				state = 'idle';
				resetLoadingState();
				reject(new Error(message));
			};
			const complete = (): void => {
				if (state !== 'loading') return;
				if (!hasPeer()) {
					fail('Local PeerJS vendor loaded without installing globalThis.Peer');
					return;
				}
				state = 'ready';
				resetLoadingState();
				resolve();
			};
			timer = setTimer(
				() => fail('Local PeerJS vendor load timed out'),
				PEER_VENDOR_LOAD_TIMEOUT_MS,
			);
			try {
				script = createScript(
					resolveUrl(),
					complete,
					() => fail('Local PeerJS vendor failed to load'),
				);
			} catch (error) {
				fail(error instanceof Error ? error.message : String(error));
			}
		});
		return pending;
	};

	return {
		ensure,
		dispose() {
			if (state === 'disposed') return;
			state = 'disposed';
			const reject = rejectPending;
			resetLoadingState();
			reject?.(new Error('PeerJS runtime loader was disposed'));
		},
	};
}

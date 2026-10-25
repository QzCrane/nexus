// goal: load the local opaque PeerJS runtime only for an explicit Remote create
// rule: one offscreen-local single flight; no network fallback or polling

import type Peer from '../../vendor/peerjs/peerjs.min.js';

export type { default as Peer } from '../../vendor/peerjs/peerjs.min.js';
export type { DataConnection } from '../../vendor/peerjs/peerjs.min.js';

const PEER_VENDOR_LOAD_TIMEOUT_MS = 10_000;

interface PeerRuntimeModule { default?: unknown; }

export interface PeerRuntimeLoaderDependencies {
	loadModule?: () => Promise<PeerRuntimeModule>;
	setTimer?: (callback: () => void, delayMs: number) => number;
	clearTimer?: (timerId: number) => void;
}

export interface PeerRuntimeLoader {
	ensure(): Promise<void>;
	createPeer(peerId: string): Peer;
	dispose(): void;
}

function defaultLoadModule(): Promise<PeerRuntimeModule> {
	return import(chrome.runtime.getURL('peerjs-vendor.js')) as Promise<PeerRuntimeModule>;
}

export function createPeerRuntimeLoader(
	dependencies: PeerRuntimeLoaderDependencies = {},
): PeerRuntimeLoader {
	const loadModule = dependencies.loadModule ?? defaultLoadModule;
	const setTimer = dependencies.setTimer
		?? ((callback, delayMs) => window.setTimeout(callback, delayMs));
	const clearTimer = dependencies.clearTimer ?? ((timerId) => window.clearTimeout(timerId));
	let disposed = false;
	let pending: Promise<void> | null = null;
	let peerConstructor: typeof Peer | null = null;
	let timer: number | null = null;
	let rejectPending: ((error: Error) => void) | null = null;

	const resetLoadingState = (): void => {
		if (timer !== null) clearTimer(timer);
		timer = null;
		pending = null;
		rejectPending = null;
	};

	const ensure = (): Promise<void> => {
		if (disposed) return Promise.reject(new Error('PeerJS runtime loader is disposed'));
		if (peerConstructor) return Promise.resolve();
		if (pending) return pending;
		let resolvePending!: () => void;
		let rejectCurrent!: (error: Error) => void;
		const request = new Promise<void>((resolve, reject) => {
			resolvePending = resolve;
			rejectCurrent = reject;
		});
		pending = request;
		rejectPending = rejectCurrent;
		const isCurrentAttempt = (): boolean => pending === request;
		const fail = (message: string): void => {
			if (!isCurrentAttempt()) return;
			resetLoadingState();
			rejectCurrent(new Error(message));
		};
		const complete = (module: PeerRuntimeModule): void => {
			if (!isCurrentAttempt()) return;
			if (typeof module.default !== 'function') {
				fail('Local PeerJS vendor loaded without exporting Peer');
				return;
			}
			peerConstructor = module.default as typeof Peer;
			resetLoadingState();
			resolvePending();
		};
		timer = setTimer(
			() => fail('Local PeerJS vendor load timed out'),
			PEER_VENDOR_LOAD_TIMEOUT_MS,
		);
		let loaded: Promise<PeerRuntimeModule>;
		try {
			loaded = loadModule();
		} catch (error) {
			fail(error instanceof Error ? error.message : String(error));
			return request;
		}
		void loaded
			.then(complete)
			.catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
		return request;
	};

	return {
		ensure,
		createPeer(peerId) {
			if (!peerConstructor) throw new Error('Local PeerJS vendor runtime is unavailable');
			return new peerConstructor(peerId, {
				debug: 0,
				referrerPolicy: 'no-referrer',
			});
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			peerConstructor = null;
			const reject = rejectPending;
			resetLoadingState();
			reject?.(new Error('PeerJS runtime loader was disposed'));
		},
	};
}

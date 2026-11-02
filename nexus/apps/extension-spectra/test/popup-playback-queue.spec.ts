import { expect, test } from 'bun:test';
import { DEFAULT_AUDIO_CONFIG, DEFAULT_GLOBAL_SETTINGS, type ControlFieldState, type ControlSnapshot, type MediaTarget } from '@nexus/contracts';
import { bindMediaControls } from '../src/popup/card/media-events';
import { applyControlSnapshot } from '../src/popup/card/messaging';
import { createUpdateFn } from '../src/popup/card/state';
import type { CardInternalState } from '../src/popup/card/types';

test.each([false, null])('queues a pause after observed play while the preceding ACK is gated (initial actual: %s)', async (initialPlaying) => {
	const originals = new Map(['chrome', 'window'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	const target: MediaTarget = { documentId: 'playback-queue-document', frameId: 0, mediaId: 'playback-queue-media', sourceRevision: 1, kind: 'video' };
	const field = (playing: boolean, revision: number): ControlFieldState<boolean> => ({ desired: playing, actual: playing, revision,
		phase: 'applied', strategy: 'dom-native', coverage: 'active-target', controlled: true, lastError: null });
	const snapshot: ControlSnapshot = { tabId: 9_055, documentId: target.documentId, origin: 'https://media.test', generation: 1,
		revision: 0, activeMedia: target, activeVideo: target, fields: initialPlaying === null ? {} : { playing: field(initialPlaying, 0) } };
	const state: CardInternalState = { config: structuredClone(DEFAULT_AUDIO_CONFIG), stableConfig: structuredClone(DEFAULT_AUDIO_CONFIG),
		controlSnapshot: snapshot, controlSnapshotKnown: true, lifecycleSnapshotKnown: true, isCaptureActive: false, userInteracted: true,
		actualMode: 'bypass', desiredMode: 'bypass', phase: 'idle', controlGeneration: 1, controlRevision: 0,
		audioDocumentId: null, audioOrigin: null, audioGeneration: -1, audioConfigRevision: 0, lastError: null, draggingField: null };
	const submitted: boolean[] = [];
	const requestTypes: string[] = [];
	let releaseFirst!: () => void;
	const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
	let firstStarted!: () => void;
	const started = new Promise<void>((resolve) => { firstStarted = resolve; });
	let allSettled!: () => void;
	const settled = new Promise<void>((resolve) => { allSettled = resolve; });
	let renderedPlaying: unknown;
	const render = () => {
		renderedPlaying = state.controlSnapshot?.fields.playing?.actual;
		if (!state.playbackPending && submitted.length === 2) allSettled();
	};
	const errors: unknown[] = [];
	Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener() {} } });
	Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
		storage: { local: { set: async () => undefined } },
		runtime: { sendMessage: async (message: { type: string; payload: { baseRevision: number; patch?: { playing: boolean }; operation?: string } }) => {
			const localToggle = message.type === 'spectra.control.operation.submit' && message.payload.operation === 'playback-toggle';
			if (!localToggle && message.type !== 'spectra.control.intent.submit') throw new Error(`Unexpected request: ${message.type}`);
			const playing = localToggle ? true : message.payload.patch?.playing;
			if (typeof playing !== 'boolean') throw new Error('Missing explicit playing intent');
			requestTypes.push(message.type);
			submitted.push(playing);
			const revision = message.payload.baseRevision + 1;
			if (submitted.length === 1) { firstStarted(); await gate; }
			return { ok: true, data: { tabId: snapshot.tabId, documentId: target.documentId,
				generation: 1, revision, target, fields: { playing: field(playing, revision) },
				...(localToggle ? { operationId: `playback-${revision}`, operation: 'playback-toggle', strategy: 'dom-native', coverage: 'active-target', result: { playing } }
					: { intentId: `playback-${revision}` }) } };
		} },
	} });
	try {
		const update = createUpdateFn(state, snapshot.tabId, () => false, render, () => DEFAULT_GLOBAL_SETTINGS,
			(error) => { errors.push(error); }, {
				stage() {}, flush: async () => null, onSettled: () => () => undefined, onFailure: () => () => undefined,
				hasPendingVolume: () => false, dispose() {},
			});
		const button = { onclick: null as (() => void) | null, setAttribute() {} };
		bindMediaControls({ btnPause: button, speedBtns: [] } as never, snapshot.tabId, state, update, render,
			(error) => { errors.push(error); });
		button.onclick?.();
		await started;
		applyControlSnapshot(state, { ...snapshot, revision: 1, fields: { playing: field(true, 1) } }, render);
		expect(renderedPlaying).toBe(true);
		expect(state.playbackPending).toBe(true);
		button.onclick?.();
		releaseFirst();
		await settled;
		expect(submitted).toEqual([true, false]);
		expect(requestTypes).toEqual([initialPlaying === null ? 'spectra.control.operation.submit' : 'spectra.control.intent.submit', 'spectra.control.intent.submit']);
		expect(state.playbackPending).toBe(false);
		expect(errors).toEqual([]);
		expect(state.controlSnapshot?.fields.playing?.actual).toBe(false);
	} finally {
		releaseFirst();
		for (const [key, descriptor] of originals) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	}
});

// goal: manages the internal state of a tab control card and orchestrates configuration updates across background and content scripts

import type { AudioConfig, GlobalSettings } from '@nexus/kernel';
import type { CardInternalState } from './types';
import { sendSpectraRequest, sendSpectraTabRequest } from '../../shared/spectra-client';

export type ConfigUpdateFn = ((changes: Partial<AudioConfig>) => void) & {
	flush: () => Promise<void>;
};

export function createGetCapturing(
  state: CardInternalState,
): () => boolean {
  return () => {
    return !!state.isCaptureActive;
  };
}

// post: returns an async update function that applies changes optimistically and routes commands based on the active capture mode
export function createUpdateFn(
  state: CardInternalState,
  tabId: number,
  _getCapturing: () => boolean,
  render: () => void,
  _getGlobalSettings: () => GlobalSettings
): ConfigUpdateFn {
	const minSendIntervalMs = 50;
	let pending = false;
	let inFlight: Promise<void> | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let lastSentAt = 0;
	let localRevision = 0;

	const scheduleFlush = () => {
		if (timer || inFlight) return;
		const delay = Math.max(0, minSendIntervalMs - (performance.now() - lastSentAt));
		timer = setTimeout(() => {
			timer = null;
			void flush().catch(() => undefined);
		}, delay);
	};

	const flush = (): Promise<void> => {
		if (inFlight) return inFlight;
		if (!pending) return Promise.resolve();
		pending = false;
		lastSentAt = performance.now();
		const sentRevision = localRevision;
		const config: AudioConfig = {
			...state.config,
			eqValues: [...state.config.eqValues],
		};

		inFlight = (async () => {
			// Popup emits config intent only. Content/background/offscreen publish the acknowledged path.
			const response = await sendSpectraTabRequest(
				tabId,
				'spectra.audio.runtime.configure',
				{ config },
			);

			if (response.ok) {
				// A response for an earlier drag sample must not overwrite a newer
				// optimistic value that is waiting to be coalesced and sent.
				if (localRevision === sentRevision) state.config = response.data.config;
				state.actualMode = response.data.actualMode;
				state.desiredMode = response.data.desiredMode;
				state.phase = response.data.phase;
				state.generation = response.data.generation;
				state.lastError = response.data.lastError;
				state.isCaptureActive = response.data.actualMode === 'capture';
			}
		})().finally(() => {
			inFlight = null;
			render();
			if (pending) scheduleFlush();
		});
		return inFlight;
	};

	const drain = async (): Promise<void> => {
		while (pending || inFlight) {
			if (inFlight) await inFlight;
			else {
				if (timer) {
					clearTimeout(timer);
					timer = null;
				}
				await flush();
			}
		}
	};

	window.addEventListener('pagehide', () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		void drain()
			.then(() => sendSpectraRequest('spectra.audio.session.flush', {}, { tabId }))
			.catch(() => undefined);
	}, { once: true });

	const update = ((changes: Partial<AudioConfig>) => {
		// This function is only invoked by explicit controls/preset actions; reads never call it.
		if (Object.keys(changes).length > 0) state.userInteracted = true;

		// eff: apply changes immediately to local state for responsive UI feedback
		state.config = { ...state.config, ...changes };
		localRevision += 1;
		pending = true;
		render();
		scheduleFlush();
	}) as ConfigUpdateFn;
	update.flush = drain;
	return update;
}


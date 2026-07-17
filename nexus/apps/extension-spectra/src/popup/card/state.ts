// goal: manages the internal state of a tab control card and orchestrates configuration updates across background and content scripts

import type { AudioConfig, GlobalSettings } from '@nexus/kernel';
import type { ControlPatch } from '@nexus/contracts';
import { mergeAudioConfig, mergeControlFields, type CardInternalState } from './types';
import { sendSpectraRequest } from '../../shared/spectra-client';

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
	let pendingPatch: ControlPatch = {};

	const toControlPatch = (changes: Partial<AudioConfig>): ControlPatch => {
		const patch: ControlPatch = {};
		if (changes.enabled !== undefined) patch.audioEnabled = state.config.enabled;
		if (changes.volume !== undefined || changes.volumeBase !== undefined) {
			patch.volumeBase = state.config.volumeBase ?? Math.min(100, state.config.volume);
		}
		if (changes.volume !== undefined || changes.boost !== undefined) {
			patch.boost = state.config.boost ?? (state.config.volume > 100 ? state.config.volume / 100 : 1);
		}
		if (changes.muted !== undefined) patch.mediaMuted = state.config.muted;
		if (changes.speed !== undefined) patch.speed = state.config.speed;
		if (changes.preservePitch !== undefined) patch.preservePitch = state.config.preservePitch;
		if (changes.eqValues !== undefined) patch.eqValues = [...state.config.eqValues];
		if (changes.bass !== undefined) patch.bass = state.config.bass;
		if (changes.compressor !== undefined) patch.compressor = state.config.compressor;
		if (changes.mono !== undefined) patch.mono = state.config.mono;
		if (changes.pan !== undefined) patch.pan = state.config.pan;
		if (changes.delay !== undefined) patch.delay = state.config.delay;
		return patch;
	};

	const splitByCoverage = (patch: ControlPatch): Array<{
		requestedCoverage: 'active-target' | 'full';
		patch: ControlPatch;
	}> => {
		const target: ControlPatch = {};
		const full: ControlPatch = {};
		for (const [field, value] of Object.entries(patch)) {
			const output = ['audioEnabled', 'boost', 'eqValues', 'bass', 'compressor', 'mono', 'pan', 'delay'].includes(field)
				? full
				: target;
			(output as Record<string, unknown>)[field] = value;
		}
		return [
			...(Object.keys(target).length > 0 ? [{ requestedCoverage: 'active-target' as const, patch: target }] : []),
			...(Object.keys(full).length > 0 ? [{ requestedCoverage: 'full' as const, patch: full }] : []),
		];
	};

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
		const patch = pendingPatch;
		pendingPatch = {};

		inFlight = (async () => {
			for (const group of splitByCoverage(patch)) {
				const response = await sendSpectraRequest(
					'spectra.control.intent.submit',
					{
						tabId,
						source: 'popup',
						requestedCoverage: group.requestedCoverage,
						target: state.controlSnapshot?.activeMedia ?? null,
						baseRevision: state.controlRevision,
						patch: group.patch,
					},
					{ tabId },
				);
				if (!response.ok) {
					state.lastError = response.error;
					throw new Error(response.error.message);
				}
				state.controlRevision = Math.max(state.controlRevision, response.data.revision);
				state.controlGeneration = Math.max(
					state.controlGeneration,
					response.data.generation,
				);
				const applied = Object.values(response.data.fields);
				const failed = applied.find((field) => field?.lastError)?.lastError ?? null;
				if (failed) {
					state.lastError = failed;
					throw new Error(failed.message);
				}
				state.stableConfig = mergeControlFields(state.stableConfig, response.data.fields);
			}
			// A response for an earlier drag sample must not overwrite a newer
			// optimistic value that is waiting to be coalesced and sent.
			if (localRevision === sentRevision) {
				state.config = mergeAudioConfig(state.stableConfig, {
					eqValues: [...state.stableConfig.eqValues],
				});
			}
			state.lastError = null;
		})().catch((error) => {
			if (localRevision === sentRevision) {
				state.config = mergeAudioConfig(state.stableConfig, {
					eqValues: [...state.stableConfig.eqValues],
				});
			}
			throw error;
		}).finally(() => {
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
		state.config = mergeAudioConfig(state.config, changes);
		pendingPatch = { ...pendingPatch, ...toControlPatch(changes) };
		localRevision += 1;
		pending = true;
		render();
		scheduleFlush();
	}) as ConfigUpdateFn;
	update.flush = drain;
	return update;
}


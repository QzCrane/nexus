// Executes the fixed, validated remote command set against one bound tab.

import type {
	AudioConfig,
	AudioRuntimeStatus,
	SpectraRequestPayload,
	SpectraRequestType,
	SpectraResponseData,
} from '@nexus/contracts';
import { isRemoteCommand, type RemoteState } from '../remote/protocol';
import { sendSpectraTabRequest } from '../shared/spectra-client';
import { getAudioSession } from './audio-session-store';

type StateCallback = (tabId: number, state: RemoteState) => void;

let stateCallback: StateCallback | null = null;

export type { RemoteCommand, RemoteState } from '../remote/protocol';

export function setStateCallback(callback: StateCallback | null): void {
	stateCallback = callback;
}

export async function executeCommand(command: unknown, tabId: number): Promise<boolean> {
	if (!isRemoteCommand(command) || !Number.isInteger(tabId) || tabId <= 0) return false;

	switch (command) {
		case 'volume_up':
			await updateAudioConfig(tabId, (config) => ({
				...config,
				volume: Math.min(800, config.volume + 10),
				muted: false,
			}));
			break;
		case 'volume_down':
			await updateAudioConfig(tabId, (config) => ({
				...config,
				volume: Math.max(0, config.volume - 10),
				muted: false,
			}));
			break;
		case 'volume_max':
			await updateAudioConfig(tabId, (config) => ({ ...config, volume: 800, muted: false }));
			break;
		case 'volume_100':
			await updateAudioConfig(tabId, (config) => ({ ...config, volume: 100, muted: false }));
			break;
		case 'mute':
			await updateAudioConfig(tabId, (config) => ({ ...config, muted: !config.muted }));
			break;
		case 'play_pause':
			await requestTab(tabId, 'spectra.media.play.toggle', {});
			break;
		case 'seek_forward':
			await requestTab(tabId, 'spectra.video.seek', { delta: 10 });
			break;
		case 'seek_backward':
			await requestTab(tabId, 'spectra.video.seek', { delta: -10 });
			break;
		case 'seek_forward_30':
			await requestTab(tabId, 'spectra.video.seek', { delta: 30 });
			break;
		case 'seek_backward_30':
			await requestTab(tabId, 'spectra.video.seek', { delta: -30 });
			break;
		case 'speed_up':
			await requestTab(tabId, 'spectra.media.speed.set', { delta: 0.25 });
			break;
		case 'speed_down':
			await requestTab(tabId, 'spectra.media.speed.set', { delta: -0.25 });
			break;
		case 'speed_reset':
			await requestTab(tabId, 'spectra.media.speed.set', { speed: 1 });
			break;
		case 'fullscreen':
			await requestTab(tabId, 'spectra.video.fullscreen.toggle', {});
			break;
		case 'pip':
			await requestTab(tabId, 'spectra.media.pip.toggle', {});
			break;
	}

	await syncState(tabId);
	return true;
}

export async function syncState(tabId: number): Promise<void> {
	if (!stateCallback || !Number.isInteger(tabId) || tabId <= 0) return;
	try {
		const [audioSession, mediaResponse, tab] = await Promise.all([
			getAudioSession(tabId).catch(() => null),
			requestTab(tabId, 'spectra.media.state.get', {}).catch(() => undefined),
			chrome.tabs.get(tabId).catch(() => undefined),
		]);

		const config = audioSession?.actualConfig;
		let tabDomain = '';
		if (tab?.url) {
			try {
				const parsed = new URL(tab.url);
				if (parsed.protocol === 'http:' || parsed.protocol === 'https:') tabDomain = parsed.hostname;
			} catch {
				// Non-web tabs intentionally expose no domain.
			}
		}

		stateCallback(tabId, {
			generation: firstSafeInteger(audioSession?.generation) ?? 0,
			volume: finiteNumber(config?.volume, 100),
			muted: config?.muted === true,
			playing: mediaResponse?.playing ?? false,
			speed: finiteNumber(mediaResponse?.speed, 1),
			tabTitle: (tab?.title ?? '').slice(0, 512),
			tabDomain,
		});
	} catch {
		// The tab may have navigated or closed between authentication and sync.
	}
}

async function getAudioStatus(tabId: number): Promise<AudioRuntimeStatus | undefined> {
	const response = await sendSpectraTabRequest(tabId, 'spectra.audio.runtime.get', {}).catch(() => undefined);
	return response?.ok ? response.data : undefined;
}

async function updateAudioConfig(
	tabId: number,
	update: (config: AudioConfig) => AudioConfig,
): Promise<void> {
	const status = await getAudioStatus(tabId);
	if (!status) throw new Error('Audio runtime is unavailable');
	const response = await sendSpectraTabRequest(
		tabId,
		'spectra.audio.runtime.configure',
		{ config: update(status.config) },
	);
	if (!response.ok) throw new Error(response.error.message);
}

async function requestTab<T extends SpectraRequestType>(
	tabId: number,
	type: T,
	payload: SpectraRequestPayload<T>,
): Promise<SpectraResponseData<T>> {
	const response = await sendSpectraTabRequest(tabId, type, payload);
	if (!response.ok) throw new Error(response.error.message);
	return response.data;
}

function finiteNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function firstSafeInteger(...values: unknown[]): number | undefined {
	return values.find((value): value is number => Number.isSafeInteger(value) && (value as number) >= 0);
}

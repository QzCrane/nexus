import type { AudioConfig } from '@nexus/kernel';
import type { SiteBridge, BridgeCallbacks } from './types';
import { logger } from '../../../shared/logger';

const log = logger.content;

// inv: last values to prevent message loops between contexts
type ValueCache = { value: number; ts: number };

type YouTubeBridgeMessage =
	| { type: 'SPECTRA_YT_SYNC_BACK'; volume: number; muted: boolean }
	| { type: 'SPECTRA_YT_SYNC_BACK'; speed: number }
	| { type: 'SPECTRA_YT_SPEED_OK'; speed: number }
	| { type: 'SPECTRA_YT_VOLUME_OK'; volume: number; muted: boolean }
	| { type: 'SPECTRA_YT_FAIL'; feature: 'speed' | 'volume'; error: string };

const TYPE_ONLY_KEYS = new Set(['type']);
const SPEED_KEYS = new Set([...TYPE_ONLY_KEYS, 'speed']);
const VOLUME_KEYS = new Set([...TYPE_ONLY_KEYS, 'volume', 'muted']);
const FAILURE_KEYS = new Set([...TYPE_ONLY_KEYS, 'feature', 'error']);
const MAX_BRIDGE_ERROR_LENGTH = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
	return Object.keys(value).every((key) => allowed.has(key));
}

function isFiniteInRange(value: unknown, min: number, max: number): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

// post: accepts only messages emitted by the page-owned YouTube adapter. The
// source check blocks messages delivered from child/parent windows, while the
// exact discriminants and ranges keep arbitrary page data out of AudioConfig.
export function parseYouTubeBridgeEvent(
	event: Pick<MessageEvent, 'source' | 'data'>,
	expectedSource: Window = window,
): YouTubeBridgeMessage | null {
	if (event.source !== expectedSource || !isRecord(event.data) || typeof event.data.type !== 'string') {
		return null;
	}

	switch (event.data.type) {
		case 'SPECTRA_YT_SYNC_BACK':
			if (
				hasOnlyKeys(event.data, VOLUME_KEYS)
				&& isFiniteInRange(event.data.volume, 0, 100)
				&& typeof event.data.muted === 'boolean'
			) {
				return {
					type: event.data.type,
					volume: event.data.volume,
					muted: event.data.muted,
				};
			}
			if (hasOnlyKeys(event.data, SPEED_KEYS) && isFiniteInRange(event.data.speed, 0.1, 16)) {
				return { type: event.data.type, speed: event.data.speed };
			}
			return null;

		case 'SPECTRA_YT_SPEED_OK':
			return hasOnlyKeys(event.data, SPEED_KEYS) && isFiniteInRange(event.data.speed, 0.1, 16)
				? { type: event.data.type, speed: event.data.speed }
				: null;

		case 'SPECTRA_YT_VOLUME_OK':
			return hasOnlyKeys(event.data, VOLUME_KEYS)
				&& isFiniteInRange(event.data.volume, 0, 100)
				&& typeof event.data.muted === 'boolean'
				? { type: event.data.type, volume: event.data.volume, muted: event.data.muted }
				: null;

		case 'SPECTRA_YT_FAIL':
			return hasOnlyKeys(event.data, FAILURE_KEYS)
				&& (event.data.feature === 'speed' || event.data.feature === 'volume')
				&& typeof event.data.error === 'string'
				&& event.data.error.length <= MAX_BRIDGE_ERROR_LENGTH
				? { type: event.data.type, feature: event.data.feature, error: event.data.error }
				: null;

		default:
			return null;
	}
}

export class YouTubeBridge implements SiteBridge {
	readonly id = 'youtube';

	private callbacks: BridgeCallbacks | null = null;
	private listenerDisposer: (() => void) | null = null;
	private lastSpeed: ValueCache | null = null;
	private lastVol: ValueCache | null = null;
	private lastMuted: { value: boolean; ts: number } | null = null;

	isMatch(): boolean {
		return isYouTubeHostname(window.location.hostname);
	}

	onInitialize(callbacks: BridgeCallbacks): () => void {
		this.callbacks = callbacks;
		if (this.listenerDisposer) return this.listenerDisposer;
		// eff: listen for authoritative responses from the MAIN world injector
		const messageListener = (e: MessageEvent) => {
			const message = parseYouTubeBridgeEvent(e);
			if (!message) return;
			const activeCallbacks = this.callbacks;
			if (!activeCallbacks) return;

			// rule: authoritative sync from YT player API (movie_player.addEventListener)
			if (message.type === 'SPECTRA_YT_SYNC_BACK') {
				const changes: Partial<AudioConfig> = {};
				const now = Date.now();

				if ('volume' in message) {
					changes.volume = message.volume;
					changes.muted = message.muted;
					// sync internal cache to prevent command blocking
					this.lastVol = { value: message.volume, ts: now };
					this.lastMuted = { value: message.muted, ts: now };
				}
				if ('speed' in message) {
					changes.speed = message.speed;
					// sync internal cache to prevent command blocking
					this.lastSpeed = { value: message.speed, ts: now };
				}

				log.debug(`[YouTubeBridge] Auth Sync Back (Cache Synced):`, changes);
				activeCallbacks.updateConfig(changes, { isNativeSync: true });
				return;
			}

			if (message.type === 'SPECTRA_YT_SPEED_OK') {
				log.debug(`[YouTubeBridge] Speed Confirmed: ${message.speed}x`);
			}
			if (message.type === 'SPECTRA_YT_VOLUME_OK') {
				log.debug(`[YouTubeBridge] Volume Confirmed: ${message.volume}% muted=${message.muted}`);
			}
			if (message.type === 'SPECTRA_YT_FAIL') {
				log.warn('[YouTubeBridge] YT API sync failed:', message.error);
				if (message.feature === 'speed') this.lastSpeed = null;
				if (message.feature === 'volume') {
					this.lastVol = null;
					this.lastMuted = null;
				}
			}
		};
		window.addEventListener('message', messageListener);

		let disposed = false;
		const dispose = () => {
			if (disposed) return;
			disposed = true;
			window.removeEventListener('message', messageListener);
			if (this.listenerDisposer === dispose) {
				this.listenerDisposer = null;
				this.callbacks = null;
				this.lastSpeed = null;
				this.lastVol = null;
				this.lastMuted = null;
			}
		};
		this.listenerDisposer = dispose;
		return dispose;
	}

	syncVolume(volume: number, muted: boolean): void {
		const now = Date.now();
		const volSkip = this.lastVol && Math.abs(this.lastVol.value - volume) < 1 && now - this.lastVol.ts < 100;
		const muteSkip = this.lastMuted && this.lastMuted.value === muted && now - this.lastMuted.ts < 100;

		if (volSkip && muteSkip) return;

		if (!volSkip) this.lastVol = { value: volume, ts: now };
		if (!muteSkip) this.lastMuted = { value: muted, ts: now };

		window.postMessage({ type: 'SPECTRA_YT_VOLUME', volume, muted }, '*');
	}

	syncSpeed(speed: number): void {
		const now = Date.now();
		if (this.lastSpeed && Math.abs(this.lastSpeed.value - speed) < 0.005 && now - this.lastSpeed.ts < 100) return;
		this.lastSpeed = { value: speed, ts: now };

		window.postMessage({ type: 'SPECTRA_YT_SPEED', speed }, '*');
	}

	shouldInhibitDomSync(): boolean {
		return true;
	}

	canPullInitialState(): boolean {
		return false;
	}
}

export function isYouTubeHostname(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/\.+$/u, '');
	return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
}

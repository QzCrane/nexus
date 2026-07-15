// YouTube's player API lives in MAIN world. This adapter discovers the player
// without a recurring timer and keeps every listener inside the runtime disposer.

interface YouTubePlayer {
	addEventListener(type: string, listener: (...args: never[]) => void): void;
	removeEventListener?(type: string, listener: (...args: never[]) => void): void;
	setPlaybackRate(rate: number): void;
	getPlaybackRate?(): number;
	setVolume(volume: number): void;
	getVolume(): number;
	isMuted(): boolean;
	mute(): void;
	unMute(): void;
	getPlayerState?(): number;
	getAdState?(): number;
}

interface YouTubeMessage {
	type: string;
	speed?: unknown;
	volume?: unknown;
	muted?: unknown;
}

export function initYouTubeAdapter(): () => void {
	const hostname = location.hostname.toLowerCase();
	if (hostname !== 'youtube.com' && !hostname.endsWith('.youtube.com')) return () => undefined;

	let currentTargetSpeed = 1;
	let baselineSpeed: number | null = null;
	let speedOwnedBySpectra = false;
	let player: YouTubePlayer | null = null;
	let detachPlayerListeners = () => undefined;
	let discoveryObserver: MutationObserver | null = null;
	let discoveryDeadline: ReturnType<typeof setTimeout> | null = null;
	let disposed = false;

	const post = (message: Record<string, unknown>) => window.postMessage(message, location.origin);
	const readCurrentSpeed = (): number | null => {
		const playerSpeed = player?.getPlaybackRate?.();
		if (typeof playerSpeed === 'number'
			&& Number.isFinite(playerSpeed)
			&& playerSpeed >= 0.1
			&& playerSpeed <= 16) return playerSpeed;
		const video = document.getElementsByTagName('video')[0];
		return video && Number.isFinite(video.playbackRate) ? video.playbackRate : null;
	};
	const relinquishSpeed = (): void => {
		if (!speedOwnedBySpectra) return;
		speedOwnedBySpectra = false;
		const restoreSpeed = baselineSpeed;
		baselineSpeed = null;
		if (restoreSpeed === null) return;
		const activePlayer = player ?? (findPlayer() ? player : null);
		try {
			if (activePlayer) activePlayer.setPlaybackRate(restoreSpeed);
			else {
				const video = document.getElementsByTagName('video')[0];
				if (video) video.playbackRate = restoreSpeed;
			}
		} catch {
			// A navigating player may already have discarded its playback API.
		}
	};

	const attachPlayer = (nextPlayer: YouTubePlayer): void => {
		if (player === nextPlayer) return;
		detachPlayerListeners();
		player = nextPlayer;

		const volumeListener = (state: { volume: number; muted: boolean }) => {
			if (!state || !Number.isFinite(state.volume) || typeof state.muted !== 'boolean') return;
			post({ type: 'SPECTRA_YT_SYNC_BACK', volume: state.volume, muted: state.muted });
		};
		const playbackRateListener = (rate: number) => {
			if (!Number.isFinite(rate)) return;
			if (!speedOwnedBySpectra) {
				// Default bypass observes native state but neither writes it back nor
				// publishes it as SPECTRA-owned configuration.
				currentTargetSpeed = rate;
				return;
			}
			const state = nextPlayer.getPlayerState?.() ?? 1;
			const isAd = document.querySelector('.ad-showing') !== null || nextPlayer.getAdState?.() === 1;

			// YouTube resets playback rate while loading, buffering, cueing, and during ads.
			if (isAd || state === -1 || state === 3 || state === 5) {
				if (currentTargetSpeed !== rate) nextPlayer.setPlaybackRate(currentTargetSpeed);
				return;
			}

			currentTargetSpeed = rate;
			post({ type: 'SPECTRA_YT_SYNC_BACK', speed: rate });
		};

		nextPlayer.addEventListener('onVolumeChange', volumeListener as (...args: never[]) => void);
		nextPlayer.addEventListener('onPlaybackRateChange', playbackRateListener as (...args: never[]) => void);
		detachPlayerListeners = () => {
			try {
				nextPlayer.removeEventListener?.('onVolumeChange', volumeListener as (...args: never[]) => void);
				nextPlayer.removeEventListener?.('onPlaybackRateChange', playbackRateListener as (...args: never[]) => void);
			} catch {
				// Some YouTube player revisions do not expose a symmetric removal API.
			}
			if (player === nextPlayer) player = null;
		};
	};

	const findPlayer = (): boolean => {
		const candidate = document.querySelector('#movie_player');
		if (!isYouTubePlayer(candidate)) return false;
		attachPlayer(candidate);
		return true;
	};

	const stopDiscovery = (): void => {
		discoveryObserver?.disconnect();
		discoveryObserver = null;
		if (discoveryDeadline !== null) {
			clearTimeout(discoveryDeadline);
			discoveryDeadline = null;
		}
	};

	const discoverPlayer = (): void => {
		if (disposed) return;
		if (findPlayer()) {
			stopDiscovery();
			return;
		}
		if (!discoveryObserver) {
			discoveryObserver = new MutationObserver(() => {
				if (findPlayer()) stopDiscovery();
			});
			discoveryObserver.observe(document, { childList: true, subtree: true });
		}
		if (discoveryDeadline !== null) clearTimeout(discoveryDeadline);
		// YouTube home pages can mutate forever without a player. Bound discovery
		// to the navigation window and re-arm only on a native lifecycle event.
		discoveryDeadline = setTimeout(stopDiscovery, 10_000);
	};

	const setSpeed = (rate: number): void => {
		if (!speedOwnedBySpectra) return;
		const activePlayer = player ?? (findPlayer() ? player : null);
		if (!activePlayer) {
			discoverPlayer();
			return;
		}
		try {
			activePlayer.setPlaybackRate(rate);
			for (const video of document.getElementsByTagName('video')) {
				if (Math.abs(video.playbackRate - rate) > 0.005) video.playbackRate = rate;
			}
			post({ type: 'SPECTRA_YT_SPEED_OK', speed: rate });
		} catch (error) {
			post({ type: 'SPECTRA_YT_FAIL', feature: 'speed', error: String(error) });
		}
	};

	const setVolume = (volume: number, muted: boolean): void => {
		const activePlayer = player ?? (findPlayer() ? player : null);
		if (!activePlayer) {
			discoverPlayer();
			return;
		}
		try {
			if (Math.abs(activePlayer.getVolume() - volume) > 1) activePlayer.setVolume(volume);
			if (activePlayer.isMuted() !== muted) muted ? activePlayer.mute() : activePlayer.unMute();
			post({ type: 'SPECTRA_YT_VOLUME_OK', volume, muted });
		} catch (error) {
			post({ type: 'SPECTRA_YT_FAIL', feature: 'volume', error: String(error) });
		}
	};

	const messageListener = (event: MessageEvent) => {
		if (event.source !== window || !isYouTubeMessage(event.data)) return;
		if (event.data.type === 'SPECTRA_CLEAR_TARGET_SPEED') {
			relinquishSpeed();
			return;
		}
		if (event.data.type === 'SPECTRA_YT_SPEED' && isFiniteInRange(event.data.speed, 0.1, 16)) {
			if (!speedOwnedBySpectra) baselineSpeed = readCurrentSpeed();
			speedOwnedBySpectra = true;
			currentTargetSpeed = event.data.speed;
			setSpeed(event.data.speed);
		} else if (
			event.data.type === 'SPECTRA_YT_VOLUME'
			&& isFiniteInRange(event.data.volume, 0, 100)
			&& typeof event.data.muted === 'boolean'
		) {
			setVolume(event.data.volume, event.data.muted);
		}
	};
	window.addEventListener('message', messageListener);

	const pageDataListener = () => {
		discoverPlayer();
		if (speedOwnedBySpectra) setSpeed(currentTargetSpeed);
	};
	window.addEventListener('yt-page-data-updated', pageDataListener);
	window.addEventListener('yt-navigate-finish', pageDataListener);
	window.addEventListener('yt-player-updated', pageDataListener);

	// Catch native rate resets that bypass the player API during SPA navigation.
	const rateListener = (event: Event) => {
		const video = event.target;
		if (
			video instanceof HTMLVideoElement
			&& speedOwnedBySpectra
			&& currentTargetSpeed !== 1
			&& Math.abs(video.playbackRate - currentTargetSpeed) > 0.005
		) {
			video.playbackRate = currentTargetSpeed;
		}
	};
	document.addEventListener('ratechange', rateListener, true);
	discoverPlayer();

	return () => {
		disposed = true;
		relinquishSpeed();
		stopDiscovery();
		detachPlayerListeners();
		window.removeEventListener('message', messageListener);
		window.removeEventListener('yt-page-data-updated', pageDataListener);
		window.removeEventListener('yt-navigate-finish', pageDataListener);
		window.removeEventListener('yt-player-updated', pageDataListener);
		document.removeEventListener('ratechange', rateListener, true);
	};
}

function isYouTubeMessage(value: unknown): value is YouTubeMessage {
	return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string';
}

function isYouTubePlayer(value: Element | null): value is Element & YouTubePlayer {
	if (!value) return false;
	const candidate = value as Partial<YouTubePlayer>;
	return typeof candidate.addEventListener === 'function'
		&& typeof candidate.setPlaybackRate === 'function'
		&& typeof candidate.setVolume === 'function'
		&& typeof candidate.getVolume === 'function'
		&& typeof candidate.isMuted === 'function'
		&& typeof candidate.mute === 'function'
		&& typeof candidate.unMute === 'function';
}

function isFiniteInRange(value: unknown, min: number, max: number): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

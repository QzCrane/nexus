// SPECTRA INJECTOR: Intercepts native media APIs to enforce CORS and enable WebAudio hijacking.
// Runs in "MAIN" world, sharing execution environment with page's JavaScript.
(function () {
	// === 0. PlaybackRate Hijacking (Universal Player Support) ===
	// goal: intercept ALL playbackRate changes to enable bidirectional sync
	// theory: by hijacking at prototype level before site scripts run, we catch all changes
	// perf: minimal overhead - direct property access, no WeakMap lookup on hot path

	(function hijackPlaybackRate() {
		const proto = HTMLMediaElement.prototype;
		const origDesc = Object.getOwnPropertyDescriptor(proto, 'playbackRate');

		// eff: use direct property storage instead of WeakMap for better performance
		// tradeoff: uses a symbol key to avoid collisions
		const rateKey = Symbol('spectraPlaybackRate');
		const lastRateKey = Symbol('spectraLastRate');

		if (!origDesc) {
			// Fallback for environments without native descriptor
			Object.defineProperty(proto, 'playbackRate', {
				get: function () { return this[rateKey] ?? 1; },
				set: function (v) {
					const newRate = +v || 1;
					const oldRate = this[lastRateKey] ?? 1;
					this[rateKey] = newRate;
					this[lastRateKey] = newRate;
					if ((newRate > oldRate ? newRate - oldRate : oldRate - newRate) > 0.001) {
						window.postMessage({ type: 'SPECTRA_RATE', speed: newRate }, '*');
					}
				},
				configurable: true,
				enumerable: true,
			});
		} else {
			const origGet = origDesc.get!;
			const origSet = origDesc.set!;

			Object.defineProperty(proto, 'playbackRate', {
				get: function () {
					// eff: prefer cached value to avoid native call overhead
					return rateKey in this ? this[rateKey] : origGet.call(this);
				},
				set: function (v) {
					const newRate = +v || 1;
					const oldRate = this[lastRateKey] ?? origGet.call(this);
					this[rateKey] = newRate;
					this[lastRateKey] = newRate;
					origSet.call(this, newRate);
					if ((newRate > oldRate ? newRate - oldRate : oldRate - newRate) > 0.001) {
						window.postMessage({ type: 'SPECTRA_RATE', speed: newRate }, '*');
					}
				},
				configurable: true,
				enumerable: true,
			});
		}
	})();

	// === 1. CORS Enforcement ===

	const originalCreateElement = document.createElement;
	const originalCreateElementNS = document.createElementNS;
	const OriginalAudio = window.Audio;

	// Helper: Force 'crossorigin' attribute for CORS compliance
	const enforceCrossOrigin = (element: HTMLElement, tagName: string) => {
		if (tagName && (tagName.toLowerCase() === 'video' || tagName.toLowerCase() === 'audio')) {
			element.setAttribute('crossorigin', 'anonymous');
		}
	};

	document.createElement = function (tagName: string, options?: ElementCreationOptions) {
		const element = originalCreateElement.call(this, tagName, options);
		enforceCrossOrigin(element, tagName);
		return element;
	};

	// @ts-expect-error: Override with simplified signature, TS overload matching is overly strict
	document.createElementNS = function (ns: string | null, tagName: string, options?: ElementCreationOptions) {
		const element = originalCreateElementNS.call(this, ns, tagName, options);
		enforceCrossOrigin(element as HTMLElement, tagName);
		return element;
	};

	// Helper to ensure detached elements are reachable
	// This fixes issues where 'new Audio()' elements are never attached to DOM, making them invisible to scanning.
	function ensureInDom(element: HTMLAudioElement) {
		if (!document.body) {
			document.addEventListener('DOMContentLoaded', () => ensureInDom(element));
			return;
		}
		let container = document.getElementById('spectra-hidden-container');
		if (!container) {
			container = document.createElement('div');
			container.id = 'spectra-hidden-container';
			container.style.cssText = 'position: absolute; top: -9999px; left: -9999px; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none;';
			document.body.appendChild(container);
		}
		if (!element.parentNode) {
			container.appendChild(element);
			// Optional: Clean up after playback if needed, but keeping them attached ensures re-scans work.
		}
	}

	window.Audio = function (src?: string) {
		// Log removed for production cleanliness
		const element = new OriginalAudio(src);
		element.setAttribute('crossorigin', 'anonymous');
		ensureInDom(element);
		return element;
	} as any;
	window.Audio.prototype = OriginalAudio.prototype;

	// ==============================================================
	// 2. Fullscreen Interception
	// ==============================================================
	const originalRequestFullscreen = Element.prototype.requestFullscreen;
	// @ts-ignore
	const originalWebkitRequestFullscreen = Element.prototype.webkitRequestFullscreen;

	// inv: tracks whether content script is actively capturing tab audio
	let isCaptureActive = false;
	// inv: tracks whether NATIVE_WEBAUDIO mode is active (createMediaElementSource also conflicts with fullscreen)
	let isWebAudioActive = false;

	function setAllMediaVolume(vol: number) {
		document.querySelectorAll('video, audio').forEach((el) => {
			try {
				(el as HTMLMediaElement).volume = vol;
				(el as HTMLMediaElement).muted = false;
			} catch (e) { }
		});
	}

	document.addEventListener('fullscreenchange', function () {
		if (document.fullscreenElement) {
			window.postMessage({ type: 'SPECTRA_FULLSCREEN_ENTERED' }, '*');
		}
	});

	// eff: waits for content script to confirm suspend, or timeout after 200ms
	const waitForPauseConfirm = () => new Promise<void>(resolve => {
		const timer = setTimeout(resolve, 200);
		const handler = (e: MessageEvent) => {
			if (e.data?.type === 'SPECTRA_PAUSE_CONFIRMED') {
				clearTimeout(timer); window.removeEventListener('message', handler); resolve();
			}
		};
		window.addEventListener('message', handler);
	});

	// eff: pauses enhanced audio before fullscreen (both CAPTURE and WEBAUDIO have fullscreen conflicts)
	// note: createMediaElementSource() permanently binds to HTMLMediaElement, causing Chrome pipeline deadlock during fullscreen
	async function prepareFullscreen(): Promise<void> {
		if (isCaptureActive || isWebAudioActive) {
			window.postMessage({ type: 'SPECTRA_PAUSE_FOR_FULLSCREEN' }, '*');
			setAllMediaVolume(1);
			await waitForPauseConfirm();
		}
	}

	Element.prototype.requestFullscreen = async function (options?: FullscreenOptions) {
		await prepareFullscreen();
		return originalRequestFullscreen.call(this, options);
	};

	if (originalWebkitRequestFullscreen) {
		// @ts-ignore
		Element.prototype.webkitRequestFullscreen = async function (options) {
			await prepareFullscreen();
			return originalWebkitRequestFullscreen.call(this, options);
		};
	}

	// ==============================================================
	// 3. Web Audio API Hijacking (Core Audio Engine Intercept)
	// ==============================================================
	// @ts-ignore
	const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
	// Track hijacked nodes to apply volume updates
	const activeBoosters = new Set<GainNode>();
	let globalVolume = 1.0;

	if (OriginalAudioContext) {
		const Construct = function (options?: AudioContextOptions) {
			const ctx = new OriginalAudioContext(options);

			// 1. Create our Master Booster (GainNode)
			const booster = ctx.createGain();
			booster.gain.value = globalVolume;

			// 2. Create Limiter (Compressor) to prevent clipping at high volumes
			const limiter = ctx.createDynamicsCompressor();
			limiter.threshold.value = -3;  // Threshold in dB
			limiter.knee.value = 0;        // Hard knee
			limiter.ratio.value = 20;      // High ratio 
			limiter.attack.value = 0.005;  // Fast attack
			limiter.release.value = 0.1;   // Fast release

			// 3. Chain: Booster -> Limiter -> Real Destination
			const realDestination = ctx.destination;
			booster.connect(limiter);
			limiter.connect(realDestination);

			// 4. Hijack the .destination property
			// Any code connecting to ctx.destination will actually connect to our booster
			Object.defineProperty(ctx, 'destination', {
				get: function () { return booster; },
				configurable: true
			});

			activeBoosters.add(booster);

			// 5. Cleanup when closed
			const originalClose = ctx.close;
			ctx.close = async function () {
				activeBoosters.delete(booster);
				return originalClose.apply(this, arguments as any);
			};

			return ctx;
		};

		Construct.prototype = OriginalAudioContext.prototype;
		// @ts-ignore
		window.AudioContext = window.webkitAudioContext = Construct;
	}

	// Listen for volume updates and capture state from Content Script
	window.addEventListener('message', function (event) {
		if (!event.data) return;

		if (event.data.type === 'SPECTRA_VOLUME_UPDATE') {
			globalVolume = event.data.volume;
			activeBoosters.forEach(node => {
				try {
					node.gain.setTargetAtTime(globalVolume, node.context.currentTime, 0.05);
				} catch (e) { }
			});
		}

		// eff: sync capture state from content script to control fullscreen behavior
		if (event.data.type === 'SPECTRA_CAPTURE_STATE') {
			isCaptureActive = !!event.data.active;
		}

		// eff: sync webaudio state from content script to control fullscreen behavior
		if (event.data.type === 'SPECTRA_WEBAUDIO_STATE') {
			isWebAudioActive = !!event.data.active;
		}

		// eff: handle YouTube speed sync from content script
		// note: YouTube API only accessible in MAIN world
		if (event.data.type === 'SPECTRA_YT_SPEED') {
			const rate = event.data.speed;
			const yt = document.querySelector('#movie_player') as any;
			if (yt && typeof yt.setPlaybackRate === 'function') {
				try {
					if (Math.abs(yt.getPlaybackRate() - rate) > 0.005) {
						yt.setPlaybackRate(rate);
						window.postMessage({ type: 'SPECTRA_YT_SPEED_OK', speed: rate }, '*');
					}
				} catch (e) {
					window.postMessage({ type: 'SPECTRA_YT_FAIL', feature: 'speed', error: String(e) }, '*');
				}
			}
		}

		// eff: handle YouTube volume sync from content script
		if (event.data.type === 'SPECTRA_YT_VOLUME') {
			const { volume, muted } = event.data;
			const yt = document.querySelector('#movie_player') as any;
			if (yt && typeof yt.setVolume === 'function') {
				try {
					if (Math.abs(yt.getVolume() - volume) > 1) {
						yt.setVolume(volume);
					}
					const currentlyMuted = yt.isMuted();
					if (currentlyMuted !== muted) {
						muted ? yt.mute() : yt.unMute();
					}
					window.postMessage({ type: 'SPECTRA_YT_VOLUME_OK', volume, muted }, '*');
				} catch (e) {
					window.postMessage({ type: 'SPECTRA_YT_FAIL', feature: 'volume', error: String(e) }, '*');
				}
			}
		}
	});

})();

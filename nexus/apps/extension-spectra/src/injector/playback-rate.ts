// goal: intercept ALL playbackRate changes with MAXIMUM performance
// theory: MutationObserver cache + pre-allocated array + inline caching
// perf: O(1) lookup, zero allocation on hot path, batched updates

export function hijackPlaybackRate(): void {
	const proto = HTMLMediaElement.prototype;
	const origDesc = Object.getOwnPropertyDescriptor(proto, 'playbackRate');

	// perf: Symbol keys for O(1) property access
	const rateKey = Symbol('spectraPlaybackRate');
	const lastRateKey = Symbol('spectraLastRate');

	// perf: cached media elements - avoid repeated DOM queries
	const mediaCache = new Set<HTMLMediaElement>();
	const cacheArray: HTMLMediaElement[] = [];
	let cacheDirty = true;

	// perf: batch updates with requestAnimationFrame
	let pendingSpeed: number | null = null;
	let rafId: number | null = null;

	// eff: rebuild cache array from Set when needed
	const rebuildCacheArray = (): void => {
		if (!cacheDirty) return;
		cacheArray.length = 0;
		mediaCache.forEach(el => cacheArray.push(el));
		cacheDirty = false;
	};

	// eff: apply speed to all cached elements - O(N) but with pre-allocated array
	const applySpeedToAll = (speed: number): void => {
		rebuildCacheArray();
		const arr = cacheArray;
		const len = arr.length;
		// perf: local variable for faster access
		const threshold = 0.005;
		for (let i = 0; i < len; i++) {
			const el = arr[i]!;
			// perf: inline Math.abs to avoid function call
			const diff = el.playbackRate - speed;
			if (diff > threshold || diff < -threshold) {
				el.playbackRate = speed;
			}
		}
	};

	// eff: batched update using requestAnimationFrame
	const scheduleUpdate = (speed: number): void => {
		pendingSpeed = speed;
		if (rafId !== null) return;
		rafId = requestAnimationFrame(() => {
			rafId = null;
			if (pendingSpeed !== null) {
				applySpeedToAll(pendingSpeed);
				pendingSpeed = null;
			}
		});
	};

	// perf: MutationObserver to track media elements - O(1) add/remove
	const observer = new MutationObserver((mutations) => {
		let changed = false;
		for (let i = 0, l = mutations.length; i < l; i++) {
			const m = mutations[i]!;
			if (m.type === 'childList') {
				// Check added nodes
				const added = m.addedNodes;
				for (let j = 0, jl = added.length; j < jl; j++) {
					const node = added[j]!;
					if (node instanceof HTMLMediaElement) {
						mediaCache.add(node);
						changed = true;
					} else if (node instanceof Element) {
						// Check descendants
						const videos = node.getElementsByTagName('video');
						const audios = node.getElementsByTagName('audio');
						for (let k = 0, kl = videos.length; k < kl; k++) {
							const v = videos[k];
							if (v) {
								mediaCache.add(v);
								changed = true;
							}
						}
						for (let k = 0, kl = audios.length; k < kl; k++) {
							const a = audios[k];
							if (a) {
								mediaCache.add(a);
								changed = true;
							}
						}
					}
				}
				// Check removed nodes
				const removed = m.removedNodes;
				for (let j = 0, jl = removed.length; j < jl; j++) {
					const node = removed[j]!;
					if (node instanceof HTMLMediaElement) {
						mediaCache.delete(node);
						changed = true;
					}
				}
			}
		}
		if (changed) cacheDirty = true;
	});

	// Start observing
	observer.observe(document, { childList: true, subtree: true });

	// Initial scan
	const initVideos = document.getElementsByTagName('video');
	const initAudios = document.getElementsByTagName('audio');
	for (let i = 0, l = initVideos.length; i < l; i++) {
		const v = initVideos[i];
		if (v) mediaCache.add(v);
	}
	for (let i = 0, l = initAudios.length; i < l; i++) {
		const a = initAudios[i];
		if (a) mediaCache.add(a);
	}
	cacheDirty = true;

	// eff: listen for target speed updates - use batched updates
	window.addEventListener('message', (e) => {
		if (e.data?.type === 'SPECTRA_TARGET_SPEED') {
			scheduleUpdate(e.data.speed);
		}
	});

	if (!origDesc) {
		Object.defineProperty(proto, 'playbackRate', {
			get: function () { return this[rateKey] ?? 1; },
			set: function (v) {
				const newRate = +v || 1;
				const oldRate = this[lastRateKey] ?? 1;
				this[rateKey] = newRate;
				this[lastRateKey] = newRate;
				// perf: inline diff calculation
				const diff = newRate - oldRate;
				if (diff > 0.001 || diff < -0.001) {
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
				return rateKey in this ? this[rateKey] : origGet.call(this);
			},
			set: function (v) {
				const newRate = +v || 1;
				const oldRate = this[lastRateKey] ?? origGet.call(this);
				this[rateKey] = newRate;
				this[lastRateKey] = newRate;
				origSet.call(this, newRate);
				// perf: inline diff calculation
				const diff = newRate - oldRate;
				if (diff > 0.001 || diff < -0.001) {
					window.postMessage({ type: 'SPECTRA_RATE', speed: newRate }, '*');
				}
			},
			configurable: true,
			enumerable: true,
		});
	}
}

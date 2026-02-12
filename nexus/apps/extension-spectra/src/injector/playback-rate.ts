// goal: intercept ALL playbackRate changes to enable bidirectional sync
// theory: by hijacking at prototype level before site scripts run, we catch all changes
// perf: minimal overhead - direct property access, no WeakMap lookup on hot path

export function hijackPlaybackRate(): void {
	const proto = HTMLMediaElement.prototype;
	const origDesc = Object.getOwnPropertyDescriptor(proto, 'playbackRate');

	// eff: use direct property storage instead of WeakMap for better performance
	// tradeoff: uses a symbol key to avoid collisions
	const rateKey = Symbol('spectraPlaybackRate');
	const lastRateKey = Symbol('spectraLastRate');

	// eff: target speed to enforce (null = no enforcement)
	let targetSpeed: number | null = null;

	// eff: listen for target speed updates from content script
	window.addEventListener('message', (e) => {
		if (e.data?.type === 'SPECTRA_TARGET_SPEED') {
			targetSpeed = e.data.speed;
		}
	});

	const shouldEnforce = (rate: number): number => {
		if (targetSpeed === null) return rate;
		// inv: enforce target speed if site tries to set different rate
		return Math.abs(rate - targetSpeed) > 0.005 ? targetSpeed : rate;
	};

	if (!origDesc) {
		Object.defineProperty(proto, 'playbackRate', {
			get: function () { return this[rateKey] ?? 1; },
			set: function (v) {
				const requestedRate = +v || 1;
				const newRate = shouldEnforce(requestedRate);
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
				return rateKey in this ? this[rateKey] : origGet.call(this);
			},
			set: function (v) {
				const requestedRate = +v || 1;
				const newRate = shouldEnforce(requestedRate);
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
}

// goal: optionally enhance page-created AudioContexts without changing untouched pages

interface EnhancedContext {
	ctx: AudioContext;
	booster: GainNode;
	limiter: DynamicsCompressorNode;
	destination: AudioDestinationNode;
}

type AudioContextConstructor = typeof AudioContext;

const enhancedContexts = new Set<EnhancedContext>();
let globalVolume = 1;
let enhancementActive = false;
let originalAudioContext: AudioContextConstructor | undefined;
let originalWebkitAudioContext: AudioContextConstructor | undefined;
let installedConstructor: AudioContextConstructor | undefined;

function connectRoute(item: EnhancedContext): void {
	try { item.booster.disconnect(); } catch { /* disconnected */ }
	try { item.limiter.disconnect(); } catch { /* disconnected */ }
	item.booster.gain.setTargetAtTime(enhancementActive ? globalVolume : 1, item.ctx.currentTime, 0.05);
	if (enhancementActive && globalVolume > 1) {
		item.booster.connect(item.limiter);
		item.limiter.connect(item.destination);
	} else {
		item.booster.connect(item.destination);
	}
}

function enhanceContext(ctx: AudioContext): AudioContext {
	const booster = ctx.createGain();
	const limiter = ctx.createDynamicsCompressor();
	const destination = ctx.destination;
	limiter.threshold.value = -3;
	limiter.knee.value = 0;
	limiter.ratio.value = 20;
	limiter.attack.value = 0.005;
	limiter.release.value = 0.1;
	const item = { ctx, booster, limiter, destination };
	connectRoute(item);

	Object.defineProperty(ctx, 'destination', { get: () => booster, configurable: true });
	enhancedContexts.add(item);
	const originalClose = ctx.close.bind(ctx);
	ctx.close = async () => {
		enhancedContexts.delete(item);
		return originalClose();
	};
	return ctx;
}

export function initWebAudioHijack(): () => void {
	const webkitWindow = window as Window & { webkitAudioContext?: AudioContextConstructor };
	originalAudioContext = window.AudioContext;
	originalWebkitAudioContext = webkitWindow.webkitAudioContext;
	const Original = originalAudioContext ?? originalWebkitAudioContext;
	if (!Original) return () => { };

	const SpectraAudioContext = function (this: AudioContext, options?: AudioContextOptions) {
		const ctx = new Original(options);
		return enhancementActive ? enhanceContext(ctx) : ctx;
	} as unknown as AudioContextConstructor;
	SpectraAudioContext.prototype = Original.prototype;
	installedConstructor = SpectraAudioContext;
	window.AudioContext = SpectraAudioContext;
	if (originalWebkitAudioContext) webkitWindow.webkitAudioContext = SpectraAudioContext;

	return () => {
		enhancementActive = false;
		for (const item of enhancedContexts) connectRoute(item);
		if (window.AudioContext === installedConstructor && originalAudioContext) {
			window.AudioContext = originalAudioContext;
		}
		if (webkitWindow.webkitAudioContext === installedConstructor) {
			webkitWindow.webkitAudioContext = originalWebkitAudioContext;
		}
		installedConstructor = undefined;
	};
}

export function setWebAudioEnhancementActive(active: boolean): void {
	enhancementActive = active;
	for (const item of enhancedContexts) connectRoute(item);
}

export function updateVolume(volume: number): void {
	globalVolume = Number.isFinite(volume) ? Math.max(0, Math.min(8, volume)) : 1;
	for (const item of enhancedContexts) connectRoute(item);
}

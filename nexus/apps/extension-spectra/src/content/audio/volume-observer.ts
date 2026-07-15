// perf: packed state - bit flags for boolean fields
// bit 0: muted, bit 1: settingByPlugin, bit 2: hasReceivedUserEvent
export type ElementState = {
	volume: number;
	muted: boolean;
	speed: number;
	baselineVolume: number;
	baselineMuted: boolean;
	ownedBySpectra: boolean;
	baselineSpeed: number;
	speedOwnedBySpectra: boolean;
	settingByPlugin: boolean;
	hasReceivedUserEvent: boolean;
	_flags: number;
};

const FLAG_MUTED = 1;
const FLAG_SETTING_BY_PLUGIN = 2;
const FLAG_HAS_RECEIVED_USER_EVENT = 4;

const setFlag = (flags: number, flag: number, value: boolean): number => value ? flags | flag : flags & ~flag;
const hasFlag = (flags: number, flag: number): boolean => (flags & flag) !== 0;

const elementStates = new WeakMap<HTMLMediaElement, ElementState>();
const monitoredElements = new WeakSet<HTMLMediaElement>();
const pluginResetTimers = new WeakMap<HTMLMediaElement, ReturnType<typeof setTimeout>>();
const monitorStates = new WeakMap<HTMLMediaElement, {
	volumeRafId: number;
	rateRafId: number;
	disposed: boolean;
}>();

const VOL_THRESHOLD = 0.005;
const SPEED_THRESHOLD = 0.005;

const createState = (media: HTMLMediaElement): ElementState => ({
	volume: media.volume,
	muted: media.muted,
	speed: media.playbackRate,
	baselineVolume: media.volume,
	baselineMuted: media.muted,
	ownedBySpectra: false,
	baselineSpeed: media.playbackRate,
	speedOwnedBySpectra: false,
	settingByPlugin: false,
	hasReceivedUserEvent: false,
	_flags: media.muted ? FLAG_MUTED : 0,
});

export function getElementState(media: HTMLMediaElement): ElementState {
	let state = elementStates.get(media);
	if (!state) {
		state = createState(media);
		elementStates.set(media, state);
	}
	return state;
}

export function isMonitored(media: HTMLMediaElement): boolean {
	return monitoredElements.has(media);
}

export function setSettingByPlugin(media: HTMLMediaElement, value: boolean): void {
	const state = getElementState(media);
	state.settingByPlugin = value;
	state._flags = setFlag(state._flags, FLAG_SETTING_BY_PLUGIN, value);
}

export function holdSettingByPlugin(media: HTMLMediaElement, duration = 100): void {
	setSettingByPlugin(media, true);
	const pending = pluginResetTimers.get(media);
	if (pending !== undefined) clearTimeout(pending);
	pluginResetTimers.set(media, setTimeout(() => {
		pluginResetTimers.delete(media);
		setSettingByPlugin(media, false);
	}, duration));
}

export function clearSettingByPlugin(media: HTMLMediaElement): void {
	const pending = pluginResetTimers.get(media);
	if (pending !== undefined) clearTimeout(pending);
	pluginResetTimers.delete(media);
	setSettingByPlugin(media, false);
}

export function restoreVolumeBaseline(media: HTMLMediaElement): void {
	const state = getElementState(media);
	if (!state.ownedBySpectra) return;
	media.volume = state.baselineVolume;
	media.muted = state.baselineMuted;
	state.volume = state.baselineVolume;
	state.muted = state.baselineMuted;
	state.ownedBySpectra = false;
	state._flags = setFlag(state._flags, FLAG_MUTED, state.baselineMuted);
}

export function restoreElementBaselines(media: HTMLMediaElement): void {
	const state = getElementState(media);
	restoreVolumeBaseline(media);
	if (!state.speedOwnedBySpectra) return;
	media.playbackRate = state.baselineSpeed;
	state.speed = state.baselineSpeed;
	state.speedOwnedBySpectra = false;
}

const fastAbs = (value: number): number => value < 0 ? -value : value;

export type MonitorContext = {
	getTargetVolume: () => number;
	getTargetMuted: () => boolean;
	getUserInteracted: () => boolean;
	isSyncEnabled: () => boolean;
	onNativeVolumeChange: (volume: number, muted: boolean) => void;
	onNativeSpeedChange: (speed: number) => void;
	onMediaEvent?: (type: 'volumechange' | 'ratechange') => void;
};

// post: returns a complete disposer for both listeners and every pending rAF
export function setupVolumeMonitor(media: HTMLMediaElement, context: MonitorContext): () => void {
	const state = getElementState(media);
	const runtime = { volumeRafId: 0, rateRafId: 0, disposed: false };
	monitorStates.set(media, runtime);
	monitoredElements.add(media);

	const onVolumeChange = (event: Event) => {
		context.onMediaEvent?.('volumechange');
		if (runtime.disposed || state.settingByPlugin || hasFlag(state._flags, FLAG_SETTING_BY_PLUGIN)) return;
		if (runtime.volumeRafId !== 0) return;

		runtime.volumeRafId = requestAnimationFrame(() => {
			runtime.volumeRafId = 0;
			if (runtime.disposed) return;
			if (state.ownedBySpectra) {
				state.baselineVolume = media.volume;
				state.baselineMuted = media.muted;
			}
			if (!context.getUserInteracted() && !event.isTrusted) return;

			const nextVolume = media.volume;
			const nextMuted = media.muted;
			const volumeDifference = fastAbs(nextVolume - context.getTargetVolume());
			const muteDifference = nextMuted !== context.getTargetMuted();

			if (!context.isSyncEnabled()) {
				// Before SPECTRA owns audio, website-native state is only a baseline.
				// Importing it as a stored config would turn an untouched page into an
				// active NATIVE_LITE session on the next policy pass.
				if (!context.getUserInteracted()) {
					state.volume = nextVolume;
					state.muted = nextMuted;
					state.baselineVolume = nextVolume;
					state.baselineMuted = nextMuted;
					state._flags = setFlag(state._flags, FLAG_MUTED, nextMuted);
					return;
				}
				const wasMuted = hasFlag(state._flags, FLAG_MUTED);
				if (wasMuted && !nextMuted && nextVolume > 0) {
					context.onNativeVolumeChange(-1, nextMuted);
				} else if (fastAbs(nextVolume - state.volume) > VOL_THRESHOLD) {
					context.onNativeVolumeChange(nextVolume, nextMuted);
				}
				state.volume = nextVolume;
				state.muted = nextMuted;
				state._flags = setFlag(state._flags, FLAG_MUTED, nextMuted);
				return;
			}

			const allowMute = context.getUserInteracted() || hasFlag(state._flags, FLAG_HAS_RECEIVED_USER_EVENT);
			if (volumeDifference > VOL_THRESHOLD) {
				context.onNativeVolumeChange(nextVolume, allowMute ? nextMuted : context.getTargetMuted());
				state._flags = setFlag(state._flags, FLAG_HAS_RECEIVED_USER_EVENT, true);
				state.hasReceivedUserEvent = true;
			} else if (muteDifference && allowMute) {
				context.onNativeVolumeChange(-1, nextMuted);
				state._flags = setFlag(state._flags, FLAG_HAS_RECEIVED_USER_EVENT, true);
				state.hasReceivedUserEvent = true;
			}
			state.volume = nextVolume;
			state.muted = nextMuted;
			state._flags = setFlag(state._flags, FLAG_MUTED, nextMuted);
		});
	};

	const onRateChange = () => {
		context.onMediaEvent?.('ratechange');
		if (runtime.disposed || state.settingByPlugin || hasFlag(state._flags, FLAG_SETTING_BY_PLUGIN)) return;
		if (runtime.rateRafId !== 0) return;

		runtime.rateRafId = requestAnimationFrame(() => {
			runtime.rateRafId = 0;
			if (runtime.disposed || state.settingByPlugin || hasFlag(state._flags, FLAG_SETTING_BY_PLUGIN)) return;
			const nextSpeed = media.playbackRate;
			if (!context.getUserInteracted() && !state.speedOwnedBySpectra) {
				state.speed = nextSpeed;
				state.baselineSpeed = nextSpeed;
				return;
			}
			if (state.speedOwnedBySpectra) state.baselineSpeed = nextSpeed;
			if (fastAbs(nextSpeed - state.speed) < SPEED_THRESHOLD) return;
			context.onNativeSpeedChange(nextSpeed);
			state.speed = nextSpeed;
		});
	};

	media.addEventListener('volumechange', onVolumeChange);
	media.addEventListener('ratechange', onRateChange);

	return () => {
		if (runtime.disposed) return;
		runtime.disposed = true;
		media.removeEventListener('volumechange', onVolumeChange);
		media.removeEventListener('ratechange', onRateChange);
		if (runtime.volumeRafId !== 0) cancelAnimationFrame(runtime.volumeRafId);
		if (runtime.rateRafId !== 0) cancelAnimationFrame(runtime.rateRafId);
		runtime.volumeRafId = 0;
		runtime.rateRafId = 0;
		monitorStates.delete(media);
		monitoredElements.delete(media);
		clearSettingByPlugin(media);
	};
}

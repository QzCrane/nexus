// goal: minimal document-start boundary for messages, native observations, and five defaults

import {
	SPECTRA_CONTENT_BOOTSTRAP_REVISION,
	SPECTRA_PROTOCOL_VERSION,
	bootstrapRpcFailure,
	bootstrapRpcSuccess,
	isBootstrapHelloResponse,
	isBootstrapInboundRequest,
	resolveSpectraDefaultHotkeyAction,
	type BootstrapInboundRequest,
	type SpectraDefaultHotkeyAction,
} from '@nexus/contracts/bootstrap';
import {
	getContentBootstrapState,
	setContentBootstrapState,
	type ContentBootstrapState,
} from '../../shared/content-runtime';
import {
	isExtensionContextValid,
	runWithValidExtensionContext,
} from './extension-context';
import { readPageMediaField } from '../logic/page-media-bridge';
import {
	nextScalarGestureId,
	publishDefaultScalarGesture,
	publishHotkeyActualFeedback,
	publishPhysicalHotkeyRelease,
} from '../input/default-scalar-gesture';
import {
	isEditableHotkeyEvent,
	subscribeDocumentStartPhysicalHotkeyRelease,
} from '../input/hotkey-event';

type BootstrapReadRequest = Extract<BootstrapInboundRequest, {
	type: 'spectra.control.actual.read';
}>;
type BootstrapReleaseRequest = Extract<BootstrapInboundRequest, {
	type: 'spectra.content.runtime.release';
}>;

function claimHotkeyEvent(event: KeyboardEvent): void {
	event.preventDefault();
	event.stopImmediatePropagation();
}

function readPageActual(
	element: HTMLMediaElement,
	field: 'volumeBase' | 'mediaMuted' | 'speed',
): number | boolean | null {
	try { return readPageMediaField(element, field); }
	catch { return null; }
}

const PASSIVE_FIELDS = new Set([
	'volumeBase', 'mediaMuted', 'speed', 'preservePitch', 'playing',
	'currentTime', 'loop', 'pip', 'fullscreen',
]);

const previous = getContentBootstrapState();
if (previous?.bootstrapRevision !== SPECTRA_CONTENT_BOOTSTRAP_REVISION) previous?.dispose();

if (!getContentBootstrapState()) {
	let disposed = false;
	let observationsReady = false;
	let observationInFlight = false;
	const activeDefaultScalarKeys = new Map<string, {
		action: SpectraDefaultHotkeyAction;
		gesture: string;
		repeated: boolean;
	}>();
	type BootstrapNativeObservation = {
		patch: import('@nexus/contracts').ControlPatch;
		observedStrategies: import('@nexus/contracts').ControlNativeObservationStrategies;
	};
	let pendingObservation: BootstrapNativeObservation | null = null;
	let lastReportedMediaPresence: boolean | null = null;
	// Page-entry solidification: the bootstrap is the only owner present before
	// the deferred runtime loads, so the first media volume event probes the
	// page controller read-only and records a positive amplified-scale verdict.
	// Negative verdicts stay unrecorded here — the bridge injection may still be
	// racing this event — and are solidified later by the runtime's media
	// registration probe or the coordinator's one-shot fallback probe.
	let pageScaleConfirmed = false;
	const reportPageScale = (element: HTMLMediaElement): void => {
		if (pageScaleConfirmed || disposed) return;
		if (readPageActual(element, 'volumeBase') === null) return;
		pageScaleConfirmed = true;
		void sendBootstrapRequest('spectra.audio.page-scale.record', { supported: true }, state.dispose)
			.catch(() => undefined);
	};

	const defaultHotkeyAction = (event: KeyboardEvent): SpectraDefaultHotkeyAction | null => {
		if (!event.isTrusted || event.defaultPrevented) return null;
		const action = resolveSpectraDefaultHotkeyAction(event);
		if (action === null) return null;
		if (isEditableHotkeyEvent(event)) return null;
		return action;
	};

	const sendDefaultScalarPhase = (
		active: { action: SpectraDefaultHotkeyAction; gesture: string; repeated: boolean },
		phase: 'press' | 'release',
	): Promise<void> => sendBootstrapRequest(
			'spectra.content.default-hotkey.trigger',
			{
				action: active.action,
				gesture: active.gesture,
				phase,
				repeated: active.repeated,
			},
			state.dispose,
		).then(() => undefined);

	const acceptDefaultHotkeyKeydown = (
		event: KeyboardEvent,
		action: SpectraDefaultHotkeyAction,
	): void => {
		if (disposed) return;
		claimHotkeyEvent(event);
		let active = activeDefaultScalarKeys.get(event.code);
		if (!active) {
			active = {
				action,
				gesture: nextScalarGestureId('default'),
				repeated: false,
			};
			activeDefaultScalarKeys.set(event.code, active);
		} else {
			active.repeated = true;
			if (active.action === 'volume_mute') return;
		}
		publishDefaultScalarGesture({ ...active, phase: 'press' });
		void sendDefaultScalarPhase(active, 'press').catch(() => undefined);
	};

	const releaseDefaultScalarGesture = (
		active: { action: SpectraDefaultHotkeyAction; gesture: string; repeated: boolean },
	): void => {
		publishDefaultScalarGesture({ ...active, phase: 'release' });
		void sendDefaultScalarPhase(active, 'release')
			.catch(() => undefined)
			.finally(() => publishDefaultScalarGesture({ ...active, phase: 'settled' }));
	};

	const releaseDefaultScalarKeys = (): void => {
		for (const active of activeDefaultScalarKeys.values()) {
			releaseDefaultScalarGesture(active);
		}
		activeDefaultScalarKeys.clear();
	};

	const releaseDefaultHotkeyKeyup = (
		event: KeyboardEvent,
	): void => {
		const active = activeDefaultScalarKeys.get(event.code);
		if (active) {
			claimHotkeyEvent(event);
			activeDefaultScalarKeys.delete(event.code);
			releaseDefaultScalarGesture(active);
			return;
		}
		if (!event.code.startsWith('Alt') || activeDefaultScalarKeys.size === 0) return;
		claimHotkeyEvent(event);
		releaseDefaultScalarKeys();
	};

	const onDefaultHotkeyKeydown = (event: KeyboardEvent): void => {
		const action = defaultHotkeyAction(event);
		if (action !== null) acceptDefaultHotkeyKeydown(event, action);
	};

	const onDefaultHotkeyKeyup = (event: KeyboardEvent): void => {
		if (!event.isTrusted
			|| !(activeDefaultScalarKeys.has(event.code)
				|| event.code.startsWith('Alt') && activeDefaultScalarKeys.size > 0)) return;
		releaseDefaultHotkeyKeyup(event);
	};

	const onVisibilityChange = (): void => {
		if (document.hidden) releaseDefaultScalarKeys();
	};

	const readBootstrapObservation = (
		element: HTMLMediaElement,
		eventType: 'volumechange' | 'ratechange',
	): BootstrapNativeObservation | null => {
		if (eventType === 'volumechange') {
			const pageVolume = readPageActual(element, 'volumeBase');
			const pageMuted = readPageActual(element, 'mediaMuted');
			return {
				patch: {
					volumeBase: typeof pageVolume === 'number'
						? pageVolume
						: Math.round(element.volume * 10_000) / 100,
					mediaMuted: typeof pageMuted === 'boolean' ? pageMuted : element.muted,
				},
				observedStrategies: {
					volumeBase: pageVolume === null ? 'dom-native' : 'page-native',
					mediaMuted: pageMuted === null ? 'dom-native' : 'page-native',
				},
			};
		}
		if (!('preservesPitch' in element)) return null;
		const pageSpeed = readPageActual(element, 'speed');
		return {
			patch: {
				speed: typeof pageSpeed === 'number' ? pageSpeed : element.playbackRate,
				preservePitch: element.preservesPitch,
			},
			observedStrategies: {
				speed: pageSpeed === null ? 'dom-native' : 'page-native',
				preservePitch: 'dom-native',
			},
		};
	};

	const readNativeActual = (
		request: import('@nexus/contracts').ControlReadRequest,
	): import('@nexus/contracts').ControlReadResult | null => {
		const videoOnly = request.fields.every((field) => field === 'pip' || field === 'fullscreen');
		const media = [...document.querySelectorAll<HTMLMediaElement>('video,audio')]
			.filter((element) => !videoOnly || element instanceof HTMLVideoElement)
			.filter((element) => element.isConnected);
		const fullscreen = document.fullscreenElement;
		const element = media.find((candidate) => document.pictureInPictureElement === candidate)
			?? media.find((candidate) => fullscreen === candidate
				|| fullscreen instanceof Element && fullscreen.contains(candidate))
			?? media.find((candidate) => !candidate.paused && !candidate.ended)
			?? media[0];
		if (!element) return null;
		const patch: import('@nexus/contracts').ControlPatch = {};
		const observedStrategies: import('@nexus/contracts').ControlNativeObservationStrategies = {};
		for (const field of request.fields) {
			let actual: unknown;
			switch (field) {
				case 'volumeBase': {
					const pageValue = readPageActual(element, field);
					actual = pageValue ?? Math.round(element.volume * 10_000) / 100;
					observedStrategies.volumeBase = pageValue === null ? 'dom-native' : 'page-native';
					break;
				}
				case 'mediaMuted': {
					const pageValue = readPageActual(element, field);
					actual = pageValue ?? element.muted;
					observedStrategies.mediaMuted = pageValue === null ? 'dom-native' : 'page-native';
					break;
				}
				case 'speed': {
					const pageValue = readPageActual(element, field);
					actual = pageValue ?? element.playbackRate;
					observedStrategies.speed = pageValue === null ? 'dom-native' : 'page-native';
					break;
				}
				case 'preservePitch':
					if ('preservesPitch' in element) {
						actual = element.preservesPitch;
						observedStrategies.preservePitch = 'dom-native';
					}
					break;
				case 'playing': actual = !element.paused; observedStrategies.playing = 'dom-native'; break;
				case 'currentTime': actual = element.currentTime; observedStrategies.currentTime = 'dom-native'; break;
				case 'loop': actual = element.loop; observedStrategies.loop = 'dom-native'; break;
				case 'pip': actual = document.pictureInPictureElement === element; observedStrategies.pip = 'dom-native'; break;
				case 'fullscreen': actual = fullscreen === element
					|| fullscreen instanceof Element && fullscreen.contains(element);
					observedStrategies.fullscreen = 'dom-native';
					break;
			}
			if (actual !== undefined) (patch as Record<string, unknown>)[field] = actual;
		}
		return Object.keys(patch).length > 0 ? { target: null, patch, observedStrategies } : null;
	};

	// Media presence reporting turns a plain document into a durable background
	// fact without any chrome.scripting probe: every manifest-injected bootstrap
	// establishes the found/no-media fact event-driven, so a popup inventory read
	// never waits for probes on ordinary media tabs. The runtime owns reporting
	// once it loads (state.ready); the bootstrap covers every other document
	// lifetime and re-syncs on runtime release. The revision counter is shared
	// with the runtime through the isolated-world bootstrap state, so the
	// background's per-document monotonic gate never drops either producer.
	//
	// Detection stays passive and bounded like the rest of the bootstrap: no
	// document-wide topology observation. The initial DOMContentLoaded snapshot
	// covers media in the parsed HTML, pageshow re-reads a bfcache restore, and
	// the media lifecycle listeners below only fire when a real media element
	// emits play/pause/metadata events — the signals every controllable media tab
	// produces. The background's convergence sweep is the fallback for media that
	// never emits an event and is not present in the initial document.
	const MEDIA_PRESENCE_EVENTS = [
		'play', 'pause', 'playing', 'loadedmetadata', 'durationchange', 'emptied',
	] as const;
	const onMediaPresenceSignal = (event: Event): void => {
		if (!(event.target instanceof HTMLMediaElement)) return;
		reportMediaPresence();
	};

	const reportMediaPresence = (force = false): void => {
		if (disposed || state.ready) return;
		const current = document.querySelector('video,audio') !== null;
		// A no-media verdict is only conclusive for this top-level document. When
		// the page hosts subframes (same- or cross-origin), the media may live in
		// one of them, which this isolated-world bootstrap cannot read. Flag that
		// inconclusiveness so the background leaves the tab probeable instead of
		// solidifying a durable no-media fact that would hide nested media forever.
		const hasSubframes = document.querySelector('iframe,frame') !== null;
		if (!force && current === lastReportedMediaPresence) return;
		lastReportedMediaPresence = current;
		const nextRevision = (state.mediaReportRevision ?? 0) + 1;
		state.mediaReportRevision = nextRevision;
		void sendBootstrapRequest('spectra.tab.media.report', {
			hasMediaElement: current,
			hasSubframes,
			userInteracted: false,
			reportRevision: nextRevision,
		}, state.dispose).catch(() => undefined);
	};

	const onMediaDomReady = (): void => {
		if (disposed) return;
		reportMediaPresence();
	};

	const onMediaPageShow = (): void => {
		if (disposed) return;
		// bfcache restore re-runs pageshow without re-injecting the bootstrap:
		// force a fresh presence read so a restored document cannot keep a stale
		// durable fact in the background inventory.
		lastReportedMediaPresence = null;
		reportMediaPresence();
	};

	let unsubscribePhysicalHotkeyRelease = (): void => undefined;
	const state: ContentBootstrapState = {
		bootstrapRevision: SPECTRA_CONTENT_BOOTSTRAP_REVISION,
		runtimeRevision: null as string | null,
		ready: false,
		dispose() {
			if (disposed) return;
			disposed = true;
			releaseDefaultScalarKeys();
			pendingObservation = null;
			document.removeEventListener('DOMContentLoaded', onMediaDomReady);
			window.removeEventListener('pageshow', onMediaPageShow);
			for (const type of MEDIA_PRESENCE_EVENTS) {
				document.removeEventListener(type, onMediaPresenceSignal, true);
			}
			document.removeEventListener('volumechange', onNativeMediaChange, true);
			document.removeEventListener('ratechange', onNativeMediaChange, true);
			unsubscribePhysicalHotkeyRelease();
			window.removeEventListener('keydown', onDefaultHotkeyKeydown, true);
			window.removeEventListener('keyup', onDefaultHotkeyKeyup, true);
			document.removeEventListener('visibilitychange', onVisibilityChange);
			window.removeEventListener('blur', releaseDefaultScalarKeys);
			window.removeEventListener('pagehide', onPageHide);
			delete state.disposeRuntime;
			if (getContentBootstrapState() === state) setContentBootstrapState(undefined);
			try {
				if (isExtensionContextValid()) chrome.runtime.onMessage.removeListener(onMessage);
			} catch (error) {
				console.debug(
					'[SPECTRA] Runtime listener unavailable during bootstrap disposal',
					error,
				);
			}
		},
	};

	const drainObservation = (): void => {
		if (disposed || observationInFlight || !pendingObservation) return;
		if (!observationsReady || state.ready || state.disposeRuntime) {
			if (state.ready || state.disposeRuntime) pendingObservation = null;
			return;
		}
		const observation = pendingObservation;
		pendingObservation = null;
		observationInFlight = true;
		void sendBootstrapRequest('spectra.control.intent.submit', {
			source: 'page',
			requestedCoverage: 'active-target',
			target: null,
			patch: observation.patch,
			observedStrategies: observation.observedStrategies,
		}, state.dispose).catch(() => undefined).finally(() => {
			observationInFlight = false;
			drainObservation();
		});
	};

	const onNativeMediaChange = (event: Event): void => {
		if (disposed || state.disposeRuntime) return;
		const element = event.composedPath().find(
			(candidate): candidate is HTMLMediaElement => candidate instanceof HTMLMediaElement,
		);
		if (!element?.isConnected) return;
		// Native media events double as presence evidence for media that never
		// plays or loads metadata (volume-only elements).
		reportMediaPresence();
		// The first media volume event is the page-entry audio detection moment;
		// solidify the amplified-controller verdict before the runtime loads.
		if (event.type === 'volumechange') reportPageScale(element);
		if (state.ready) return;
		const observation = readBootstrapObservation(
			element,
			event.type as 'volumechange' | 'ratechange',
		);
		if (!observation) return;
		pendingObservation = pendingObservation
			? {
				patch: { ...pendingObservation.patch, ...observation.patch },
				observedStrategies: {
					...pendingObservation.observedStrategies,
					...observation.observedStrategies,
				},
			}
			: observation;
		drainObservation();
	};

	const onMessage = (
		message: unknown,
		sender: chrome.runtime.MessageSender,
		sendResponse: (response?: unknown) => void,
	): boolean => {
		if (disposed) return false;
		if (!isExtensionContextValid()) {
			state.dispose();
			return false;
		}
		if (sender.id && sender.id !== chrome.runtime.id) return false;
		if (!message || typeof message !== 'object') return false;
		const candidate = message as { protocolVersion?: unknown; type?: unknown };
		if (candidate.protocolVersion !== SPECTRA_PROTOCOL_VERSION || typeof candidate.type !== 'string') {
			return false;
		}
		if (candidate.type === 'spectra.hotkey.target.feedback') {
			publishHotkeyActualFeedback(message);
			return false;
		}
		if (candidate.type === 'spectra.content.runtime.status') {
			if (!isBootstrapInboundRequest(message)) {
				sendResponse(bootstrapRpcFailure('invalid_request', 'Malformed content runtime status request'));
				return false;
			}
			sendResponse(bootstrapRpcSuccess({
				bootstrapRevision: state.bootstrapRevision,
				runtimeRevision: state.runtimeRevision,
				ready: state.ready,
				ownedSources: state.getOwnedSources?.() ?? [],
			}));
			return false;
		}
		if (candidate.type === 'spectra.control.actual.read' && !state.ready) {
			if (!isBootstrapInboundRequest(message)) {
				sendResponse(bootstrapRpcFailure('invalid_request', 'Malformed native observation request'));
				return false;
			}
			const request = message as BootstrapReadRequest;
			if (request.payload.target !== null
				|| !request.payload.fields.every((field) => PASSIVE_FIELDS.has(field))) {
				sendResponse(bootstrapRpcFailure(
					'content_runtime_not_loaded',
					'The document runtime is required for a target-bound or augmented read',
					true,
				));
				return false;
			}
			const result = readNativeActual(request.payload);
			if (!result) {
				sendResponse(bootstrapRpcFailure('capability-unavailable', 'No observable native media state'));
				return false;
			}
			sendResponse(bootstrapRpcSuccess(result));
			return false;
		}
		if (candidate.type === 'spectra.content.runtime.release' && state.ready) {
			if (!isBootstrapInboundRequest(message)) {
				sendResponse(bootstrapRpcFailure('invalid_request', 'Malformed content runtime release'));
				return false;
			}
			const request = message as BootstrapReleaseRequest;
			if (request.payload.runtimeRevision !== state.runtimeRevision) {
				sendResponse(bootstrapRpcFailure('runtime_revision_mismatch', 'Content runtime release revision is stale'));
				return false;
			}
			void (state.disposeRuntime?.() ?? Promise.resolve()).then(() => {
				state.runtimeRevision = null;
				state.ready = false;
				// The runtime is gone: the bootstrap resumes media-presence ownership.
				// Re-read the live document so the fact cannot stay stale behind the
				// runtime's last revision; the media lifecycle listeners never stop
				// firing while the bootstrap lives, so later media keeps reporting.
				lastReportedMediaPresence = null;
				reportMediaPresence();
				sendResponse(bootstrapRpcSuccess({ accepted: true as const }));
		}, (error: unknown) => sendResponse(bootstrapRpcFailure(
				'runtime_release_failed',
				error instanceof Error ? error.message : String(error),
				true,
			)));
			return true;
		}
		return false;
	};

	const onPageHide = (): void => {
		releaseDefaultScalarKeys();
		if (!state.runtimeRevision) return;
		void sendBootstrapRequest('spectra.content.runtime.release', {
			runtimeRevision: state.runtimeRevision,
		}, state.dispose);
	};

	setContentBootstrapState(state);
	chrome.runtime.onMessage.addListener(onMessage);
	document.addEventListener('volumechange', onNativeMediaChange, true);
	document.addEventListener('ratechange', onNativeMediaChange, true);
	// Media lifecycle signals keep the durable presence fact event-driven without
	// any document-wide observation: these events only originate from real media
	// elements, so the bootstrap stays passive and yields to the heavy runtime.
	for (const type of MEDIA_PRESENCE_EVENTS) {
		document.addEventListener(type, onMediaPresenceSignal, true);
	}
	// This document-start observer is the release authority for lazily mounted
	// site hotkeys. It publishes only isolated-world cleanup identity and does
	// not claim, cancel, or otherwise mutate the website's keyup event.
	unsubscribePhysicalHotkeyRelease = subscribeDocumentStartPhysicalHotkeyRelease(
		(event) => publishPhysicalHotkeyRelease({ code: event.code }),
	);
	// The five shipped chords are reserved extension commands. Claiming them at
	// document_start keeps the first physical press out of page handlers that
	// would otherwise clamp volume to their native 0-100 range. Configured site
	// bindings remain website-first in the heavy hotkey listener.
	window.addEventListener('keydown', onDefaultHotkeyKeydown, true);
	window.addEventListener('keyup', onDefaultHotkeyKeyup, true);
	document.addEventListener('visibilitychange', onVisibilityChange);
	window.addEventListener('blur', releaseDefaultScalarKeys);
	window.addEventListener('pagehide', onPageHide, { once: true });
	window.addEventListener('pageshow', onMediaPageShow);
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', onMediaDomReady);
	} else {
		// The document was already loaded when this bootstrap instance ran (warm
		// re-injection): report the current presence immediately.
		onMediaDomReady();
	}

	void sendBootstrapRequest('spectra.content.bootstrap.hello', {
		bootstrapRevision: SPECTRA_CONTENT_BOOTSTRAP_REVISION,
	}, state.dispose).then((response) => {
		if (!isBootstrapHelloResponse(response) || disposed) return;
		state.runtimeRevision = response.data.runtimeRevision;
		state.ready = response.data.runtimeRevision !== null;
		observationsReady = true;
		drainObservation();
		// The HELLO verdict decides the media reporter owner for this document: a
		// loaded runtime owns reporting (reportMediaPresence yields via state.ready),
		// otherwise the bootstrap keeps the fact warm through lifecycle events.
	}).catch(() => undefined);
}

function sendBootstrapRequest(
	type: 'spectra.content.bootstrap.hello'
		| 'spectra.content.runtime.release'
		| 'spectra.content.default-hotkey.trigger'
		| 'spectra.control.intent.submit'
		| 'spectra.audio.page-scale.record'
		| 'spectra.tab.media.report',
	payload: { bootstrapRevision: string }
		| { runtimeRevision: string }
		| {
			action: SpectraDefaultHotkeyAction;
			phase: 'press' | 'release';
			gesture: string;
			repeated: boolean;
		}
		| { supported: boolean }
		| { hasMediaElement: boolean; hasSubframes?: boolean; userInteracted: boolean; reportRevision: number }
		| import('@nexus/contracts').ControlSubmitRequest,
	onInvalidated?: () => void,
): Promise<unknown | undefined> {
	return runWithValidExtensionContext(() => chrome.runtime.sendMessage({
		protocolVersion: SPECTRA_PROTOCOL_VERSION,
		requestId: crypto.randomUUID(),
		type,
		payload,
	}), onInvalidated);
}

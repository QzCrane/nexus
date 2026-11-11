// goal: minimal document-start boundary for messages, native observations, and five defaults

import {
	SPECTRA_CONTENT_BOOTSTRAP_REVISION,
	SPECTRA_PROTOCOL_VERSION,
	bootstrapRpcFailure,
	createSpectraRequest,
	bootstrapRpcSuccess,
	isBootstrapHelloResponse,
	isBootstrapInboundRequest,
	isSpectraContentInvocationGrantedMessage,
	resolveSpectraDefaultHotkeyAction,
	type BootstrapInboundRequest,
	type SpectraDefaultHotkeyAction,
} from '@nexus/contracts/bootstrap';
import {
	getContentBootstrapState,
	claimMediaObservationEpoch,
	needsManifestVolumeCommand,
	setContentBootstrapState,
	type ContentBootstrapState,
} from '../../shared/content-runtime';
import {
	isExtensionContextValid,
	runWithValidExtensionContext,
} from './extension-context';
import { createSiteSpeedLabelProjection, readPageMediaField } from '../logic/page-media-bridge';
import { hasMediaSurface } from '../../shared/media-presence';
import { isLiveMedia } from '../../shared/media-live';
import { getPausedAt, updatePausedAt } from '../utils/pause-tracker';
import { chooseInitialMedia } from './media-registry';
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

/**
 * A bootstrap request is a fact about this document, and delivering it is an
 * obligation: only an acknowledged background response proves the fact landed.
 */
function isAcceptedBootstrapResponse(response: unknown): boolean {
	return !!response && typeof response === 'object' && (response as { ok?: unknown }).ok === true;
}

const previous = getContentBootstrapState();
if (previous?.bootstrapRevision !== SPECTRA_CONTENT_BOOTSTRAP_REVISION) previous?.dispose();

if (!getContentBootstrapState()) {
	let disposed = false;
	const speedLabels = createSiteSpeedLabelProjection();
	let observationsReady = false;
	let observationInFlight = false;
	const activeDefaultScalarKeys = new Map<string, {
		action: SpectraDefaultHotkeyAction;
		gesture: string;
		repeated: boolean;
	}>();
	let pendingObservation = false;
	const observationOwner = crypto.randomUUID();
	let observationEpoch = 0;
	let observationRevision = 0;
	let lastReportedMediaPresence: boolean | null = null;
	let lastReportedPlayback: boolean | null = null;
	// A media fact and a media sample are obligations, not one-shot
	// notifications. The first script of a redirected route runs while the
	// background may still be resolving which document the tab now owns, and a
	// rejected report or observation must converge on its own: withdrawing the
	// dedupe latch and retrying a bounded number of times is what keeps the
	// observation owner arriving without an unrelated pause/play or the Popup.
	const DELIVERY_RETRY_DELAYS_MS = [150, 400, 900, 1_800] as const;
	// HELLO is the observation-ownership handshake. A routed document (the same
	// tab following a 302 from a feed to a live room) can lose its identity race
	// once, and the route may still be committing when this script runs, so the
	// handshake gets a longer, independent retry horizon than a media sample.
	const HELLO_RETRY_DELAYS_MS = [150, 400, 900, 1_800, 3_000, 5_000] as const;
	let presenceRetryAttempt = 0;
	let presenceRetryTimer: ReturnType<typeof setTimeout> | null = null;
	let presenceInFlight = false;
	let helloRetryAttempt = 0;
	let helloRetryTimer: ReturnType<typeof setTimeout> | null = null;
	let helloInFlight = false;
	let observationRetryAttempt = 0;
	let observationRetryTimer: ReturnType<typeof setTimeout> | null = null;
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

	// Only the press that leaves the native range needs a fresh invocation: at
	// the ceiling, +10 becomes a Capture step, and a cold document needs the
	// `activeTab` grant Chrome attaches to the manifest `volume_up` command.
	// Once this document has been invoked (Popup, a delivered command, or an
	// earlier Capture session), the grant lasts until navigation, so the press
	// stays on the content path even after Capture stops. Below the ceiling the
	// press is always page-owned, which keeps the key working when the command
	// is unavailable or the page consumes it.
	const volumeUpNeedsCommand = (): boolean => {
		try {
			const media = chooseInitialMedia(
				Array.from(document.querySelectorAll<HTMLMediaElement>('video,audio')),
			);
			return needsManifestVolumeCommand(state.extensionInvoked === true, media?.volume ?? null);
		} catch {
			return false;
		}
	};

	const onDefaultHotkeyKeydown = (event: KeyboardEvent): void => {
		const action = defaultHotkeyAction(event);
		if (action === null) return;
		if (action === 'volume_up' && volumeUpNeedsCommand()) {
			// Leave the default action to the browser so the manifest command can
			// run, but stop page handlers from cancelling the chord first.
			event.stopImmediatePropagation();
			return;
		}
		acceptDefaultHotkeyKeydown(event, action);
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

	const readNativeActual = (
		request: import('@nexus/contracts').ControlReadRequest,
	): import('@nexus/contracts').ControlReadResult | null => {
		const videoOnly = request.fields.every((field) => field === 'pip' || field === 'fullscreen');
		const media = [...document.querySelectorAll<HTMLMediaElement>('video,audio')]
			.filter((element) => !videoOnly || element instanceof HTMLVideoElement)
			.filter((element) => element.isConnected);
		const fullscreen = document.fullscreenElement;
		const element = chooseInitialMedia(media, videoOnly ? 'video' : 'media');
		if (!element) return null;
		const patch: import('@nexus/contracts').ControlPatch = {};
		const observedStrategies: import('@nexus/contracts').ControlObservationStrategies = {};
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
					actual = element.playbackRate;
					observedStrategies.speed = 'dom-native';
					break;
				}
				case 'preservePitch':
					if ('preservesPitch' in element) {
						actual = element.preservesPitch;
						observedStrategies.preservePitch = 'dom-native';
					}
					break;
				case 'playing': actual = !element.paused; observedStrategies.playing = 'dom-native'; break;
				case 'currentTime': actual = Number.isFinite(element.currentTime) && element.currentTime >= 0 ? element.currentTime : 0; observedStrategies.currentTime = 'dom-native'; break;
				case 'loop': actual = element.loop; observedStrategies.loop = 'dom-native'; break;
				case 'pip': actual = document.pictureInPictureElement === element; observedStrategies.pip = 'dom-native'; break;
				case 'fullscreen': actual = fullscreen === element
					|| fullscreen instanceof Element && fullscreen.contains(element);
					observedStrategies.fullscreen = 'dom-native';
					break;
			}
			if (actual !== undefined) (patch as Record<string, unknown>)[field] = actual;
		}
		return Object.keys(patch).length > 0
			? { target: null, patch, observedStrategies, live: isLiveMedia(element) }
			: null;
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
	// Detection stays passive and bounded. The initial DOMContentLoaded snapshot
	// covers media in the parsed HTML; pageshow re-reads a bfcache restore; the
	// lifecycle listeners fire when a media element gains a source, starts
	// playing, or advances its clock, including a player the page mounts after
	// load and only then connects to its broadcast (`loadstart`). Document-wide
	// DOM observation belongs to the heavy runtime's registry, never to this
	// boundary. These are the moments a document can become or stop being a media
	// tab, which is why this report - not a background sweep - is the inventory's
	// sole source of truth about a tab the user is not looking at.
	//
	// A report and a page observation are obligations that expire only when the
	// background acknowledges them. The first script of a redirected route runs
	// while the tab may still be resolving its new document identity, so a
	// rejected delivery withdraws its dedupe latch and retries a bounded number
	// of times; otherwise one lost race would leave this document with no
	// observation owner until an unrelated pause/play or the Popup.
	const MEDIA_PRESENCE_EVENTS = [
		'loadstart', 'play', 'pause', 'playing', 'loadedmetadata', 'durationchange', 'emptied',
		// A player that was played before it was mounted emits nothing else after the
		// insertion; its playback clock still reaches the document, which is the same
		// proof of an active media surface without observing the DOM.
		'timeupdate',
	] as const;
	const onMediaPresenceSignal = (event: Event): void => {
		if (!(event.target instanceof HTMLMediaElement)) return;
		speedLabels.syncMedia(event.target);
		reportMediaPresence();
	};

	const schedulePresenceRetry = (): void => {
		if (disposed || state.ready || presenceRetryTimer !== null
			|| presenceRetryAttempt >= DELIVERY_RETRY_DELAYS_MS.length) return;
		const delay = DELIVERY_RETRY_DELAYS_MS[presenceRetryAttempt];
		presenceRetryAttempt += 1;
		presenceRetryTimer = setTimeout(() => {
			presenceRetryTimer = null;
			reportMediaPresence();
		}, delay);
	};

	const reportMediaPresence = (force = false): void => {
		if (disposed || state.ready) return;
		// Presence names the document's media surface, not its playback: see
		// shared/media-presence.ts. A bare player shell with no resource is not a
		// media tab, and reporting it as one puts a card in the Popup for a page
		// with nothing to control.
		const current = hasMediaSurface(document);
		const playing = [...document.querySelectorAll<HTMLMediaElement>('video,audio')].some((media) => !media.paused && !media.ended);
		updatePausedAt(playing, current);
		if (!force && current === lastReportedMediaPresence && playing === lastReportedPlayback) return;
		// A live page emits `timeupdate` several times a second. While a report is
		// in flight its outcome is still unknown, so sending another copy would only
		// queue duplicate ownership obligations behind the same document identity.
		if (presenceInFlight) return;
		lastReportedMediaPresence = current;
		lastReportedPlayback = playing;
		const nextRevision = (state.mediaReportRevision ?? 0) + 1;
		state.mediaReportRevision = nextRevision;
		presenceInFlight = true;
		void sendBootstrapRequest('spectra.tab.media.report', {
			hasMediaElement: current,
			userInteracted: false,
			reportRevision: nextRevision,
			playing,
			pausedAt: getPausedAt(),
		}, state.dispose).then((response) => {
			if (isAcceptedBootstrapResponse(response)) {
				presenceRetryAttempt = 0;
				if (presenceRetryTimer !== null) {
					clearTimeout(presenceRetryTimer);
					presenceRetryTimer = null;
				}
				return;
			}
			// The durable fact never landed (a stale document identity while the
			// route settles). Withdraw the dedupe latch so the retry is a real
			// report, and keep trying without waiting for a playback change.
			lastReportedMediaPresence = null;
			lastReportedPlayback = null;
			schedulePresenceRetry();
		}).catch(() => {
			lastReportedMediaPresence = null;
			lastReportedPlayback = null;
			schedulePresenceRetry();
		}).finally(() => {
			presenceInFlight = false;
		});
	};

	const onMediaDomReady = (): void => {
		if (disposed) return;
		speedLabels.scan();
		reportMediaPresence();
	};

	const onMediaPageShow = (): void => {
		if (disposed) return;
		speedLabels.scan();
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
		mediaReportRevision: previous?.mediaReportRevision ?? 0,
		mediaPausedAt: previous?.mediaPausedAt ?? null,
		extensionInvoked: previous?.extensionInvoked ?? false,
		mediaOwnerEpoch: previous?.mediaOwnerEpoch ?? 0,
		dispose() {
			if (disposed) return;
			disposed = true;
			speedLabels.dispose();
			releaseDefaultScalarKeys();
			pendingObservation = false;
			if (presenceRetryTimer !== null) clearTimeout(presenceRetryTimer);
			presenceRetryTimer = null;
			presenceRetryAttempt = 0;
			presenceInFlight = false;
			if (helloRetryTimer !== null) clearTimeout(helloRetryTimer);
			helloRetryTimer = null;
			helloRetryAttempt = 0;
			helloInFlight = false;
			if (observationRetryTimer !== null) clearTimeout(observationRetryTimer);
			observationRetryTimer = null;
			observationRetryAttempt = 0;
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

	const scheduleObservationRetry = (): void => {
		if (disposed || state.runtimeObservesMedia || observationRetryTimer !== null
			|| observationRetryAttempt >= DELIVERY_RETRY_DELAYS_MS.length) return;
		const delay = DELIVERY_RETRY_DELAYS_MS[observationRetryAttempt];
		observationRetryAttempt += 1;
		observationRetryTimer = setTimeout(() => {
			observationRetryTimer = null;
			pendingObservation = true;
			drainObservation();
		}, delay);
	};

	const drainObservation = (): void => {
		if (disposed || observationInFlight || !pendingObservation) return;
		if (!observationsReady || state.runtimeObservesMedia) {
			if (state.runtimeObservesMedia) pendingObservation = false;
			return;
		}
		pendingObservation = false;
		// The queue retains a sampling obligation, never old values. Read both
		// complete bootstrap groups from the canonical selected media together.
		// No registry target is claimed: each stateless sample is a new selection.
		const observation = readNativeActual({ target: null,
			fields: ['volumeBase', 'mediaMuted', 'speed', 'preservePitch'] });
		if (!observation) return;
		if (observationEpoch === 0 || observationEpoch !== state.mediaOwnerEpoch) {
			observationEpoch = claimMediaObservationEpoch();
			observationRevision = 0;
		}
		const revision = ++observationRevision;
		observationInFlight = true;
		void sendBootstrapRequest('spectra.control.intent.submit', {
			source: 'page',
			requestedCoverage: 'active-target',
			target: null,
			patch: observation.patch,
			observedStrategies: observation.observedStrategies,
			mediaObservation: { owner: observationOwner, epoch: observationEpoch, selection: revision, revision },
		}, state.dispose).then((response) => {
			if (isAcceptedBootstrapResponse(response)) {
				observationRetryAttempt = 0;
				if (observationRetryTimer !== null) {
					clearTimeout(observationRetryTimer);
					observationRetryTimer = null;
				}
				return;
			}
			// An observation rejected while the route settles is still the current
			// truth of this document; keep the obligation instead of waiting for
			// the viewer's next gesture.
			scheduleObservationRetry();
		}).catch(() => {
			scheduleObservationRetry();
		}).finally(() => {
			observationInFlight = false;
			drainObservation();
		});
	};

	const onNativeMediaChange = (event: Event): void => {
		if (disposed) return;
		const element = event.composedPath().find(
			(candidate): candidate is HTMLMediaElement => candidate instanceof HTMLMediaElement,
		);
		if (!element?.isConnected) return;
		if (event.type === 'ratechange') speedLabels.syncMedia(element);
		// Native media events double as presence evidence for media that never
		// plays or loads metadata (volume-only elements).
		reportMediaPresence();
		// The first media volume event is the page-entry audio detection moment;
		// solidify the amplified-controller verdict before the runtime loads.
		if (event.type === 'volumechange') reportPageScale(element);
		// Yield only to a runtime that registered a player. Injection or a READY
		// handshake is not proof: a runtime that never discovered this document's
		// media must not remove the only observer that hears native changes.
		if (state.runtimeObservesMedia) return;
		pendingObservation = true;
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
		if (sender.id !== chrome.runtime.id) return false;
		if (!message || typeof message !== 'object') return false;
		const candidate = message as { protocolVersion?: unknown; type?: unknown };
		if (candidate.protocolVersion !== SPECTRA_PROTOCOL_VERSION || typeof candidate.type !== 'string') {
			return false;
		}
		if (isSpectraContentInvocationGrantedMessage(message)) {
			state.extensionInvoked = true;
			sendResponse(bootstrapRpcSuccess({ accepted: true as const }));
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
				mediaIntentState: state.getMediaIntent?.() ?? 'unset',
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
	// document_start keeps physical presses out of page handlers that would
	// otherwise clamp volume to their native 0-100 range. Alt+Up is the single
	// exception: at the native ceiling, when the document has no known extension
	// invocation, the press is left to the browser so Chrome can execute the
	// manifest `volume_up` command - the only invocation that grants the
	// `activeTab` the same press needs above 100%. Popup, a delivered command, or
	// a successful Capture start latches that grant for the document's lifetime,
	// so a session that ended at 100% keeps the next press on the content path.
	// Page handlers are still silenced so they cannot cancel that chord. Every
	// other press is claimed here, so the key remains usable when the command is
	// unavailable or the page consumes it. Configured site bindings remain
	// website-first in the heavy hotkey listener.
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

	const requestBootstrapHello = (): void => {
		if (disposed || helloInFlight || observationsReady) return;
		helloInFlight = true;
		void sendBootstrapRequest('spectra.content.bootstrap.hello', {
			bootstrapRevision: SPECTRA_CONTENT_BOOTSTRAP_REVISION,
		}, state.dispose).then((response) => {
			helloInFlight = false;
			if (disposed) return;
			if (!isBootstrapHelloResponse(response)) {
				scheduleHelloRetry();
				return;
			}
			helloRetryAttempt = 0;
			if (helloRetryTimer !== null) {
				clearTimeout(helloRetryTimer);
				helloRetryTimer = null;
			}
			state.runtimeRevision = response.data.runtimeRevision;
			state.ready = response.data.runtimeRevision !== null;
			observationsReady = true;
			drainObservation();
			// The HELLO verdict decides the media reporter owner for this document: a
			// loaded runtime owns reporting (reportMediaPresence yields via state.ready),
			// otherwise the bootstrap keeps the fact warm through lifecycle events.
		}).catch(() => {
			helloInFlight = false;
			scheduleHelloRetry();
		});
	};

	const scheduleHelloRetry = (): void => {
		if (disposed || observationsReady || helloRetryTimer !== null
			|| helloRetryAttempt >= HELLO_RETRY_DELAYS_MS.length) return;
		const delay = HELLO_RETRY_DELAYS_MS[helloRetryAttempt];
		helloRetryAttempt += 1;
		helloRetryTimer = setTimeout(() => {
			helloRetryTimer = null;
			requestBootstrapHello();
		}, delay);
	};

	requestBootstrapHello();
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
		| { hasMediaElement: boolean; userInteracted: boolean; reportRevision: number; playing?: boolean; pausedAt?: number | null }
		| import('@nexus/contracts').ControlSubmitRequest,
	onInvalidated?: () => void,
): Promise<unknown | undefined> {
	return runWithValidExtensionContext(
		() => chrome.runtime.sendMessage(createSpectraRequest(type, payload)),
		onInvalidated,
	);
}

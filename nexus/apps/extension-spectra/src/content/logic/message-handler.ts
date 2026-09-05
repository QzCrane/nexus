/**
 * SPECTRA Content Script - Message Handler
 *
 * Handles messages from Popup/Background.
 * All config changes go through policyExecutor.updateConfig.
 */

import {
	SPECTRA_PROTOCOL_VERSION,
	isSpectraEventEnvelope,
	isSpectraRequestEnvelope,
	normalizeHostname,
	rpcFailure,
	rpcSuccess,
	type AudioRuntimeStatus,
} from '@nexus/contracts';

import type { PolicyExecutor, PolicyExecutorState } from './policy-executor';
import type { CaptureManager } from '../audio/capture-manager';
import type { WebAudioController } from '@nexus/audio-engine';
import type { SettingsManager } from '../core/settings-manager';
import { isAnyMediaPlaying, hasMediaElements } from '../audio/media-detection';
import { getPausedAt } from '../utils/pause-tracker';
import {
	handleSpectraContentCommand,
	isContentCommandType,
} from './spectra-command-handler';
import { shouldAcceptAudioSessionPhase } from '../../shared/audio-session-phase';
import { SPECTRA_SAME_DOCUMENT_NAVIGATION_EVENT } from '../core/lifecycle/navigation-observer';
import type { DocumentRuntimeContext } from '../core/content-runtime-context';

export interface MessageHandlerDeps {
	state: PolicyExecutorState;
	policyExecutor?: PolicyExecutor;
	captureManager: CaptureManager;
	audioController: WebAudioController;
	settingsManager: SettingsManager;
	runtimeContext: DocumentRuntimeContext;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createRuntimeStatus(deps: MessageHandlerDeps): AudioRuntimeStatus {
	return {
		config: {
			...deps.state.config,
			eqValues: [...deps.state.config.eqValues],
		},
		hasAudio: hasMediaElements(),
		isPlaying: isAnyMediaPlaying(),
		desiredMode: deps.state.desiredMode ?? 'bypass',
		actualMode: deps.state.actualMode,
		phase: deps.state.phase,
		generation: deps.state.generation,
		userInteracted: deps.state.userHasInteracted,
		pausedAt: getPausedAt(),
		lastError: deps.state.lastError
			? { code: 'runtime_error', message: deps.state.lastError, retryable: true }
			: null,
	};
}

function applyCaptureEvent(
	deps: MessageHandlerDeps,
	message: unknown,
	sender: chrome.runtime.MessageSender,
): boolean {
	if (!isSpectraEventEnvelope(message) || message.type !== 'spectra.audio.capture.changed') return false;
	const runtimeId = typeof chrome !== 'undefined' ? chrome.runtime?.id : undefined;
	const current = deps.runtimeContext;
	if (!current
		|| (runtimeId !== undefined && sender.id !== runtimeId)
		|| message.documentId !== current.identity.documentId
		|| (sender.documentId !== undefined && sender.documentId !== message.documentId)
		|| (sender.tab?.id !== undefined && sender.tab.id !== message.tabId)) {
		// The event is valid, but belongs to another Content document/context. It
		// must be consumed without changing local state or starting policy work.
		return true;
	}
	const runtimeOwnsTransition = deps.captureManager.hasLocalRequest();
	deps.captureManager.handleMessage(message);
	const snapshot = message.payload;
	if (shouldAcceptAudioSessionPhase(
		deps.state.generation,
		deps.state.phase,
		snapshot.generation,
		snapshot.phase,
	)) {
		deps.state.generation = snapshot.generation;
		deps.state.phase = snapshot.phase;
		deps.state.actualMode = snapshot.actualMode;
		deps.state.lastError = snapshot.lastError?.message;
		if (!runtimeOwnsTransition
			&& snapshot.phase === 'idle'
			&& snapshot.actualMode === 'bypass'
			&& deps.state.desiredMode === 'capture') {
			// An externally stopped processor leaves desired policy unapplied. Do not
			// restart without a fresh one-shot admission; retain an explicit error.
			deps.state.phase = 'error';
			deps.state.lastError = 'Capture stopped before the requested processor policy was released';
		}
	}
	return true;
}

function applyContentSettingsEvent(deps: MessageHandlerDeps, message: unknown): boolean {
	if (!isSpectraEventEnvelope(message) || message.type !== 'spectra.content.settings.changed') return false;
	deps.settingsManager.handleMessage(message);
	return true;
}

function applyMediaRouteEvent(
	deps: MessageHandlerDeps,
	message: unknown,
	sender: chrome.runtime.MessageSender,
): boolean {
	if (!isSpectraEventEnvelope(message) || message.type !== 'spectra.audio.route.changed') return false;
	if (sender.id !== chrome.runtime.id) return true;
	const hostname = normalizeHostname(globalThis.location?.hostname ?? '');
	if (!hostname || message.payload.domain !== hostname) return true;
	deps.state.mediaRoute = message.payload.mediaRoute;
	// A direct-only route may immediately retire an existing Capture owner.
	// Capture/auto routes never manufacture a new Capture admission from a
	// settings event; the next explicit processor intent carries that authority.
	if (deps.policyExecutor) {
		void deps.policyExecutor.refreshMediaRoute()
			.then((route) => {
				if (route === 'direct') return deps.policyExecutor?.applyState({ modeIntent: true });
			})
			.catch((error: unknown) => {
			deps.state.phase = 'error';
			deps.state.lastError = error instanceof Error ? error.message : String(error);
			});
	}
	return true;
}

function applyNavigationEvent(
	message: unknown,
	sender: chrome.runtime.MessageSender,
): boolean {
	if (!isSpectraEventEnvelope(message) || message.type !== 'spectra.navigation.changed') return false;
	if (sender.id !== chrome.runtime.id) return true;
	try {
		if (new URL(message.payload.url).href !== window.location.href) return true;
	} catch {
		return true;
	}
	window.dispatchEvent(new Event(SPECTRA_SAME_DOCUMENT_NAVIGATION_EVENT));
	return true;
}

function handleVisualizerDemand(
	deps: MessageHandlerDeps,
	message: unknown,
	sender: chrome.runtime.MessageSender,
	sendResponse: (response?: unknown) => void,
): boolean | undefined {
	if (!isRecord(message) || message.type !== 'spectra.audio.visualizer.demand.set') return undefined;
	if (!isSpectraRequestEnvelope(message)
		|| message.type !== 'spectra.audio.visualizer.demand.set') {
		sendResponse(rpcFailure('invalid_request', 'Malformed visualizer demand request'));
		return false;
	}
	if (sender.id && sender.id !== chrome.runtime.id) {
		sendResponse(rpcFailure('forbidden', 'Visualizer demand is extension-internal only'));
		return false;
	}
	if (message.documentId !== deps.runtimeContext.identity.documentId) {
		sendResponse(rpcFailure('stale_document', 'Visualizer demand belongs to a stale document', true));
		return false;
	}
	if (!deps.policyExecutor) {
		sendResponse(rpcFailure('runtime_booting', 'Audio runtime is still starting', true));
		return false;
	}

	if (message.payload.enabled) deps.state.visualizerSubscribers.add(message.payload.subscriberId);
	else deps.state.visualizerSubscribers.delete(message.payload.subscriberId);
	const operation = deps.policyExecutor.applyState({
		modeIntent: true,
		...(message.payload.enabled ? { captureAdmission: message.payload.admission } : {}),
	});
	void operation.then(
		() => sendResponse(rpcSuccess(createRuntimeStatus(deps))),
		(error) => sendResponse(rpcFailure(
			'visualizer_demand_failed',
			error instanceof Error ? error.message : String(error),
			true,
		)),
	);
	return true;
}

function handleVisualizerFrame(
	deps: MessageHandlerDeps,
	message: unknown,
	sender: chrome.runtime.MessageSender,
	sendResponse: (response?: unknown) => void,
): boolean | undefined {
	if (!isRecord(message) || message.type !== 'spectra.audio.visualizer.get') return undefined;
	if (!isSpectraRequestEnvelope(message) || message.type !== 'spectra.audio.visualizer.get') {
		sendResponse(rpcFailure('invalid_request', 'Malformed visualizer frame request'));
		return false;
	}
	if (sender.id && sender.id !== chrome.runtime.id) {
		sendResponse(rpcFailure('forbidden', 'Visualizer frames are extension-internal only'));
		return false;
	}
	if (message.documentId !== deps.runtimeContext.identity.documentId) {
		sendResponse(rpcFailure('stale_document', 'Visualizer frame belongs to a stale document', true));
		return false;
	}
	const data = deps.state.actualMode === 'webaudio'
		&& deps.state.phase === 'active'
		&& deps.state.visualizerSubscribers.size > 0
		? deps.audioController.getVisualizerData()
		: null;
	sendResponse(rpcSuccess({ buffer: data ? Array.from(data) : null }));
	return false;
}

// post: validates current envelopes before action-specific code observes payloads.
export function createMessageHandler(deps: MessageHandlerDeps): (
	message: unknown,
	sender: chrome.runtime.MessageSender,
	sendResponse: (response?: unknown) => void
) => boolean | undefined {
	return (message, _sender, sendResponse) => {
		if (applyCaptureEvent(deps, message, _sender)) return false;
		if (applyContentSettingsEvent(deps, message)) return false;
		if (applyMediaRouteEvent(deps, message, _sender)) return false;
		if (applyNavigationEvent(message, _sender)) return false;
		const visualizerFrame = handleVisualizerFrame(deps, message, _sender, sendResponse);
		if (visualizerFrame !== undefined) return visualizerFrame;
		const visualizerDemand = handleVisualizerDemand(deps, message, _sender, sendResponse);
		if (visualizerDemand !== undefined) return visualizerDemand;
		if (isRecord(message)
			&& message.protocolVersion === SPECTRA_PROTOCOL_VERSION
			&& typeof message.type === 'string'
			&& (message.type === 'spectra.hotkey.trigger'
				|| message.type.startsWith('spectra.media.')
				|| message.type.startsWith('spectra.video.'))) {
			if (!isSpectraRequestEnvelope(message) || !isContentCommandType(message.type)) {
				sendResponse(rpcFailure('invalid_request', 'Malformed content command'));
				return false;
			}
			if (_sender.id && _sender.id !== chrome.runtime.id) {
				sendResponse(rpcFailure('forbidden', 'Content command is extension-internal only'));
				return false;
			}
			return handleSpectraContentCommand(message, sendResponse);
		}
		if (isRecord(message)
			&& message.protocolVersion === SPECTRA_PROTOCOL_VERSION
			&& typeof message.type === 'string'
			&& message.type.startsWith('spectra.audio.runtime.')) {
			if (!isSpectraRequestEnvelope(message)
				|| (message.type !== 'spectra.audio.runtime.get'
					&& message.type !== 'spectra.audio.runtime.configure')) {
				sendResponse(rpcFailure('invalid_request', 'Malformed audio runtime request'));
				return false;
			}
			if (_sender.id && _sender.id !== chrome.runtime.id) {
				sendResponse(rpcFailure('forbidden', 'Audio runtime RPC is extension-internal only'));
				return false;
			}
			if (message.type === 'spectra.audio.runtime.configure') {
				if (!deps.policyExecutor) {
					sendResponse(rpcFailure('runtime_booting', 'Audio runtime is still starting', true));
					return false;
				}
				let persistence: ReturnType<PolicyExecutor['updateConfig']>;
				try {
					persistence = deps.policyExecutor.updateConfig(message.payload.config);
				} catch (error) {
					sendResponse(rpcFailure(
						'audio_config_persist_failed',
						error instanceof Error ? error.message : String(error),
						true,
					));
					return false;
				}
				void persistence.then(
					(result) => {
						if (!result.ok) {
							sendResponse(result);
							return;
						}
						sendResponse(rpcSuccess(createRuntimeStatus(deps)));
					},
					(error) => sendResponse(rpcFailure(
						'audio_config_persist_failed',
						error instanceof Error ? error.message : String(error),
						true,
					)),
				);
				return true;
			}
			sendResponse(rpcSuccess(createRuntimeStatus(deps)));
			return false;
		}
		return false;
	};
}

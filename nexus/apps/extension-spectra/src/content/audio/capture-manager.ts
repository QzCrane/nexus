// goal: expose only background/offscreen-acknowledged capture state to the content runtime

import {
	Actions,
	isSpectraEventEnvelope,
	type AudioConfig,
} from '@nexus/contracts';
import { isExtensionContextValid } from '../core/context-guard';
import { logger } from '../../shared/logger';
import { sendSpectraRequest } from '../../shared/spectra-client';
import { shouldAcceptAudioSessionPhase } from '../../shared/audio-session-phase';

interface CaptureReply {
	status: 'processing' | 'error';
	phase?: 'idle' | 'starting' | 'active' | 'stopping' | 'error';
	active?: boolean;
	generation?: number;
	error?: string;
}

interface CaptureStateEvent {
	enabled?: boolean;
	phase?: CaptureReply['phase'];
	generation?: number;
	error?: string;
}

const log = logger.content;
let active = false;
let phase: CaptureReply['phase'] = 'idle';
let generation = 0;
let lastError: string | undefined;
let pending: Promise<CaptureReply> | null = null;

const notifyInjector = (isActive: boolean) => {
	window.postMessage({ type: 'SPECTRA_CAPTURE_STATE', active: isActive, generation }, '*');
};

function applyConfirmedState(event: CaptureStateEvent): void {
	const nextGeneration = event.generation ?? generation;
	const nextPhase = event.phase ?? (event.enabled ? 'active' : 'idle');
	if (!shouldAcceptAudioSessionPhase(generation, phase ?? 'idle', nextGeneration, nextPhase)) return;
	generation = nextGeneration;
	phase = nextPhase;
	lastError = event.error;
	// `phase` describes the in-flight transition; `enabled` is the last
	// acknowledged processor state. Capture remains actual while stopping/erroring
	// until the offscreen host confirms it is idle.
	const nextActive = event.enabled ?? nextPhase === 'active';
	if (active !== nextActive) {
		active = nextActive;
		notifyInjector(active);
	}
}

export function createCaptureManager() {
	return {
		isActive: () => active,
		isPending: () => phase === 'starting' || phase === 'stopping' || pending !== null,
		getPhase: () => phase,
		getGeneration: () => generation,
		getLastError: () => lastError,
		waitForSettled: async () => {
			const operation = pending;
			if (operation) await operation.catch(() => undefined);
		},
		setActive: (isActive: boolean, nextGeneration = generation) => applyConfirmedState({
			enabled: isActive,
			phase: isActive ? 'active' : 'idle',
			generation: nextGeneration,
		}),
		restoreState: (snapshot: {
			active: boolean;
			phase: CaptureReply['phase'];
			generation: number;
			error?: string;
		}) => applyConfirmedState({
			enabled: snapshot.active,
			phase: snapshot.phase,
			generation: snapshot.generation,
			error: snapshot.error,
		}),
		handleMessage,
		request,
		syncConfig,
	};
}

async function request(enabled: boolean, config: AudioConfig, requestedGeneration?: number): Promise<CaptureReply> {
	if (!isExtensionContextValid()) {
		return { status: 'error', phase: 'error', active: false, generation, error: 'Extension context is unavailable' };
	}
	if (pending) await pending.catch(() => undefined);
	if (enabled === active && ((enabled && phase === 'active') || (!enabled && phase === 'idle'))) {
		return { status: 'processing', phase, active, generation };
	}

	const previousActive = active;
	const requestGeneration = requestedGeneration === undefined
		? generation + 1
		: Math.max(generation, requestedGeneration);
	generation = requestGeneration;
	phase = enabled ? 'starting' : 'stopping';
	lastError = undefined;

	const operation = sendSpectraRequest(
		'spectra.audio.capture.set',
		{ enabled, config },
		{ generation: requestGeneration },
	).then((response): CaptureReply => {
		if (!response.ok) {
			return {
				status: 'error',
				phase: 'error',
				active: previousActive,
				generation: requestGeneration,
				error: response.error.message,
			};
		}
		return {
			status: response.data.phase === 'error' ? 'error' : 'processing',
			phase: response.data.phase,
			active: response.data.active,
			generation: response.data.generation,
			error: response.data.lastError?.message,
		};
	});
	pending = operation;

	try {
		const response = await operation;
		const responseGeneration = response.generation ?? requestGeneration;
		if (responseGeneration < generation) return response;
		if (response.status === 'error' || response.phase === 'error') {
			applyConfirmedState({
				enabled: response.active ?? active,
				phase: response.phase ?? 'error',
				generation: responseGeneration,
				error: response.error || 'Capture transition failed',
			});
			log.error('Capture transition failed:', response.error);
			return response;
		}
		applyConfirmedState({
			enabled: response.active ?? response.phase === 'active',
			phase: response.phase,
			generation: responseGeneration,
		});
		return response;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		applyConfirmedState({ enabled: previousActive, phase: 'error', generation: requestGeneration, error: message });
		return {
			status: 'error',
			phase: 'error',
			active: previousActive,
			generation: requestGeneration,
			error: message,
		};
	} finally {
		if (pending === operation) pending = null;
	}
}

function handleMessage(message: unknown): boolean {
	if (isSpectraEventEnvelope(message) && message.type === 'spectra.audio.capture.changed') {
		applyConfirmedState({
			enabled: message.payload.active,
			phase: message.payload.phase,
			generation: message.payload.generation,
			error: message.payload.lastError?.message,
		});
		return true;
	}
	if (!message || typeof message !== 'object') return false;
	const legacy = message as { action?: string; payload?: CaptureStateEvent; enabled?: boolean };
	if (legacy.action !== Actions.CAPTURE_STATE_CHANGE) return false;
	const payload = legacy.payload ?? { enabled: legacy.enabled };
	applyConfirmedState(payload);
	return true;
}

async function syncConfig(config: AudioConfig, requestedGeneration = generation): Promise<boolean> {
	if (!active || !isExtensionContextValid()) return false;
	try {
		const nextGeneration = Math.max(generation, requestedGeneration);
		const response = await sendSpectraRequest(
			'spectra.audio.capture.config',
			{ config },
			{ generation: nextGeneration },
		);
		if (!response.ok) throw new Error(response.error.message);
		if (response.data.lastError || response.data.generation !== nextGeneration) {
			throw new Error(response.data.lastError?.message || 'Capture configuration was not acknowledged');
		}
		generation = response.data.generation;
		lastError = undefined;
		return true;
	} catch (error) {
		lastError = error instanceof Error ? error.message : String(error);
		return false;
	}
}

export type CaptureManager = ReturnType<typeof createCaptureManager>;

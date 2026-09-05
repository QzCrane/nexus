// goal: expose only background/offscreen-acknowledged capture state to the content runtime

import {
	isSpectraEventEnvelope,
	type AudioConfig,
	type CaptureAdmission,
} from '@nexus/contracts';
import { ContentLifecycleError } from '../core/content-runtime-context';
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
	actualConfig?: AudioConfig;
	continuationAdmission?: CaptureAdmission;
	outcome?: 'cancelled' | 'stale';
}

interface CaptureStateEvent {
	enabled?: boolean;
	phase?: CaptureReply['phase'];
	generation?: number;
	error?: string;
	actualConfig?: AudioConfig;
}

export interface CaptureContinuation {
	resume(config: AudioConfig, requestedGeneration?: number): Promise<CaptureReply>;
}

export interface CaptureManagerOptions {
	/** The document identity is the Content projection fence for lifecycle events. */
	documentId: string;
	/** The owning DocumentRuntimeContext signal; aborting it cancels all waits. */
	signal: AbortSignal;
}

const log = logger.content;
const testManagers = new Set<{ resetForTests(): void }>();

function cloneConfig(config: AudioConfig): AudioConfig {
	return { ...config, eqValues: [...config.eqValues] };
}

function cancellationError(message = 'Capture Content operation was cancelled'): ContentLifecycleError {
	return new ContentLifecycleError('cancelled', message);
}

function captureCancellationReply(
	active: boolean,
	generation: number,
	message = 'Capture Content operation was cancelled',
): CaptureReply {
	return {
		status: 'error',
		phase: 'error',
		active,
		generation,
		error: message,
		outcome: 'cancelled',
	};
}

/**
 * Race a Content-owned operation with the runtime cancellation signal.  The
 * underlying Chrome request is still observed after cancellation so a late
 * rejection cannot become an unhandled promise; the public operation settles
 * immediately with a typed cancellation result and can never commit state.
 */
function settleWithCancellation<T>(
	operation: Promise<T>,
	signal: AbortSignal,
	onCancel: () => T,
): Promise<T> {
	if (signal.aborted) return Promise.resolve(onCancel());
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const finish = (value: T): void => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', onAbort);
			resolve(value);
		};
		const fail = (error: unknown): void => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', onAbort);
			reject(error);
		};
		const onAbort = (): void => finish(onCancel());
		signal.addEventListener('abort', onAbort, { once: true });
		void operation.then(finish, (error) => {
			if (signal.aborted) finish(onCancel());
			else fail(error);
		});
	});
}

export function createCaptureManager(options: CaptureManagerOptions) {
	let active = false;
	let phase: CaptureReply['phase'] = 'idle';
	let generation = 0;
	let lastError: string | undefined;
	let actualConfig: AudioConfig | null = null;
	let pending: Promise<unknown> | null = null;
	let disposed = false;
	const lifecycleController = new AbortController();

	if (options.signal.aborted) lifecycleController.abort(options.signal.reason);
	const onExternalAbort = (): void => {
		if (!lifecycleController.signal.aborted) {
			lifecycleController.abort(options.signal.reason ?? cancellationError());
		}
	};
	options.signal.addEventListener('abort', onExternalAbort, { once: true });

	const isCancelled = (): boolean => disposed || lifecycleController.signal.aborted;

	function applyConfirmedState(event: CaptureStateEvent): boolean {
		const nextGeneration = event.generation ?? generation;
		const nextPhase = event.phase ?? (event.enabled ? 'active' : 'idle');
		if (!shouldAcceptAudioSessionPhase(generation, phase ?? 'idle', nextGeneration, nextPhase)) return false;
		generation = nextGeneration;
		phase = nextPhase;
		lastError = event.error;
		// `phase` describes the in-flight transition; `enabled` is the last
		// acknowledged processor state. Capture remains actual while stopping/erroring
		// until the offscreen host confirms it is idle.
		const nextActive = event.enabled ?? nextPhase === 'active';
		active = nextActive;
		if (!nextActive) actualConfig = null;
		else if (event.actualConfig) actualConfig = cloneConfig(event.actualConfig);
		return true;
	}

	function resetForTests(): void {
		active = false;
		phase = 'idle';
		generation = 0;
		lastError = undefined;
		actualConfig = null;
		pending = null;
	}

	function isDocumentEvent(message: unknown): boolean {
		return isSpectraEventEnvelope(message)
			&& message.type === 'spectra.audio.capture.changed'
			&& message.documentId === options.documentId;
	}

	function handleMessage(message: unknown): boolean {
		if (!isSpectraEventEnvelope(message) || message.type !== 'spectra.audio.capture.changed') return false;
		// A valid event for another document is still consumed, but cannot mutate
		// this runtime's projection. MessageHandler performs the sender fence too;
		// keeping this check here protects direct manager consumers and tests.
		if (!isDocumentEvent(message) || isCancelled()) return true;
		applyConfirmedState({
			enabled: message.payload.active,
			phase: message.payload.phase,
			generation: message.payload.generation,
			error: message.payload.lastError?.message,
			actualConfig: message.payload.actualConfig,
		});
		return true;
	}

	async function request(
		enabled: boolean,
		config: AudioConfig,
		requestedGeneration?: number,
		requestOptions: CaptureRequestOptions = {},
	): Promise<CaptureReply> {
		if (isCancelled()) return captureCancellationReply(active, generation);
		if (!isExtensionContextValid()) {
			return {
				status: 'error',
				phase: 'error',
				active: false,
				generation,
				error: 'Extension context is unavailable',
			};
		}
		if (pending) await pending.catch(() => undefined);
		if (isCancelled()) return captureCancellationReply(active, generation);
		if (enabled === active
			&& ((!enabled && phase === 'idle')
				|| (enabled && phase === 'active' && actualConfig !== null))) {
			const currentActual = enabled ? actualConfig : null;
			return {
				status: 'processing',
				phase,
				active,
				generation,
				...(currentActual ? { actualConfig: cloneConfig(currentActual) } : {}),
			};
		}
		if (enabled && !requestOptions.admission) {
			return {
				status: 'error',
				phase: 'error',
				active,
				generation,
				error: 'Capture start requires a one-shot Background admission',
			};
		}

		const previousActive = active;
		// Starting/stopping changes processor ownership. It cannot reuse the stable
		// generation even when a caller still holds that acknowledged generation;
		// otherwise Background sees active -> idle in one generation and correctly
		// rejects the terminal session update as a stale phase regression.
		const requestGeneration = requestedGeneration === undefined
			? generation + 1
			: Math.max(generation + 1, requestedGeneration);
		generation = requestGeneration;
		phase = enabled ? 'starting' : 'stopping';
		lastError = undefined;

		const rawOperation = sendSpectraRequest(
			'spectra.audio.capture.set',
			enabled
				? { enabled: true, config, admission: requestOptions.admission as CaptureAdmission }
				: {
					enabled: false,
					config,
					...(requestOptions.requestContinuation ? { requestContinuation: true } : {}),
				},
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
				...(response.data.actualConfig
					? { actualConfig: cloneConfig(response.data.actualConfig) }
					: {}),
				...(response.data.continuationAdmission
					? { continuationAdmission: response.data.continuationAdmission }
					: {}),
			};
		}).catch((error): CaptureReply => ({
			status: 'error',
			phase: 'error',
			active: previousActive,
			generation: requestGeneration,
			error: error instanceof Error ? error.message : String(error),
		}));
		const operation = settleWithCancellation(
			rawOperation,
			lifecycleController.signal,
			() => captureCancellationReply(previousActive, requestGeneration),
		);
		pending = operation;

		try {
			const response = await operation;
			if (response.outcome === 'cancelled' || isCancelled()) return response;
			const responseGeneration = response.generation ?? requestGeneration;
			if (responseGeneration < generation) return { ...response, outcome: 'stale' };
			if (response.status === 'error' || response.phase === 'error') {
				applyConfirmedState({
					enabled: response.active ?? active,
					phase: response.phase ?? 'error',
					generation: responseGeneration,
					error: response.error || 'Capture transition failed',
				});
				// Missing browser invocation is prevented before this request is sent.
				// A denial after an admitted transaction therefore indicates a real
				// navigation/permission race and must retain the original failure signal.
				log.error('Capture transition failed:', response.error ?? 'Unknown capture error');
				return response;
			}
			const accepted = applyConfirmedState({
				enabled: response.active ?? response.phase === 'active',
				phase: response.phase,
				generation: responseGeneration,
				actualConfig: response.actualConfig,
			});
			if (response.active && response.phase === 'active') {
				const confirmedActual = accepted ? actualConfig : null;
				if (!confirmedActual) {
					const error = 'Capture processor did not return an actual configuration';
					applyConfirmedState({
						enabled: true,
						phase: 'error',
						generation: responseGeneration,
						error,
					});
					return {
						...response,
						status: 'error',
						phase: 'error',
						error,
					};
				}
				return { ...response, actualConfig: cloneConfig(confirmedActual) };
			}
			return response;
		} finally {
			if (pending === operation) pending = null;
		}
	}

	async function syncConfig(config: AudioConfig, requestedGeneration = generation): Promise<AudioConfig | null> {
		if (!active || isCancelled() || !isExtensionContextValid()) return null;
		try {
			const nextGeneration = Math.max(generation, requestedGeneration);
			const operation = sendSpectraRequest(
				'spectra.audio.capture.config',
				{ config },
				{ generation: nextGeneration },
			).then((response) => {
				if (!response.ok) throw new Error(response.error.message);
				if (response.data.lastError || response.data.generation !== nextGeneration) {
					throw new Error(response.data.lastError?.message || 'Capture configuration was not acknowledged');
				}
				if (!response.data.actualConfig) {
					throw new Error('Capture processor did not return an actual configuration');
				}
				return response.data.actualConfig;
			});
			const cancellableOperation = settleWithCancellation(
				operation,
				lifecycleController.signal,
				() => null,
			);
			pending = cancellableOperation;
			try {
				const response = await cancellableOperation;
				if (response === null || isCancelled()) return null;
				const accepted = applyConfirmedState({
					enabled: true,
					phase: 'active',
					generation: nextGeneration,
					actualConfig: response,
				});
				if (!accepted || !actualConfig) throw new Error('Capture configuration acknowledgement became stale');
				return cloneConfig(actualConfig);
			} finally {
				if (pending === cancellableOperation) pending = null;
			}
		} catch (error) {
			if (isCancelled()) return null;
			lastError = error instanceof Error ? error.message : String(error);
			return null;
		}
	}

	async function rehydrateActiveSession(): Promise<{
		generation: number;
		actualConfig: AudioConfig;
	} | null> {
		if (isCancelled() || !isExtensionContextValid()) return null;
		const response = await sendSpectraRequest('spectra.audio.session.current', {})
			.catch(() => null);
		if (!response?.ok) return null;
		const session = response.data;
		if (session?.actualMode !== 'capture'
			|| session.phase !== 'active') return null;
		// Background/offscreen is the physical owner after an MV3 worker restart.
		// A local manager can hold a newer speculative generation from an operation
		// whose worker disappeared before its ACK. Advance that local fence instead
		// of rejecting the authenticated active session as an older projection; the
		// following CONFIG request commits this generation through Background.
		const restoredGeneration = Math.max(session.generation, generation + 1);
		const restoredConfig = cloneConfig(session.actualConfig);
		const accepted = applyConfirmedState({
			enabled: true,
			phase: 'active',
			generation: restoredGeneration,
			actualConfig: restoredConfig,
		});
		return accepted ? { generation: restoredGeneration, actualConfig: restoredConfig } : null;
	}

	async function suspendForContinuation(
		config: AudioConfig,
		requestedGeneration?: number,
	): Promise<CaptureContinuation | null> {
		if (isCancelled()) return null;
		if (pending) await pending.catch(() => undefined);
		if (isCancelled() || !active) return null;
		const stopped = await request(false, config, requestedGeneration, {
			requestContinuation: true,
		});
		if (isCancelled()) return null;
		if (stopped.active || stopped.phase === 'error') {
			if (stopped.outcome === 'cancelled') return null;
			throw new Error(stopped.error ?? 'Capture did not yield for continuation');
		}
		if (stopped.continuationAdmission?.kind !== 'capture-resume') {
			throw new Error('Capture stop did not return an admitted continuation');
		}
		const continuationAdmission = stopped.continuationAdmission;
		const suspendedGeneration = generation;
		let consumed = false;
		return {
			async resume(nextConfig, nextGeneration) {
				if (consumed) throw new Error('Capture continuation was already consumed');
				consumed = true;
				if (isCancelled()) throw cancellationError();
				if (active || phase !== 'idle' || generation !== suspendedGeneration) {
					throw new Error('Capture continuation no longer owns the suspended processor');
				}
				const resumed = await request(true, nextConfig, nextGeneration, {
					admission: continuationAdmission,
				});
				if (resumed.outcome === 'cancelled') throw cancellationError(resumed.error);
				if (!resumed.active || resumed.phase !== 'active') {
					throw new Error(resumed.error ?? 'Capture continuation did not resume');
				}
				return resumed;
			},
		};
	}

	const manager = {
		isActive: () => active,
		isPending: () => phase === 'starting' || phase === 'stopping' || pending !== null,
		isDisposed: () => isCancelled(),
		hasLocalRequest: () => pending !== null,
		getPhase: () => phase,
		getGeneration: () => generation,
		getLastError: () => lastError,
		getActualConfig: () => actualConfig ? cloneConfig(actualConfig) : null,
		waitForSettled: async () => {
			const operation = pending;
			if (operation) await operation.catch(() => undefined);
		},
		setActive: (isActive: boolean, nextGeneration = generation) => isCancelled()
			? false
			: applyConfirmedState({
				enabled: isActive,
				phase: isActive ? 'active' : 'idle',
				generation: nextGeneration,
			}),
		restoreState: (snapshot: {
			active: boolean;
			phase: CaptureReply['phase'];
			generation: number;
			error?: string;
			actualConfig?: AudioConfig;
		}) => {
			if (isCancelled()) return false;
			return applyConfirmedState({
				enabled: snapshot.active,
				phase: snapshot.phase,
				generation: snapshot.generation,
				error: snapshot.error,
				actualConfig: snapshot.actualConfig,
			});
		},
		handleMessage,
		request,
		syncConfig,
		rehydrateActiveSession,
		suspendForContinuation,
		dispose: () => {
			if (disposed) return;
			disposed = true;
			options.signal.removeEventListener('abort', onExternalAbort);
			if (!lifecycleController.signal.aborted) {
				lifecycleController.abort(cancellationError('Capture Content runtime disposed'));
			}
			testManagers.delete(resettable);
		},
	};
	const resettable = { resetForTests };
	testManagers.add(resettable);
	return manager;
}

interface CaptureRequestOptions {
	admission?: CaptureAdmission;
	requestContinuation?: boolean;
}

export type CaptureManager = ReturnType<typeof createCaptureManager>;

export function resetCaptureManagerForTests(): void {
	for (const manager of testManagers) manager.resetForTests();
}

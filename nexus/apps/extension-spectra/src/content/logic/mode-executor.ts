// goal: transact one complete owner across native, Media WebAudio, and admitted Capture

import { audioGraphSignature, type AudioGraphSnapshot } from '@nexus/audio-engine';
import {
	DEFAULT_AUDIO_CONFIG,
	requiresAudioProcessor,
	resolveAudioVolume,
	type AudioConfig,
	type CaptureAdmission,
	type SpectraAudioMode,
} from '@nexus/contracts';
import type { PolicyExecutorDeps, PolicyExecutorState } from '../types';
import { logger } from '../../shared/logger';

const log = logger.content;
const CAPTURE_ADMISSION_REQUIRED = 'Capture requires a current-tab extension invocation';

interface ModeExecutionOwner {
	run: number;
	disposed: boolean;
	updateBadge: () => void;
	broadcastUI: () => void;
}

export interface ModeExecutor {
	execute(advanceGeneration?: boolean, captureAdmission?: CaptureAdmission): Promise<void>;
	dispose(): void;
}

export function createModeExecutor(
	deps: PolicyExecutorDeps,
	state: PolicyExecutorState,
	updateBadge: () => void,
	broadcastUI: () => void,
): ModeExecutor {
	const owner: ModeExecutionOwner = {
		run: 0,
		disposed: false,
		updateBadge,
		broadcastUI,
	};
	return {
		execute(advanceGeneration = false, captureAdmission) {
			if (owner.disposed) return Promise.resolve();
			owner.run += 1;
			if (advanceGeneration) state.generation += 1;
			return executeModeTransition(
				deps,
				state,
				owner,
				owner.run,
				state.generation,
				captureAdmission,
			);
		},
		dispose() {
			if (owner.disposed) return;
			owner.disposed = true;
			owner.run += 1;
		},
	};
}

async function executeModeTransition(
	deps: PolicyExecutorDeps,
	state: PolicyExecutorState,
	owner: ModeExecutionOwner,
	run: number,
	generation: number,
	captureAdmission?: CaptureAdmission,
): Promise<void> {
	if (stale(deps, owner, run)) return;
	if (deps.captureManager.isPending()) {
		await deps.captureManager.waitForSettled();
		if (stale(deps, owner, run)) return;
	}
	const mode = state.activeMode ?? 'bypass';
	if (mode === 'capture') {
		await enterCapture(deps, state, owner, run, generation, captureAdmission);
	} else if (mode === 'webaudio') {
		await enterWebAudio(deps, state, owner, run, generation, captureAdmission);
	} else {
		await enterBypass(deps, state, owner, run, generation);
	}
	if (!stale(deps, owner, run)) {
		owner.updateBadge();
		owner.broadcastUI();
	}
}

function stale(deps: PolicyExecutorDeps, owner: ModeExecutionOwner, run: number): boolean {
	return owner.disposed
		|| run !== owner.run
		|| deps.lifecycleSignal.aborted
		|| deps.captureManager.isDisposed?.() === true;
}

async function neutralizeWebAudio(
	deps: PolicyExecutorDeps,
	state: PolicyExecutorState,
): Promise<boolean> {
	deps.audioController.setVisualizerSubscribed(false);
	if (!deps.audioController.isReady()) return true;
	try {
		await deps.audioController.bypass();
		return true;
	} catch (error) {
		state.actualMode = 'webaudio';
		state.phase = 'error';
		state.lastError = `Unable to neutralize Media WebAudio: ${errorMessage(error)}`;
		return false;
	}
}

async function enterCapture(
	deps: PolicyExecutorDeps,
	state: PolicyExecutorState,
	owner: ModeExecutionOwner,
	run: number,
	generation: number,
	captureAdmission?: CaptureAdmission,
): Promise<void> {
	const { captureManager } = deps;
	if (!state.config.enabled
		|| (!requiresAudioProcessor(state.config) && state.visualizerSubscribers.size === 0)) {
		throw new Error('Capture policy was selected without an enabled processor contribution');
	}
	if (!await neutralizeWebAudio(deps, state) || stale(deps, owner, run)) return;
	if (!captureManager.isActive()
		&& state.actualMode === 'capture'
		&& state.phase === 'active') {
		const restored = await captureManager.rehydrateActiveSession();
		if (stale(deps, owner, run)) return;
		if (restored) {
			state.generation = restored.generation;
			state.actualMode = 'capture';
			state.phase = 'active';
			state.appliedConfig = cloneAudioConfig(restored.actualConfig);
			state.lastError = undefined;
		}
	}
	if (captureManager.isActive()) {
		state.phase = 'starting';
		const actual = await captureManager.syncConfig(state.config, state.generation);
		if (stale(deps, owner, run)) return;
		state.generation = Math.max(state.generation, captureManager.getGeneration());
		state.actualMode = 'capture';
		state.phase = actual ? 'active' : 'error';
		if (actual) state.appliedConfig = cloneAudioConfig(actual);
		state.lastError = actual ? undefined : captureManager.getLastError();
		return;
	}
	if (captureAdmission?.kind !== 'capture-start') {
		state.actualMode = 'bypass';
		state.phase = 'error';
		state.appliedConfig = toDomAppliedConfig(state.config);
		state.lastError = CAPTURE_ADMISSION_REQUIRED;
		return;
	}
	log.capture('Full-tab Capture admitted for an unsafe or unavailable page processor route');
	state.phase = 'starting';
	const result = await captureManager.request(true, state.config, generation, {
		admission: captureAdmission,
	});
	if (stale(deps, owner, run) || result.outcome === 'cancelled' || result.outcome === 'stale') return;
	state.generation = Math.max(state.generation, result.generation ?? generation);
	if (result.active && result.phase === 'active') {
		state.actualMode = 'capture';
		state.phase = 'active';
		state.appliedConfig = result.actualConfig
			? cloneAudioConfig(result.actualConfig)
			: captureManager.getActualConfig() ?? transparentAudioConfig();
		state.lastError = undefined;
		return;
	}
	state.actualMode = result.active ? 'capture' : 'bypass';
	state.phase = 'error';
	state.appliedConfig = result.active
		? result.actualConfig
			? cloneAudioConfig(result.actualConfig)
			: captureManager.getActualConfig() ?? transparentAudioConfig()
		: toDomAppliedConfig(state.config);
	state.lastError = result.error ?? 'Capture did not acknowledge an active processor';
}

async function enterWebAudio(
	deps: PolicyExecutorDeps,
	state: PolicyExecutorState,
	owner: ModeExecutionOwner,
	run: number,
	generation: number,
	captureAdmission?: CaptureAdmission,
): Promise<void> {
	const elements = deps.mediaRegistry.list().map(({ element }) => element);
	const evidenceFor = (element: HTMLMediaElement) =>
		deps.mediaRegistry.getEligibilityEvidence(element);
	if (!deps.audioController.canAttachAll(elements, evidenceFor)) {
		await fallbackFromWebAudio(
			deps, state, owner, run, generation, captureAdmission,
			'Media WebAudio coverage is not complete and proven safe',
		);
		return;
	}
	const captureWasActive = deps.captureManager.isActive();
	if (captureWasActive) {
		const transparent = await deps.captureManager.syncConfig(transparentAudioConfig(), generation);
		if (stale(deps, owner, run)) return;
		if (!transparent) {
			state.actualMode = 'capture';
			state.phase = 'error';
			state.lastError = deps.captureManager.getLastError();
			return;
		}
	}
	state.phase = 'starting';
	let graphActual: AudioConfig;
	try {
		if (!await deps.audioController.initialize(true)) {
			throw new Error('Media WebAudio context is not running');
		}
		if (stale(deps, owner, run)) return;
		const attached = elements.every((element) =>
			deps.audioController.ensureAttached(element, evidenceFor(element)));
		if (!attached || !deps.audioController.hasCompleteCoverage(elements, evidenceFor)) {
			throw new Error('Media WebAudio did not bind the complete registry scope');
		}
		const snapshot = await deps.audioController.applyConfig(state.config);
		if (stale(deps, owner, run)) return;
		graphActual = actualConfigFromGraphSnapshot(state.config, snapshot, elements.length);
		deps.audioController.setVisualizerSubscribed(state.visualizerSubscribers.size > 0);
	} catch (error) {
		await deps.audioController.bypass().catch(() => undefined);
		deps.audioController.setVisualizerSubscribed(false);
		await fallbackFromWebAudio(
			deps, state, owner, run, generation, captureAdmission, errorMessage(error),
		);
		return;
	}
	if (captureWasActive) {
		state.phase = 'stopping';
		const stopped = await deps.captureManager.request(false, state.config, generation);
		if (stale(deps, owner, run) || stopped.outcome === 'cancelled' || stopped.outcome === 'stale') return;
		state.generation = Math.max(state.generation, stopped.generation ?? generation);
		if (stopped.active) {
			await deps.audioController.bypass().catch(() => undefined);
			deps.audioController.setVisualizerSubscribed(false);
			const restored = await deps.captureManager.syncConfig(state.config, state.generation);
			if (stale(deps, owner, run)) return;
			state.actualMode = 'capture';
			state.phase = 'error';
			state.appliedConfig = restored
				? cloneAudioConfig(restored)
				: transparentAudioConfig();
			state.lastError = stopped.error ?? 'Capture owner did not retire after WebAudio acknowledgement';
			return;
		}
	}
	state.actualMode = 'webaudio';
	state.phase = 'active';
	state.appliedConfig = graphActual;
	state.lastError = undefined;
}

async function fallbackFromWebAudio(
	deps: PolicyExecutorDeps,
	state: PolicyExecutorState,
	owner: ModeExecutionOwner,
	run: number,
	generation: number,
	captureAdmission: CaptureAdmission | undefined,
	reason: string,
): Promise<void> {
	if (stale(deps, owner, run)) return;
	if (state.mediaRoute === 'direct') {
		state.actualMode = 'bypass';
		state.phase = 'error';
		state.appliedConfig = toDomAppliedConfig(state.config);
		state.lastError = `Direct route cannot bind the complete page media graph: ${reason}`;
		return;
	}
	if (deps.captureManager.isActive()) {
		const restored = await deps.captureManager.syncConfig(state.config, generation);
		if (stale(deps, owner, run)) return;
		state.actualMode = 'capture';
		state.phase = restored ? 'active' : 'error';
		state.appliedConfig = restored
			? cloneAudioConfig(restored)
			: deps.captureManager.getActualConfig() ?? transparentAudioConfig();
		state.lastError = restored ? undefined : deps.captureManager.getLastError() ?? reason;
		return;
	}
	if (captureAdmission?.kind === 'capture-start') {
		state.activeMode = 'capture';
		state.desiredMode = 'capture';
		await enterCapture(deps, state, owner, run, generation, captureAdmission);
		return;
	}
	state.actualMode = 'bypass';
	state.phase = 'error';
	state.appliedConfig = toDomAppliedConfig(state.config);
	state.lastError = reason;
}

async function enterBypass(
	deps: PolicyExecutorDeps,
	state: PolicyExecutorState,
	owner: ModeExecutionOwner,
	run: number,
	generation: number,
): Promise<void> {
	const captureWasActive = deps.captureManager.isActive();
	let transparentActual: AudioConfig | null = null;
	if (captureWasActive) {
		transparentActual = await deps.captureManager.syncConfig(transparentAudioConfig(), generation);
		if (stale(deps, owner, run)) return;
		if (!transparentActual) {
			state.actualMode = 'capture';
			state.phase = 'error';
			state.lastError = deps.captureManager.getLastError();
			return;
		}
	}
	if (!await neutralizeWebAudio(deps, state) || stale(deps, owner, run)) return;
	if (captureWasActive) {
		state.phase = 'stopping';
		const stopped = await deps.captureManager.request(false, state.config, generation);
		if (stale(deps, owner, run) || stopped.outcome === 'cancelled' || stopped.outcome === 'stale') return;
		state.generation = Math.max(state.generation, stopped.generation ?? generation);
		if (stopped.active) {
			state.actualMode = 'capture';
			state.phase = 'error';
			state.appliedConfig = transparentActual ?? transparentAudioConfig();
			state.lastError = stopped.error ?? 'Capture processor did not stop';
			return;
		}
	}
	state.actualMode = 'bypass';
	state.phase = 'idle';
	state.appliedConfig = toDomAppliedConfig(state.config);
	state.lastError = undefined;
}

function actualConfigFromGraphSnapshot(
	requested: AudioConfig,
	snapshot: AudioGraphSnapshot,
	expectedSources: number,
): AudioConfig {
	if (snapshot.contextState !== 'running' || snapshot.sourceCount !== expectedSources) {
		throw new Error('Media WebAudio graph did not return a complete running source-backed ACK');
	}
	if (audioGraphSignature(snapshot.normalizedActualConfig) !== snapshot.graphSignature) {
		throw new Error('Media WebAudio graph signature does not match its actual configuration');
	}
	const actual = snapshot.normalizedActualConfig;
	const volumeBase = resolveAudioVolume(requested).volumeBase;
	return {
		...requested,
		volumeBase,
		boost: actual.boostGain,
		volume: Math.round(volumeBase * actual.boostGain * 100) / 100,
		bass: actual.bass,
		eqValues: [...actual.eqValues],
		compressor: actual.compressor,
		mono: actual.mono,
		pan: actual.pan,
		delay: actual.delay,
	};
}

function transparentAudioConfig(): AudioConfig {
	return { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] };
}

function cloneAudioConfig(config: AudioConfig): AudioConfig {
	return { ...config, eqValues: [...config.eqValues] };
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function toDomAppliedConfig(config: AudioConfig): AudioConfig {
	const volume = resolveAudioVolume(config);
	return {
		...config,
		volume: volume.volumeBase,
		volumeBase: volume.volumeBase,
		boost: 1,
		compressor: false,
		mono: false,
		bass: false,
		eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
		pan: 0,
		delay: 0,
	};
}

export function isProcessorMode(mode: SpectraAudioMode | null): boolean {
	return mode === 'webaudio' || mode === 'capture';
}

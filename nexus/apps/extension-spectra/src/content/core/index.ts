// goal: orchestrates content script initialization, core module bootstrapping, and lifecycle loops

import {
	SPECTRA_CONTENT_RUNTIME_REVISION,
} from '@nexus/contracts';
import { WebAudioController } from '@nexus/audio-engine';

import { createSettingsManager } from './settings-manager';
import { createCaptureManager } from '../audio/capture-manager';
import type { CaptureManager } from '../audio/capture-manager';
import { createPolicyExecutor } from '../logic/policy-executor';
import { createMessageHandler } from '../logic/message-handler';
import { logger } from '../../shared/logger';

import {
  createMediaStateReporter,
  reportMediaState,
  setupPopupConnectionListener,
  createNavigationObserver,
	getDocumentRouteIdentity,
} from './lifecycle';
import {
  initHotkeyListener,
} from '../input/hotkey-listener';
import { Registry } from '../../shared/registry';
import { createSnapshot, mountStub, consumeStub } from './sentinel';
import { sendSpectraRequest } from '../../shared/spectra-client';
import {
	setContentRuntimeDisposer,
	setContentRuntimeOwnershipProvider,
	setContentRuntimeReady,
} from '../../shared/content-runtime';
import {
	assembleInitialState,
	shouldApplyInitialPolicy,
	type InitialStateSource,
} from './initial-state';
import type { ContentDeps, PolicyExecutorState } from '../types';
import type { SettingsManager } from './settings-manager';
import {
	NativeMediaExecutor,
	registerNativeMediaExecutor,
} from '../logic/native-media-executor';
import { createAudioRuntimeControlDelegate } from '../logic/audio-runtime-control-delegate';
import { registerControlOperationExecutor } from '../logic/control-operation-executor';
import { MediaRegistry, setActiveMediaRegistry } from './media-registry';
import { DocumentRuntimeContext } from './content-runtime-context';
import { disposeContentRuntimeLifecycle } from './content-runtime-lifecycle';
import {
	disposeABLoopSource,
	disposeABLoops,
	listABOwnership,
	setABLoopReleaseReporter,
} from '../video/ab-loop';
import {
	disposeMarkerSource,
	disposeMarkers,
	listMarkerOwnership,
} from '../video/time-marker';
import { registerTrustedActivationBridge } from '../input/trusted-activation-bridge';
import { createFullscreenAudioHandoff } from './fullscreen-audio-handoff';
import { disposeFeedbackSurfaces } from '../ui/feedback-surface';
import { disposeOSD } from '../ui/osd';
import { disposeToast } from '../ui/toast';

const log = logger.content;

interface SpectraContentWindow extends Window {
  __SPECTRA_TEARDOWN__?: () => void | Promise<void>;
  __SPECTRA_LISTENERS_READY__?: boolean;
  __SPECTRA_CONTENT_RUNTIME__?: ContentRuntime;
}

const spectraWindow = window as SpectraContentWindow;

interface ContentRuntime {
  readonly revision: string;
  readonly registry: Registry;
  disposed: boolean;
  state?: PolicyExecutorState;
	context?: DocumentRuntimeContext;
	disposing?: Promise<void>;
  dispose(handoff?: boolean): Promise<void>;
}

function disposeFeedbackUI(): void {
	disposeOSD();
	disposeToast();
	disposeFeedbackSurfaces();
}

function createContentRuntime(): ContentRuntime {
  const registry = new Registry();
  const runtime: ContentRuntime = {
		revision: SPECTRA_CONTENT_RUNTIME_REVISION,
    registry,
    disposed: false,
		dispose(handoff = false) {
      if (runtime.disposing) return runtime.disposing;
			runtime.disposed = true;
			runtime.disposing = disposeContentRuntimeLifecycle({
				context: runtime.context,
				handoff,
				disposeSynchronous: () => {
					// Retire every source, listener and presentation owner before a
					// physical processor release can yield or fail.
					disposeFeedbackUI();
					registry.dispose();
				},
				finalize: () => {
					if (runtime.state) mountStub(createSnapshot(runtime.state));
					if (spectraWindow.__SPECTRA_CONTENT_RUNTIME__ === runtime) {
						setContentRuntimeReady(null);
						setContentRuntimeDisposer(null);
						spectraWindow.__SPECTRA_LISTENERS_READY__ = false;
					}
				},
			});
			return runtime.disposing;
    },
  };
  return runtime;
}

function isCurrentRuntime(runtime: ContentRuntime): boolean {
  return !runtime.disposed && spectraWindow.__SPECTRA_CONTENT_RUNTIME__ === runtime;
}

// A dynamic reinjection synchronously retires the old document runtime. Capture
// remains Background/offscreen-owned and is hydrated through its session ACK.
void spectraWindow.__SPECTRA_CONTENT_RUNTIME__?.dispose(true);
void spectraWindow.__SPECTRA_TEARDOWN__?.();

const contentRuntime = createContentRuntime();
contentRuntime.registry.track(disposeFeedbackUI);
spectraWindow.__SPECTRA_CONTENT_RUNTIME__ = contentRuntime;
spectraWindow.__SPECTRA_TEARDOWN__ = () => contentRuntime.dispose(true);
setContentRuntimeDisposer(() => contentRuntime.dispose(false));
spectraWindow.__SPECTRA_LISTENERS_READY__ = false;

contentRuntime.registry.addEventListener(window, 'SPECTRA_TERMINATED_OLD_VERSION', () => {
  void contentRuntime.dispose();
});

void initSpectra(contentRuntime).catch((error) => {
	if (!isCurrentRuntime(contentRuntime)) return;
	log.error('Content runtime failed before READY:', error);
	void contentRuntime.dispose();
});

interface InitContext {
  registry: Registry;
  settingsManager: SettingsManager;
  captureManager: CaptureManager;
  state: PolicyExecutorState;
  deps: ContentDeps;
}

// eff: assembles state from a same-document handoff, sender-bound session, or fresh config
async function createInitialState(): Promise<{ state: PolicyExecutorState; source: InitialStateSource }> {
  const recoveredState = consumeStub();
  const sessionRequest = sendSpectraRequest('spectra.audio.session.current', {})
    .then((result) => result.ok ? result.data : null)
    .catch(() => null);
	const policyRequest = recoveredState?.config
		? Promise.resolve(null)
		: sendSpectraRequest('spectra.audio.policy.get', {})
			.then((result) => result.ok ? result.data : null)
			.catch(async () => {
				// Mixed-version update window: the stable v2 config route exists in
				// older workers, while policy.get is additive. Never replace the
				// user's durable config with defaults merely because the new route is
				// not loaded yet; route hydration follows through registry.query.
				const result = await sendSpectraRequest('spectra.audio.config.get', {});
				return result.ok ? { config: result.data, mediaRoute: 'auto' as const } : null;
			});
  const [session, policy] = await Promise.all([sessionRequest, policyRequest]);

  return assembleInitialState({
	handoff: recoveredState,
	session,
	config: policy?.config ?? null,
	mediaRoute: policy?.mediaRoute ?? 'auto',
  });
}

// eff: sets up core messaging infrastructure (onMessage listener + policy executor)
function bootstrapMessaging(ctx: InitContext): void {
  ctx.deps.state = ctx.state;
  const messageHandler = createMessageHandler(ctx.deps);

  chrome.runtime.onMessage.addListener(messageHandler);
  ctx.registry.track(() => chrome.runtime.onMessage.removeListener(messageHandler));
}

// eff: registers all lifecycle listeners (popup, media, gestures, fullscreen, navigation, hotkeys)
function bootstrapLifecycle(ctx: InitContext, runtime: ContentRuntime): void {
  const { state, registry, deps } = ctx;
  const { policyExecutor } = deps;
  if (!policyExecutor) throw new Error('SPECTRA content policy executor was not initialized');

  registry.track(setupPopupConnectionListener(state));

  registry.track(createMediaStateReporter(state));

  registry.addEventListener(window, 'pagehide', () => {
	void sendSpectraRequest('spectra.audio.session.flush', {}).catch(() => undefined);
  });

  registry.track(createNavigationObserver({
    onNavigate: (routeIdentity) => policyExecutor.applyNavigation(() => (
		getDocumentRouteIdentity(window.location) === routeIdentity
	)),
  }));

  void initHotkeyListener(ctx.settingsManager, state).then((cleanup) => {
    if (isCurrentRuntime(runtime)) registry.track(cleanup);
    else cleanup();
  });
}

// eff: hydrates restored ownership or applies one authoritative policy before READY
async function applyInitialState(
	ctx: InitContext,
	source: InitialStateSource,
	runtime: ContentRuntime,
): Promise<void> {
	if (!isCurrentRuntime(runtime)) return;
	const { state, deps } = ctx;
	const { policyExecutor } = deps;
	if (!policyExecutor) throw new Error('SPECTRA content policy executor was not initialized');
	try {
		if (source !== 'fresh') {
			log.info(`[Hydration] Runtime state restored from ${source}.`);
		}
		// createInitialState already resolved the authoritative audio session/config.
		// A same-document handoff preserves every page-owned mode; a session snapshot
		// preserves an acknowledged Capture owner. Those paths hydrate before READY,
		// while a fresh load or non-Capture session applies policy exactly once.
		if (shouldApplyInitialPolicy(state, source)) await policyExecutor.applyState();
		if (!isCurrentRuntime(runtime)) return;
		reportMediaState(state);
  } catch (e) {
    log.error('Initialization failed:', e);
  }
}

// goal: bootstraps the extension logic within the host page context
async function initSpectra(runtime: ContentRuntime): Promise<void> {
  const { registry } = runtime;
  log.info(`SPECTRA Initializing... ${chrome.runtime.getManifest().version}`);
	const identityResponse = await sendSpectraRequest('spectra.content.runtime.identity', {});
	if (!isCurrentRuntime(runtime)) return;
	if (!identityResponse.ok) {
		throw new Error(`Content identity unavailable: ${identityResponse.error.message}`);
	}
	const runtimeContext = new DocumentRuntimeContext(identityResponse.data);
	runtime.context = runtimeContext;
	registry.track(runtimeContext);

	const settingsManager = createSettingsManager();
	const captureManager = createCaptureManager({
		documentId: runtimeContext.identity.documentId,
		signal: runtimeContext.signal,
	});
	registry.track(captureManager);
  const initial = await createInitialState();
  if (!isCurrentRuntime(runtime)) return;
	const state = initial.state;
	runtime.state = state;
	// The page MediaElement graph and the Background/offscreen Capture graph are
	// both longer-lived physical owners. This runtime only acquires document-local
	// controller/subscriber ownership and never creates a second graph.
	const audioController = registry.track(new WebAudioController());

	if (initial.source !== 'fresh') {
		// actualMode owns the processor. An error/stopping phase may still retain
		// the offscreen graph and lease, so hydration must not claim it is inactive
		// and allow a duplicate START or an unowned transition.
		const captureActive = state.actualMode === 'capture';
		captureManager.restoreState({
			active: captureActive,
			phase: state.phase,
			generation: state.generation,
			error: state.lastError,
			actualConfig: captureActive ? state.appliedConfig : undefined,
		});
	}

	const mediaRegistry = new MediaRegistry(runtimeContext);
	registry.track(mediaRegistry);
	registry.track(setActiveMediaRegistry(mediaRegistry));
	const deps: ContentDeps = {
		captureManager,
		audioController,
		mediaRegistry,
		settingsManager,
		state,
		lifecycleSignal: runtimeContext.signal,
		runtimeContext,
	};
	registry.track(setContentRuntimeOwnershipProvider(() => {
		const ownership = new Map<string, {
			target: import('@nexus/contracts').MediaTarget;
			markerCount: number;
			abActive: boolean;
		}>();
		for (const marker of listMarkerOwnership()) {
			ownership.set(
				`${marker.target.documentId}:${marker.target.mediaId}:${marker.target.sourceRevision}`,
				{ target: marker.target, markerCount: marker.markerCount, abActive: false },
			);
		}
		for (const ab of listABOwnership()) {
			const key = `${ab.target.documentId}:${ab.target.mediaId}:${ab.target.sourceRevision}`;
			const current = ownership.get(key);
			ownership.set(key, {
				target: ab.target,
				markerCount: current?.markerCount ?? 0,
				abActive: ab.active,
			});
		}
		return [...ownership.values()];
	}));
	let policyRefreshQueued = false;
	const schedulePolicyRefresh = (): void => {
		if (policyRefreshQueued) return;
		policyRefreshQueued = true;
		queueMicrotask(() => {
			policyRefreshQueued = false;
			void deps.policyExecutor?.applyState({ modeIntent: true }).catch((error) => {
				log.warn('Media coverage policy refresh failed:', error);
			});
		});
	};
	registry.track(mediaRegistry.subscribe((target, event, element, removalReason) => {
		if (event === 'removed' && removalReason === 'detached') {
			audioController.detachNode(element);
		}
		if (event === 'registered' || event === 'loadedmetadata' || event === 'removed') {
			schedulePolicyRefresh();
		}
		if (event !== 'removed') return;
		// One logical source-retirement boundary owns every source-scoped
		// presentation state.  This runs for both DOM detach and SPA source reuse;
		// element identity alone is intentionally never used as a cleanup key.
		const hadABLoop = disposeABLoopSource(target);
		disposeMarkerSource(target);
		if (hadABLoop) {
			void sendSpectraRequest('spectra.control.operation.submit', {
				source: 'restore',
				target,
				operation: 'ab-clear',
				payload: {},
			}).catch(() => undefined);
		}
		void sendSpectraRequest(
			'spectra.content.source.released',
			{ target },
			{ documentId: target.documentId },
		).catch(() => undefined);
	}));
	registry.track(setABLoopReleaseReporter((target) => {
		void sendSpectraRequest('spectra.control.operation.submit', {
			source: 'restore',
			target,
			operation: 'ab-clear',
			payload: {},
		}).catch(() => undefined);
	}));
	registry.track(disposeABLoops);
	registry.track(disposeMarkers);
	const nativeExecutor = new NativeMediaExecutor(mediaRegistry);
	registry.track(nativeExecutor);
	registry.track(registerNativeMediaExecutor(nativeExecutor));
	registry.track(registerControlOperationExecutor(nativeExecutor));
	registry.track(registerTrustedActivationBridge());
	bootstrapMessaging({ registry, settingsManager, captureManager, state, deps });

  const policyExecutor = await createPolicyExecutor(
		deps,
    state,
    () => isCurrentRuntime(runtime),
  );
  if (!policyExecutor || !isCurrentRuntime(runtime)) return;
	deps.policyExecutor = policyExecutor;
  registry.track(policyExecutor);
	const fullscreenHandoff = createFullscreenAudioHandoff({
		state,
		policyExecutor,
		captureManager,
		audioController,
	});
	registry.track(fullscreenHandoff);
	nativeExecutor.setAudioRuntimeDelegate(createAudioRuntimeControlDelegate(
		policyExecutor,
		state,
		fullscreenHandoff,
	));
	registry.track(() => nativeExecutor.setAudioRuntimeDelegate(null));

	bootstrapLifecycle(
		{ registry, settingsManager, captureManager, state, deps },
		runtime,
	);

	await applyInitialState(
		{ registry, settingsManager, captureManager, state, deps },
		initial.source,
		runtime,
	);

	// READY is a transaction boundary: executor registration and the initial
	// audio state are both complete. Presentation-only Content settings can load
	// afterward because they cannot overwrite control state.
	if (!isCurrentRuntime(runtime)) return;
	spectraWindow.__SPECTRA_LISTENERS_READY__ = true;
	setContentRuntimeReady(runtime.revision);
	void sendSpectraRequest('spectra.content.runtime.ready', {
		runtimeRevision: runtime.revision,
	}).catch(() => undefined);
	void settingsManager.load().catch((error) => {
		log.warn('Content presentation settings load failed:', error);
	});

	if (!isCurrentRuntime(runtime)) return;
	log.info('Content Script ready.');
}

// goal: orchestrates content script initialization, core module bootstrapping, and lifecycle loops
document.documentElement.setAttribute('data-spectra-content-loaded', 'true');

import { PolicyEngine, WebAudioController } from '@nexus/audio-engine';

import { isExtensionContextValid } from './context-guard';
import { createSettingsManager } from './settings-manager';
import { createCaptureManager } from '../audio/capture-manager';
import type { CaptureManager } from '../audio/capture-manager';
import { createPolicyExecutor } from '../logic/policy-executor';
import { createMessageHandler } from '../logic/message-handler';
import { logger } from '../../shared/logger';

import {
  createMediaObserver,
  createMediaStateReporter,
  reportMediaState,
  setupUserGestureListeners,
  setupPopupConnectionListener,
  setupFullscreenHandler,
  createNavigationObserver,
} from './lifecycle';
import {
  initHotkeyListener,
  setCaptureModeToggler,
  setConfigGetter,
  setConfigUpdater,
} from '../input/hotkey-listener';
import { Registry } from '../../shared/registry';
import { createSnapshot, mountStub, consumeStub } from './sentinel';
import { sendSpectraRequest } from '../../shared/spectra-client';
import { assembleInitialState } from './initial-state';
import type { ContentDeps, PolicyExecutorState } from '../types';
import type { PolicyExecutor } from '../logic/policy-executor';
import type { SettingsManager } from './settings-manager';

const log = logger.content;

interface SpectraContentWindow extends Window {
  __SPECTRA_TEARDOWN__?: () => void;
  __SPECTRA_INJECTED__?: boolean;
  __SPECTRA_VERSION__?: string;
  __SPECTRA_LISTENERS_READY__?: boolean;
  __SPECTRA_AUDIO_CONTROLLER_V2__?: WebAudioController;
  __SPECTRA_CONTENT_RUNTIME__?: ContentRuntime;
}

const spectraWindow = window as SpectraContentWindow;

interface ContentRuntime {
  readonly revision: string;
  readonly registry: Registry;
  disposed: boolean;
  state?: PolicyExecutorState;
  dispose(): void;
}

const CONTENT_RUNTIME_REVISION = '2.0.1';

function createContentRuntime(): ContentRuntime {
  const registry = new Registry();
  const runtime: ContentRuntime = {
    revision: CONTENT_RUNTIME_REVISION,
    registry,
    disposed: false,
    dispose() {
      if (runtime.disposed) return;
      runtime.disposed = true;
      registry.dispose();
      if (runtime.state) mountStub(createSnapshot(runtime.state));
      if (spectraWindow.__SPECTRA_CONTENT_RUNTIME__ === runtime) {
        spectraWindow.__SPECTRA_LISTENERS_READY__ = false;
      }
    },
  };
  return runtime;
}

function isCurrentRuntime(runtime: ContentRuntime): boolean {
  return !runtime.disposed && spectraWindow.__SPECTRA_CONTENT_RUNTIME__ === runtime;
}

// A dynamic reinjection disposes listeners and UI state immediately. The audio
// controller/graphs remain page-owned because MediaElementSourceNode bindings
// cannot be recreated safely after their AudioContext is closed.
spectraWindow.__SPECTRA_CONTENT_RUNTIME__?.dispose();
spectraWindow.__SPECTRA_TEARDOWN__?.();

const contentRuntime = createContentRuntime();
spectraWindow.__SPECTRA_CONTENT_RUNTIME__ = contentRuntime;
spectraWindow.__SPECTRA_TEARDOWN__ = () => contentRuntime.dispose();
spectraWindow.__SPECTRA_INJECTED__ = true;
spectraWindow.__SPECTRA_VERSION__ = chrome.runtime.getManifest().version;
spectraWindow.__SPECTRA_LISTENERS_READY__ = false;

contentRuntime.registry.addEventListener(window, 'SPECTRA_TERMINATED_OLD_VERSION', () => {
  contentRuntime.dispose();
});

void initSpectra(contentRuntime);

interface InitContext {
  registry: Registry;
  policyEngine: PolicyEngine;
  audioController: WebAudioController;
  settingsManager: SettingsManager;
  captureManager: CaptureManager;
  state: PolicyExecutorState;
  deps: ContentDeps;
}

// eff: tries to inherit state from a zero-refresh stub, or falls back to background fetch
async function createInitialState(): Promise<{ state: PolicyExecutorState; recovered: boolean }> {
  const recoveredState = consumeStub();
  const sessionRequest = sendSpectraRequest('spectra.audio.session.current', {})
    .then((result) => result.ok ? result.data : null)
    .catch(() => null);
  const configRequest = recoveredState?.config
    ? Promise.resolve(null)
    : sendSpectraRequest('spectra.audio.config.get', {})
      .then((result) => result.ok ? result.data : null)
      .catch(() => null);
  const [session, config] = await Promise.all([sessionRequest, configRequest]);

  return assembleInitialState({ handoff: recoveredState, session, config });
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
  const { state, audioController, captureManager, registry, deps } = ctx;
  const policyExecutor = deps.policyExecutor!;

  registry.track(setupPopupConnectionListener(state));

  registry.track(createMediaObserver(state, audioController, policyExecutor));

  registry.track(createMediaStateReporter(state));

  registry.addEventListener(window, 'pagehide', () => {
	void sendSpectraRequest('spectra.audio.session.flush', {}).catch(() => undefined);
  });

  const gestureCleanup = setupUserGestureListeners(state, audioController, policyExecutor);
  registry.track(gestureCleanup);

  registry.track(setupFullscreenHandler(state, policyExecutor, captureManager));

  registry.track(createNavigationObserver({
    policyExecutor,
    onNavigate: () => policyExecutor.applyState({ navigation: true }),
  }));

  setConfigGetter(() => state.config);
  setConfigUpdater((changes, options) => policyExecutor.updateConfig(changes, options));
  registry.track(setCaptureModeToggler(() => policyExecutor.toggleCaptureMode()));

  void initHotkeyListener().then((cleanup) => {
    if (isCurrentRuntime(runtime)) registry.track(cleanup);
    else cleanup();
  });
}

// eff: applies the initial state -- either from a hot swap stub or a fresh background load
async function applyInitialState(
  ctx: InitContext,
  recovered: boolean,
  runtime: ContentRuntime,
): Promise<void> {
  if (!isCurrentRuntime(runtime)) return;
  const { state, settingsManager, deps } = ctx;
  const policyExecutor = deps.policyExecutor!;
  try {
    if (recovered) {
      await settingsManager.load();
      if (!isCurrentRuntime(runtime)) return;
      log.info('[Handoff] Runtime state recovered from an authenticated source.');
      policyExecutor.applyState();
    } else {
      await loadConfigAndApply(state, settingsManager, policyExecutor, runtime);
    }
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

  const policyEngine = new PolicyEngine();
  const audioController = spectraWindow.__SPECTRA_AUDIO_CONTROLLER_V2__ ?? new WebAudioController();
  spectraWindow.__SPECTRA_AUDIO_CONTROLLER_V2__ = audioController;
  const settingsManager = createSettingsManager();
  const captureManager = createCaptureManager();
  const initial = await createInitialState();
  if (!isCurrentRuntime(runtime)) return;
  const state = initial.state;
  runtime.state = state;

	if (initial.recovered) {
		captureManager.restoreState({
			active: state.actualMode === 'capture',
			phase: state.phase,
			generation: state.generation,
			error: state.lastError,
		});
	}

  const deps: ContentDeps = { policyEngine, audioController, captureManager, settingsManager, state, getVisualizerData: () => audioController.getVisualizerData() };

  bootstrapMessaging({ registry, policyEngine, audioController, settingsManager, captureManager, state, deps });

  const policyExecutor = await createPolicyExecutor(
    { policyEngine, audioController, captureManager, settingsManager },
    state,
    () => isCurrentRuntime(runtime),
  );
  if (!policyExecutor || !isCurrentRuntime(runtime)) return;
  deps.policyExecutor = policyExecutor;
  registry.track(policyExecutor);

  bootstrapLifecycle(
    { registry, policyEngine, audioController, settingsManager, captureManager, state, deps },
    runtime,
  );

  await applyInitialState(
    { registry, policyEngine, audioController, settingsManager, captureManager, state, deps },
    initial.recovered,
    runtime,
  );

  if (!isCurrentRuntime(runtime)) return;
  spectraWindow.__SPECTRA_LISTENERS_READY__ = true;
  log.info('Content Script ready.');
}

// eff: retrieves initial configuration from storage and executes the first state application
async function loadConfigAndApply(
  state: PolicyExecutorState,
  settingsManager: SettingsManager,
  policyExecutor: PolicyExecutor,
  runtime: ContentRuntime,
): Promise<void> {
  if (!isCurrentRuntime(runtime) || !isExtensionContextValid()) {
    log.debug('Extension context invalidated, skipping config load.');
    return;
  }

  try {
    const result = await sendSpectraRequest('spectra.audio.config.get', {});
    if (!isCurrentRuntime(runtime)) return;
    if (result.ok) {
      state.config = result.data;
    }

    await settingsManager.load();
    if (!isCurrentRuntime(runtime)) return;

    reportMediaState();

    policyExecutor.applyState();
  } catch {
    // note: failure indicates background worker is likely offline or restarting
  }
}



// goal: defines messaging listeners for the tab card to handle state synchronization between the popup, background, and content scripts

import {
	audioSessionMatchesControlDocument,
	isActiveCaptureLifecycle,
} from '@nexus/contracts';
import type { CardInternalState } from './types';
import type { AudioConfig } from '@nexus/kernel';
import { mergeAudioConfig, mergeControlSnapshot } from './types';
import { projectAcknowledgedProcessorLifecycle } from './state';
import { classifyControlSnapshot, isControlClockStale } from '../control-snapshot-order';
import { subscribePopupTabUiEvents, type PopupUiEvent } from '../ui-event-hub';
import { currentTopDocumentId } from '../../shared/top-document';
import { sendSpectraRequest } from '../../shared/ui-spectra-client';
import { updateCachedControlSnapshot } from './snapshot';

export interface MessagingParams {
	tabId: number;
	documentId?: string;
	onDocumentReplaced?: () => void;
	hasPendingVolume?: () => boolean;
	pendingConfigFields?: () => ReadonlySet<keyof AudioConfig>;
	state: CardInternalState;
	render: () => void;
}

// post: applies one authoritative ControlSnapshot to the card projection.  The
// snapshot is the only field-level source of truth; session events are handled
// separately below and can only contribute processor lifecycle.
export function applyControlSnapshot(
	state: CardInternalState,
	snapshot: import('@nexus/contracts').ControlSnapshot,
	render: () => void,
	hasPendingVolume = false,
	pendingConfigFields: ReadonlySet<keyof AudioConfig> = new Set(),
): boolean {
	const current = state.controlSnapshot;
	if (isControlClockStale(
		state.controlGeneration,
		state.controlRevision,
		snapshot.generation,
		snapshot.revision,
	)) return false;
	const admission = classifyControlSnapshot(current, snapshot);
	if (admission !== 'accepted') return false;
	// An accepted snapshot is authoritative field-level truth. The initial
	// bootstrap read may have timed out or been rejected; any later accepted
	// snapshot must recover the card from the transient unknown state instead
	// of leaving controls inert and the volume label at "—" until reopen.
	state.controlSnapshotKnown = true;
	if (current) {
		if (snapshot.documentId !== current.documentId || snapshot.origin !== current.origin) {
			delete state.pendingVolumePresentation;
			// A document transition replaces the complete projection.  Do not carry
			// purple Capture state or any optimistic values across navigation.
			state.actualMode = 'bypass';
			state.desiredMode = 'bypass';
			state.phase = 'idle';
			state.isCaptureActive = false;
			state.audioDocumentId = null;
			state.audioOrigin = null;
			state.audioGeneration = -1;
			state.audioConfigRevision = 0;
		}
	}
	state.controlSnapshot = snapshot;
	const lifecycleMatches = state.audioDocumentId === snapshot.documentId
		&& state.audioOrigin === snapshot.origin;
	if (!lifecycleMatches && state.audioDocumentId !== null) {
		state.actualMode = 'bypass';
		state.desiredMode = 'bypass';
		state.phase = 'idle';
		state.isCaptureActive = false;
		state.audioDocumentId = null;
		state.audioOrigin = null;
		state.audioGeneration = -1;
		state.audioConfigRevision = 0;
	}
	state.stableConfig = mergeControlSnapshot(state.stableConfig, snapshot);
	const sameDocument = current?.documentId === snapshot.documentId && current.origin === snapshot.origin;
	projectAcknowledgedProcessorLifecycle(state, snapshot.fields, sameDocument ? current.fields : undefined);
	const incoming = state.stableConfig;
	const optimisticBeforeSnapshot = state.config;
	const identityChanged = current !== null
		&& (snapshot.documentId !== current.documentId || snapshot.origin !== current.origin);
	// Broadcasts update acknowledged truth without rewinding a newer local intent.
	// A navigation always replaces both projections, even during an old gesture.
	if (!identityChanged && (state.draggingField === 'volume' || hasPendingVolume)) {
		const {
			volume: _volume,
			volumeBase: _volumeBase,
			boost: _boost,
			...otherConfig
		} = incoming;
		state.config = { ...state.config, ...otherConfig };
	} else {
		state.config = mergeAudioConfig(incoming, { eqValues: [...incoming.eqValues] });
	}
	if (!identityChanged) {
		const optimistic = state.config as unknown as Record<string, unknown>;
		const previous = optimisticBeforeSnapshot as unknown as Record<string, unknown>;
		for (const field of pendingConfigFields) optimistic[field] = previous[field];
	}
	if (!current || identityChanged) {
		// Revisions are scoped to a document. Carrying a larger revision from the
		// previous navigation would make every subsequent intent use an invalid
		// baseRevision and strand the newly active page in a permanent conflict.
		state.controlGeneration = snapshot.generation;
		state.controlRevision = snapshot.revision;
	} else {
		state.controlGeneration = Math.max(state.controlGeneration, snapshot.generation);
		state.controlRevision = Math.max(state.controlRevision, snapshot.revision);
	}
	state.lastError = Object.values(snapshot.fields)
		.find((field) => field?.lastError)?.lastError ?? null;
	updateCachedControlSnapshot(snapshot.tabId, snapshot);
	render();
	return true;
}

// post: returns a cleanup function that removes the chrome.runtime.onMessage listener
export function setupCardMessaging(params: MessagingParams): () => void {
  const { tabId, state, render } = params;
  const documentId = params.documentId;
  let disposed = false;
  let retired = false;
  let verification: Promise<void> | null = null;
  const verifyReplacement = () => {
    if (!documentId || verification || retired || disposed) return;
    // One verification at a time; a never-settling Chrome read must not spawn
    // unbounded replacement probes. Only actual top-document truth retires UI.
    const pending = currentTopDocumentId(tabId).then((currentDocument) => {
      if (disposed || retired || !currentDocument || currentDocument === documentId) return;
      retired = true;
      state.actualMode = 'bypass';
      state.desiredMode = 'bypass';
      state.phase = 'idle';
      state.isCaptureActive = false;
      state.audioDocumentId = null;
      state.audioOrigin = null;
      state.audioGeneration = -1;
      state.audioConfigRevision = 0;
      params.onDocumentReplaced?.();
    }).catch((error: unknown) => {
      if (!disposed) console.warn('[SPECTRA Popup] Document replacement verification failed:', error);
    }).finally(() => { if (verification === pending) verification = null; });
    verification = pending;
  };

	const onMessage = (rawMessage: PopupUiEvent, sender: chrome.runtime.MessageSender): void => {
  if (disposed || retired) return;
  if (rawMessage.type === 'spectra.navigation.changed') {
    if (!sender.tab && documentId && rawMessage.documentId !== documentId) verifyReplacement();
    return;
  }
	if (rawMessage.type === 'spectra.control.snapshot.changed') {
		const snapshot = rawMessage.payload;
		if (snapshot.tabId !== tabId) return;
		if (documentId && snapshot.documentId !== documentId) {
			if (!sender.tab && classifyControlSnapshot(state.controlSnapshot, snapshot) === 'accepted') verifyReplacement();
			return;
		}
		applyControlSnapshot(
			state,
			snapshot,
			render,
			params.hasPendingVolume?.() ?? false,
			params.pendingConfigFields?.() ?? new Set(),
		);
		return;
	}
	if (rawMessage.type === 'spectra.audio.session.changed') {
		const snapshot = rawMessage.payload;
		const control = state.controlSnapshot;
		const matchesControl = audioSessionMatchesControlDocument(snapshot, control);
		if (snapshot.tabId === tabId
			&& matchesControl
			&& (snapshot.generation > state.audioGeneration
				|| snapshot.generation === state.audioGeneration
					&& snapshot.configRevision >= state.audioConfigRevision)) {
			// ControlSnapshot is the sole per-field actual authority. Session events
			// contribute processor lifecycle only and cannot overwrite a newer
			// page-native volume/speed revision.
			state.actualMode = snapshot.actualMode;
			state.desiredMode = snapshot.desiredMode;
			state.phase = snapshot.phase;
			state.audioDocumentId = snapshot.documentId;
			state.audioOrigin = snapshot.origin;
			state.audioGeneration = snapshot.generation;
			state.audioConfigRevision = snapshot.configRevision;
			state.lastError = snapshot.lastError;
			state.isCaptureActive = isActiveCaptureLifecycle({
				actualMode: snapshot.actualMode,
				phase: snapshot.phase,
			});
			render();
		}
		return;
	}
	// Exact-document Capture lifecycle events belong to the content runtime, not
	// Popup state. The preceding session.changed snapshot is the UI authority.
	if (rawMessage.type === 'spectra.audio.capture.changed') return;
  };

  let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  if (!state.controlSnapshotKnown) {
    recoveryTimer = setTimeout(() => {
      if (disposed || state.controlSnapshotKnown) return;
      void sendSpectraRequest('spectra.control.snapshot.get', { tabId }).then((response) => {
        if (!disposed && response.ok) {
          if (response.data) {
            applyControlSnapshot(state, response.data, render);
          } else {
            state.controlSnapshotKnown = true;
            render();
          }
        }
      }).catch((error: unknown) => {
        console.debug('[SPECTRA Card] Snapshot recovery skipped:', error);
      });
    }, 250);
  }

  const unsubscribe = subscribePopupTabUiEvents(tabId, onMessage);
  return () => {
    disposed = true;
    if (recoveryTimer !== null) clearTimeout(recoveryTimer);
    unsubscribe();
  };
}

// goal: binds native DOM events (clicks, inputs, wheel, touch) to acknowledged control updates

import type { CardUIElements } from '../types';
import type { CardInternalState } from './types';
import type { ConfigErrorHandler, ConfigUpdateFn } from './state';
import type { ControlOperationAck } from '@nexus/contracts';
import { resolveAudioVolume } from '@nexus/contracts';
import { AUDIO_UI, TIMING } from '../constants';
import { getDomain } from '../utils/dom';
import { bindMediaControls } from './media-events';
import { patchSettings } from '../../shared/settings-client';
import { sendSpectraRequest } from '../../shared/ui-spectra-client';
import { submitControlIntent } from './intent-recovery';
import { mergeAudioConfig, mergeControlFields } from './types';
import { showPopupToast } from '../toast';
import { isReportedControlFailure } from './control-port';
import { gestureVolumeColor } from './render';
import type { VolumeView } from './volume-view';

export interface EventsParams {
  ui: CardUIElements;
  state: CardInternalState;
  volumeView: VolumeView;
  tabId: number;
  tabUrl: string;
  update: ConfigUpdateFn;
  getCapturing: () => boolean;
  render: () => void;
  onError?: ConfigErrorHandler;
}

// eff: transiently swaps a save button's icon for a localized success/failure
// label. Both .btn-save and .btn-save-global share this helper so the feedback
// style stays consistent. The .feedback/.saved/.failed classes in popup.css
// auto-size the button and tint it green/red; after the feedback window the
// original icon HTML is restored.
function showSaveFeedback(button: HTMLElement, success: boolean, dict: { saveSuccess: string; saveFailed: string }): void {
  const originalHTML = button.innerHTML;
  button.classList.remove('saved', 'failed');
  button.classList.add('feedback', success ? 'saved' : 'failed');
  const candidate = success ? dict.saveSuccess : dict.saveFailed;
  button.textContent = typeof candidate === 'string' && candidate.trim().length > 0
    ? candidate
    : success ? 'Saved' : 'Failed';
  setTimeout(() => {
    button.classList.remove('feedback', 'saved', 'failed');
    button.innerHTML = originalHTML;
  }, TIMING.BUTTON_FEEDBACK_DURATION);
}

// eff: attaches event listeners to the card UI components, managing the lifecycle of user interactions
export function bindCardEvents(params: EventsParams): void {
  const { ui, state, volumeView, tabId, tabUrl, update, render, onError } = params;
  const domain = getDomain(tabUrl);

	const readActualSpeed = async (): Promise<number | null> => {
		const response = await sendSpectraRequest(
			'spectra.control.snapshot.get',
			{ tabId },
			{ tabId },
		);
		if (!response.ok) throw new Error(response.error.message);
		const speed = response.data?.fields.speed?.actual;
		if (typeof speed !== 'number') throw new Error('The current playback speed is unavailable');
		return speed;
	};

  ui.enable.onchange = (e) => {
    const enabled = (e.target as HTMLInputElement).checked;
    update({ enabled });

  };

  ui.mask.onclick = () => update({ enabled: true });
  ui.mask.onkeydown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      update({ enabled: true });
    }
  };

  const handleVolume = (val: string | number) => {
    const raw = typeof val === 'string' ? Number.parseFloat(val) : val;
    const volume = Math.max(0, Math.min(AUDIO_UI.MAX_VOLUME, raw));
    // `volume` is the single product-level control. mergeAudioConfig performs
    // the internal native-volume/processor-boost split atomically in UI state.
    update({ volume });
  };

	const submitToggle = async (field: 'mediaMuted'): Promise<void> => {
		await update.runControl(async () => {
			const response = await submitControlIntent(
				{ tabId, state, render },
				{ requestedCoverage: 'active-target', mutations: [{ field, operation: 'toggle' }] },
			);
			if (!response.ok) {
				state.lastError = response.error;
				throw new Error(response.error.message);
			}
			state.controlRevision = Math.max(state.controlRevision, response.data.revision);
			state.controlGeneration = Math.max(state.controlGeneration, response.data.generation);
			const fieldState = response.data.fields[field];
			if (fieldState?.phase !== 'applied') {
				const error = fieldState?.lastError ?? {
					code: 'control_not_applied',
					message: 'Mute state was not applied',
					retryable: true,
				};
				state.lastError = error;
				throw new Error(error.message);
			}
		});
	};

  const setDragging = (field: CardInternalState['draggingField']) => {
    state.draggingField = field;
  };

  ui.slider.oninput = (e) => {
    setDragging('volume');
    const raw = (e.target as HTMLInputElement).value;
    const value = Number.parseFloat(raw);
    handleVolume(raw);
    // Paint the fill and readout straight from the pointer value, synchronously
    // in the input handler, before any state merge or cross-process work. The
    // fill therefore cannot trail the thumb even when a full render is still
    // busy on this frame; the frame-coalesced render then reconciles tone and
    // mute.
    //
    // This runs unconditionally: the renderer's number is live too, so the two
    // paths agree and there is nothing to flicker. Mute is the one exception —
    // the renderer owns the MUTE label, so painting a number over it would
    // visibly blink once per frame.
    if (!state.config.muted) {
      const liveColor = gestureVolumeColor(false, value, state.actualMode, state.phase);
      volumeView.paintPointer(value, liveColor);
      ui.slider.style.setProperty('--slider-accent', liveColor);
      // The Action badge is not painted here. It has exactly one owner - the
      // Background's acknowledged projection - because a second writer with the
      // Popup's own idea of "muted" is what could repaint M over a fresh unmute.
    }
  };

  // note: manage dragging state across various input modalities to prevent "flicker" during external UI sync
  ui.slider.onchange = () => {
    setDragging(null);
    void update.flush().catch((error: unknown) => onError?.(error, state));
  };
  ui.slider.onmouseup = () => setDragging(null);
  ui.slider.ontouchend = () => setDragging(null);
  ui.slider.onmousedown = () => setDragging('volume');
  ui.slider.ontouchstart = () => setDragging('volume');

  // eff: enable rapid volume adjustment via mouse wheel with preventDefault to avoid scrolling the popup body
  let wheelTimer: ReturnType<typeof setTimeout> | null = null;
  ui.sliderArea.addEventListener('wheel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!state.config.enabled) return;

    // Set dragging state to prevent render from updating slider.value
    setDragging('volume');

    // The wheel gesture is synthetic: it must read the authoritative card state,
    // not the DOM slider. Reading `ui.slider.value` here made the DOM a second
    // source of truth whenever a render had not caught up yet.
    const currentVolume = resolveAudioVolume(state.config).effectiveVolume;
    const nextVolume = e.deltaY < 0
      ? Math.min(currentVolume + AUDIO_UI.VOLUME_STEP, AUDIO_UI.MAX_VOLUME)
      : Math.max(currentVolume - AUDIO_UI.VOLUME_STEP, 0);
    handleVolume(nextVolume);
    // The thumb is DOM presentation, so writing it after the state update is the
    // one direction allowed: state -> DOM, never DOM -> state. Wheel steps are
    // not driven by the browser, so the card's single projection writer moves it.
    volumeView.setThumb(nextVolume);

    if (!state.config.muted) {
      const liveColor = gestureVolumeColor(false, nextVolume, state.actualMode, state.phase);
      volumeView.paintPointer(nextVolume, liveColor);
      ui.slider.style.setProperty('--slider-accent', liveColor);
    }

    // Clear dragging state after wheel stops (300ms debounce)
    if (wheelTimer) clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      setDragging(null);
      void update.flush().catch((error: unknown) => onError?.(error, state));
    }, 300);
  }, { passive: false });

  ui.mute.onclick = () => {
    void submitToggle('mediaMuted').catch((error: unknown) => {
      onError?.(error, state);
      render();
    });
  };

	ui.btnSave.onclick = async () => {
		try {
			// Persist only the last acknowledged card state. A click can arrive
			// while a debounced EQ/volume mutation is still optimistic; drain it
			// before reading the speed and writing the site preset.
			await update.flush();
			const speed = await readActualSpeed();
      if (speed !== null) state.config = mergeAudioConfig(state.config, { speed });

      const { getCurrentDict } = await import('../views/i18n-apply');
      const dict = getCurrentDict();
      await patchSettings({ scope: 'audio-site', domain, value: state.config, mode: 'replace' });
      // feedback: shared i18n success indicator on the save button
      if (dict) showSaveFeedback(ui.btnSave, true, dict);
    } catch (error: unknown) {
      if (isReportedControlFailure(error)) return;
      const { getCurrentDict } = await import('../views/i18n-apply');
      const dict = getCurrentDict();
      // feedback: shared i18n failure indicator on the save button
      if (dict) showSaveFeedback(ui.btnSave, false, dict);
      showPopupToast(error instanceof Error ? error.message : String(error), 'error');
    }
  };

  // eff: save as global preset — zero-interaction save. The preset name is
  // auto-generated inside saveGlobalPreset so the user is never prompted.
  const saveGlobalButton = ui.btnSaveGlobal;
  if (saveGlobalButton) {
		saveGlobalButton.onclick = async () => {
		try {
			await update.flush();
			const speed = await readActualSpeed();
        if (speed !== null) state.config = mergeAudioConfig(state.config, { speed });

        const { getCurrentDict } = await import('../views/i18n-apply');
        const dict = getCurrentDict();
        const { saveGlobalPreset } = await import('../views/presets-ui');
        await saveGlobalPreset(state.config, dict ?? undefined);
        // feedback: shared i18n success indicator — same style as btnSave
        if (dict) showSaveFeedback(saveGlobalButton, true, dict);
      } catch (error: unknown) {
		if (isReportedControlFailure(error)) return;
		const { getCurrentDict } = await import('../views/i18n-apply');
		const dict = getCurrentDict();
		// feedback: share the same failure indicator as btnSave for consistency.
		if (dict) showSaveFeedback(saveGlobalButton, false, dict);
		showPopupToast(error instanceof Error ? error.message : String(error), 'error');
      }
    };
  }

  ui.btnReset.onclick = () => {
	ui.btnReset.setAttribute('aria-busy', 'true');
	ui.btnReset.setAttribute('disabled', '');
	void (async () => {
		// Drain local slider/EQ mutations first so reset cannot race a trailing
		// debounce that would immediately re-apply the pre-reset values. A failed
		// stale mutation must not cancel the explicit reset that follows it.
		await update.flush().catch((error: unknown) => onError?.(error, state));
		const response = await sendSpectraRequest(
			'spectra.control.operation.submit',
			{
				tabId,
				source: 'popup',
				// Reset is an execution-time command: let the serialized coordinator
				// resolve the current media instead of pinning stale Popup identity.
				target: null,
				operation: 'audio-reset',
				payload: {},
			},
			{ tabId },
		);
		if (!response.ok) throw new Error(response.error.message);
		const acknowledgement = response.data as ControlOperationAck<'audio-reset'>;
		if (acknowledgement.result.reset !== true) throw new Error('Audio reset was not acknowledged');
		state.controlRevision = Math.max(state.controlRevision, acknowledgement.revision);
		state.controlGeneration = Math.max(state.controlGeneration, acknowledgement.generation);
		const acknowledged = mergeControlFields(state.stableConfig, acknowledgement.fields);
		state.stableConfig = mergeAudioConfig(acknowledged, {
			enabled: true,
			volume: 100,
			volumeBase: 100,
			speed: 1,
			boost: 1,
			muted: false,
			compressor: false,
			mono: false,
			bass: false,
			eqValues: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
			pan: 0,
			delay: 0,
		});
		state.config = mergeAudioConfig(state.stableConfig, {
			eqValues: [...state.stableConfig.eqValues],
		});
		state.lastError = null;
	})().catch((error: unknown) => {
		onError?.(error, state);
		if (!onError) {
			const message = error instanceof Error ? error.message : String(error);
			state.lastError = { code: 'audio_reset_failed', message, retryable: true };
			showPopupToast(message, 'error');
		}
	}).finally(() => {
		ui.btnReset.removeAttribute('disabled');
		ui.btnReset.removeAttribute('aria-busy');
		render();
	});
  };

  bindMediaControls(ui, tabId, state, update, render, onError);
}

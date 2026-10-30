// goal: orchestrates DOM updates for a tab control card, syncing visual state with internal audio configuration

import type { CardUIElements } from '../types';
import type { CardInternalState } from './types';
import { COLORS, popupPrimaryColor } from '../constants';
import type { GlobalSettings } from '@nexus/kernel';
import type { AudioSessionPhase, SpectraAudioMode } from '@nexus/contracts';
import { resolveAudioVolume, resolveAudioVolumeState } from '@nexus/contracts';
import { renderPlaybackButton } from './media-events';
import type { VolumeView } from './volume-view';
import type { I18NDict } from '../types';

export interface RenderParams {
  tabId?: number;
  ui: CardUIElements;
  state: CardInternalState;
  volumeView: VolumeView;
  getVizEnabled: () => boolean;
  getGlobalSettings: () => GlobalSettings;
  getDictionary: () => I18NDict;
}

// post: returns a sync-render function that updates HTML elements, CSS variables, and canvas overlays based on current state
export function createRenderFn(params: RenderParams): () => void {
  const { ui, state, volumeView, getVizEnabled, getDictionary } = params;
  // A volume drag repaints at input rate (often >60Hz) but never changes which
  // icon glyph category applies. Rebuilding the mute emoji's DOM on every step
  // cost main-thread time between frames and read as the bar lagging the
  // pointer, so the glyph only recomputes when its category actually changes.
  let lastIconKey = '';

  return () => {
    if (!ui.card) return;

    const config = state.config;
    const volumePresentation = resolveVolumePresentation(state);
    const disabled = !config.enabled;
		const controlUnknown = state.controlSnapshotKnown === false;
		const controlUnavailable = controlUnknown && state.controlSyncExpired === true;
    const muted = state.pendingVolumePresentation?.muted ?? config.muted;

    ui.card.classList.toggle('disabled', disabled);
    ui.card.classList.toggle('muted', muted);
		ui.card.dataset.controlCoverage = controlUnknown ? 'unknown' : 'known';
		ui.card.dataset.lifecycleCoverage = state.lifecycleSnapshotKnown === false ? 'unknown' : 'known';
		const syncStatus = ui.card.querySelector<HTMLElement>('.control-sync-status');
		if (syncStatus) {
			// Two states, one line: still asking, or answered with nothing. The key
			// travels with the text so a language switch keeps whichever one applies.
			const key = controlUnavailable ? 'controlSyncUnavailable' : 'controlSyncing';
			syncStatus.hidden = !controlUnknown;
			if (syncStatus.dataset.i18n !== key) {
				syncStatus.dataset.i18n = key;
				syncStatus.textContent = getDictionary()[key];
			}
		}
		ui.val.setAttribute('aria-busy', String(controlUnknown));

    ui.mask.classList.toggle('hidden', !disabled);
		ui.mask.hidden = !disabled;
		ui.mask.setAttribute('aria-hidden', String(!disabled));
		ui.mask.toggleAttribute('inert', !disabled);
		ui.mask.tabIndex = disabled ? 0 : -1;
		const controls = ui.card.querySelector<HTMLElement>('.control-stack');
		controls?.toggleAttribute('inert', disabled);
		controls?.setAttribute('aria-hidden', String(disabled));
    ui.enable.checked = config.enabled;

    // The thumb follows the gesture immediately. The result label, fill and
    // route color commit together, never a new number with the previous route.
    // Dragging is tracked in card state; reading the slider back here would make
    // the DOM a second authority for the same value.
    const newSliderValue = resolveAudioVolume(config).effectiveVolume;
    ui.mute.classList.toggle('active', muted);
		ui.mute.setAttribute('aria-pressed', String(muted));

		// Pending session/broadcast events cannot recolor the retained result.
		const fillColor = volumePresentation.color;

    // Every write to the fill, the readout and the thumb goes through the
    // card's single volume projection writer, so the frame-coalesced
    // reconciliation and the synchronous pointer path cannot disagree.
    volumeView.commit({
      value: volumePresentation.effectiveVolume,
      color: fillColor,
      muted,
      thumb: state.draggingField === 'volume' ? null : newSliderValue,
    });
    ui.slider.style.setProperty('--slider-accent', fillColor);

    const displayedVolume = volumePresentation.effectiveVolume;

    const iconKey = muted
      ? 'muted'
      : displayedVolume <= 0 ? 'zero' : displayedVolume > 100 ? 'boost' : 'normal';
    if (iconKey !== lastIconKey) {
      lastIconKey = iconKey;
      renderVolumeIcon(ui.mute, muted, displayedVolume);
    }

    if (ui.speedInput) {
      // rule: only update speed input if not focused to avoid interfering with user typing
      if (document.activeElement !== ui.speedInput) {
        ui.speedInput.value = (config.speed || 1.0).toFixed(2);
      }
    }

		const playing = state.controlSnapshot?.fields.playing?.actual;
		if (ui.btnPause && typeof playing === 'boolean') renderPlaybackButton(ui.btnPause, playing);
		const pip = state.controlSnapshot?.fields.pip?.actual;
		if (ui.btnPip && typeof pip === 'boolean') {
			ui.btnPip.classList.toggle('active', pip);
			ui.btnPip.setAttribute('aria-pressed', String(pip));
		}

    if (ui.vizIsland) {
		const vizHidden = !getVizEnabled();
      ui.vizIsland.classList.toggle('hidden', vizHidden);
		ui.vizIsland.hidden = vizHidden;
		ui.vizIsland.setAttribute('aria-hidden', String(vizHidden));
    }
  };
}

// eff: updates the mute button icon glyph and transparency based on silence/boost status
function renderVolumeIcon(
  muteBtn: HTMLElement,
  muted: boolean,
  volume: number,
): void {
  const iconSpan = document.createElement('span');
  iconSpan.style.fontSize = '16px';

  if (muted || volume === 0) {
    iconSpan.textContent = '🔇';
    muteBtn.style.opacity = '0.7';
  } else {
    muteBtn.style.opacity = '1';
    iconSpan.textContent = volume > 100 ? '🚀' : '🔊';
  }

  muteBtn.replaceChildren(iconSpan);
}

export function resolveVolumePresentation(
  state: CardInternalState,
): { effectiveVolume: number; color: string } {
  const presentation = state.pendingVolumePresentation;
  // The number is *always* live. Holding it on the pre-change presentation froze
  // the bar and the readout at the gesture's starting value for as long as the
  // route transaction stayed open, which on a 0..800 slider means any drag that
  // crosses 100 stopped tracking the thumb for the rest of the gesture. That is
  // the "bar does not follow the thumb" symptom, and no amount of render-side
  // optimization can hide it.
  const effectiveVolume = resolveAudioVolume(state.config).effectiveVolume;
  return {
    effectiveVolume,
    // Only the *tone* waits. A route transaction (native <-> boost, or a capture
    // hand-off) cannot be predicted, so the acknowledged route from before the
    // transaction still owns the color until its ACK lands. That keeps a new
    // number from appearing in the previous route's color while leaving the
    // number itself free to track the gesture.
    color: actualVolumeColor(
      presentation?.muted ?? state.config.muted,
      effectiveVolume,
      presentation?.actualMode ?? state.actualMode,
      presentation?.phase ?? state.phase,
    ),
  };
}

export function actualVolumeColor(
  muted: boolean,
  volume: number,
  actualMode: SpectraAudioMode | null,
  phase: AudioSessionPhase,
): string {
  if (muted || volume <= 0) return COLORS.MUTED;
  const state = resolveAudioVolumeState({ muted, volume, actualMode, phase });
  return state === 'capture' ? COLORS.CAPTURE : popupPrimaryColor();
}

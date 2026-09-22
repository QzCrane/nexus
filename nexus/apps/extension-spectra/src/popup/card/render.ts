// goal: orchestrates DOM updates for a tab control card, syncing visual state with internal audio configuration

import type { CardUIElements } from '../types';
import type { CardInternalState } from './types';
import { COLORS, AUDIO_UI } from '../constants';
import type { GlobalSettings } from '@nexus/kernel';
import type { AudioSessionPhase, SpectraAudioMode } from '@nexus/contracts';
import { resolveAudioVolume, resolveAudioVolumeState } from '@nexus/contracts';
import { renderPlaybackButton } from './media-events';

export interface RenderParams {
  ui: CardUIElements;
  state: CardInternalState;
  getVizEnabled: () => boolean;
  getGlobalSettings: () => GlobalSettings;
}

// post: returns a sync-render function that updates HTML elements, CSS variables, and canvas overlays based on current state
export function createRenderFn(params: RenderParams): () => void {
  const { ui, state, getVizEnabled } = params;

  return () => {
    if (!ui.card) return;

    const config = state.config;
    const volumePresentation = resolveVolumePresentation(state);
    const disabled = !config.enabled;
		const controlUnknown = state.controlSnapshotKnown === false;
    const muted = state.pendingVolumePresentation?.muted ?? config.muted;

    ui.card.classList.toggle('disabled', disabled);
    ui.card.classList.toggle('muted', muted);
		ui.card.dataset.controlCoverage = controlUnknown ? 'unknown' : 'known';
		ui.card.dataset.lifecycleCoverage = state.lifecycleSnapshotKnown === false ? 'unknown' : 'known';
		const syncStatus = ui.card.querySelector<HTMLElement>('.control-sync-status');
		if (syncStatus) syncStatus.hidden = !controlUnknown;
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
    const currentSliderValue = parseFloat(ui.slider.value);
    const newSliderValue = resolveAudioVolume(config).effectiveVolume;
    if (currentSliderValue !== newSliderValue) {
      ui.slider.value = String(newSliderValue);
    }
    ui.fill.style.width = `${(volumePresentation.effectiveVolume / AUDIO_UI.MAX_VOLUME) * 100}%`;
    ui.val.innerText = muted ? 'MUTE' : `${formatVolume(volumePresentation.effectiveVolume)}%`;
    ui.mute.classList.toggle('active', muted);
		ui.mute.setAttribute('aria-pressed', String(muted));

		// Pending session/broadcast events cannot recolor the retained result.
		const fillColor = volumePresentation.color;

    ui.fill.style.backgroundColor = fillColor;
    ui.val.style.color = fillColor;
    ui.slider.style.setProperty('--slider-accent', fillColor);

    renderVolumeIcon(ui.mute, muted, volumePresentation.effectiveVolume);

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
    iconSpan.innerText = '🔇';
    muteBtn.style.opacity = '0.7';
  } else {
    muteBtn.style.opacity = '1';
    iconSpan.innerText = volume > 100 ? '🚀' : '🔊';
  }

  muteBtn.replaceChildren(iconSpan);
}

export function resolveVolumePresentation(
  state: CardInternalState,
): { effectiveVolume: number; color: string } {
  const presentation = state.pendingVolumePresentation;
  const effectiveVolume = presentation?.effectiveVolume ?? resolveAudioVolume(state.config).effectiveVolume;
  return {
    effectiveVolume,
    color: actualVolumeColor(
      presentation?.muted ?? state.config.muted,
      effectiveVolume,
      presentation?.actualMode ?? state.actualMode,
      presentation?.phase ?? state.phase,
    ),
  };
}

function formatVolume(volume: number): string {
  return Number.isInteger(volume) ? String(volume) : volume.toFixed(1).replace(/\.0$/u, '');
}

export function actualVolumeColor(
  muted: boolean,
  volume: number,
  actualMode: SpectraAudioMode | null,
  phase: AudioSessionPhase,
): string {
  const state = resolveAudioVolumeState({ muted, volume, actualMode, phase });
  if (state === 'silent') return COLORS.MUTED;
  return state === 'capture' ? COLORS.CAPTURE : COLORS.NATIVE;
}

/**
 * SPECTRA Popup - Card Render Fn
 */

import type { CardUIElements } from '../types';
import type { CardInternalState } from './types';
import { COLORS, AUDIO_UI } from '../constants';
import type { GlobalSettings } from '@nexus/kernel';
import { predictCapture } from '@nexus/audio-engine';

export interface RenderParams {
  ui: CardUIElements;
  state: CardInternalState;
  getCapturing: () => boolean;
  drawEqCurve: (color: string) => void;
  getVizEnabled: () => boolean;
  getGlobalSettings: () => GlobalSettings;
}

export function createRenderFn(params: RenderParams): () => void {
  const { ui, state, getCapturing, drawEqCurve, getVizEnabled, getGlobalSettings } = params;

  return () => {
    if (!ui.card) return;

    const config = state.config;
    const disabled = !config.enabled;
    const muted = config.muted;

    ui.card.classList.toggle('disabled', disabled);
    ui.card.classList.toggle('muted', muted);

    ui.mask.classList.toggle('hidden', !disabled);
    ui.enable.checked = config.enabled;

    ui.slider.value = String(config.volume);
    ui.fill.style.width = `${(config.volume / AUDIO_UI.MAX_VOLUME) * 100}%`;
    ui.val.innerText = muted ? 'MUTE' : `${config.volume}%`;
    ui.mute.classList.toggle('active', muted);

    const actualCapturing = getCapturing();
    const settings = getGlobalSettings();
    // Predictive logic when Capture not active
    const isPredictedCapture = !actualCapturing && predictCapture({
      config,
      isRestricted: state.isRestrictedSite,
      visualizerEnabled: settings.visualizerEnabled,
    });
    const isCapture = actualCapturing || isPredictedCapture;
    const isMutedOrZero = muted || config.volume === 0;

    // Capture = Purple, Native = Blue, Muted = Gray
    let fillColor: string;
    if (isMutedOrZero) {
      fillColor = COLORS.MUTED;
    } else if (isCapture) {
      fillColor = COLORS.CAPTURE;
    } else {
      fillColor = COLORS.NATIVE;
    }

    ui.fill.style.backgroundColor = fillColor;
    ui.val.style.color = fillColor;
    ui.slider.style.setProperty('--slider-accent', fillColor);

    renderVolumeIcon(ui.mute, muted, config.volume);

    // Switches (might be in Side Panel)
    if (ui.comp) ui.comp.checked = config.compressor;
    if (ui.bass) ui.bass.checked = config.bass;
    if (ui.mono) ui.mono.checked = config.mono;

    // EQ Sliders
    ui.eqInputs.forEach((inp, i) => {
      // Prevent jitter while dragging
      if (document.activeElement !== inp) {
        inp.value = String(config.eqValues?.[i] ?? 0);
      }
      const v = config.eqValues?.[i] ?? 0;
      const display = ui.eqVals?.[i];
      if (display) {
        display.innerText = (v > 0 ? '+' : '') + v.toFixed(1);
        display.style.color = v === 0 ? COLORS.MUTED : fillColor;
      }
    });

    drawEqCurve(fillColor);

    if (ui.vizIsland) {
      ui.vizIsland.classList.toggle('hidden', !getVizEnabled());
    }
  };
}

function renderVolumeIcon(muteBtn: HTMLElement, muted: boolean, volume: number): void {
  muteBtn.innerHTML = '';
  const iconSpan = document.createElement('span');
  iconSpan.style.fontSize = '16px';

  if (muted || volume === 0) {
    iconSpan.innerText = '🔇';
    muteBtn.style.opacity = '0.7';
  } else {
    muteBtn.style.opacity = '1';
    iconSpan.innerText = volume > 100 ? '🚀' : '🔊';
  }

  muteBtn.appendChild(iconSpan);
}

// goal: orchestrates DOM updates for a tab control card, syncing visual state with internal audio configuration

import type { CardUIElements } from '../types';
import type { CardInternalState } from './types';
import { COLORS, AUDIO_UI } from '../constants';
import type { GlobalSettings } from '@nexus/kernel';
import { resolveAudioVolume } from '@nexus/contracts';
import { renderPlaybackButton } from './media-events';

export interface RenderParams {
  ui: CardUIElements;
  state: CardInternalState;
  getCapturing: () => boolean;
  drawEqCurve: (color: string) => void;
  getVizEnabled: () => boolean;
  getGlobalSettings: () => GlobalSettings;
}

// post: returns a sync-render function that updates HTML elements, CSS variables, and canvas overlays based on current state
export function createRenderFn(params: RenderParams): () => void {
  const { ui, state, getCapturing, drawEqCurve, getVizEnabled } = params;

  return () => {
    if (!ui.card) return;

    const config = state.config;
    const volume = resolveAudioVolume(config);
    const disabled = !config.enabled;
    const muted = config.muted;

    ui.card.classList.toggle('disabled', disabled);
    ui.card.classList.toggle('muted', muted);

    ui.mask.classList.toggle('hidden', !disabled);
		ui.mask.hidden = !disabled;
		ui.mask.setAttribute('aria-hidden', String(!disabled));
		ui.mask.toggleAttribute('inert', !disabled);
		ui.mask.tabIndex = disabled ? 0 : -1;
		const controls = ui.card.querySelector<HTMLElement>('.control-stack');
		controls?.toggleAttribute('inert', disabled);
		controls?.setAttribute('aria-hidden', String(disabled));
    ui.enable.checked = config.enabled;

    ui.slider.value = String(volume.volumeBase);
    ui.fill.style.width = `${volume.volumeBase}%`;
    ui.val.innerText = muted ? 'MUTE' : `${volume.volumeBase}%`;
    ui.boostSlider.value = String(volume.boost);
    ui.boostFill.style.width = `${((volume.boost - AUDIO_UI.BOOST_MIN) / (AUDIO_UI.BOOST_MAX - AUDIO_UI.BOOST_MIN)) * 100}%`;
    ui.boostVal.innerText = `${volume.boost.toFixed(1)}×`;
    ui.mute.classList.toggle('active', muted);
		ui.mute.setAttribute('aria-pressed', String(muted));

    const actualCapturing = getCapturing();
    const isCapture = actualCapturing;
    const isMutedOrZero = muted || volume.volumeBase === 0;

    // rule: dynamic color coding to indicate source/mode status (Gray: Silenced, Purple: High-Fidelity Capture, Blue: Standard)
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
    ui.boostSlider.style.setProperty('--slider-accent', COLORS.CAPTURE);

    renderVolumeIcon(ui.mute, muted, volume.volumeBase, volume.boost);

    if (ui.comp) ui.comp.checked = config.compressor;
    if (ui.bass) ui.bass.checked = config.bass;
    if (ui.mono) ui.mono.checked = config.mono;

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

    ui.eqInputs.forEach((inp, i) => {
      // rule: skip input value updates if the element is focused to prevent "cursor jumping" during user interaction
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
  volumeBase: number,
  boost: number,
): void {
  const iconSpan = document.createElement('span');
  iconSpan.style.fontSize = '16px';

  if (muted || volumeBase === 0) {
    iconSpan.innerText = '🔇';
    muteBtn.style.opacity = '0.7';
  } else {
    muteBtn.style.opacity = '1';
    iconSpan.innerText = boost > 1 ? '🚀' : '🔊';
  }

  muteBtn.replaceChildren(iconSpan);
}

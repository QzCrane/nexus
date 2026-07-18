// goal: binds native DOM events (clicks, inputs, wheel, touch) to audio configuration updates and registry persistence

import type { CardUIElements } from '../types';
import type { CardInternalState } from './types';
import type { ConfigUpdateFn } from './state';
import { AUDIO_UI, TIMING } from '../constants';
import { getDomain } from '../utils/dom';
import { bindMediaControls } from './media-events';
import { patchSettings } from '../../shared/settings-client';
import { sendSpectraRequest } from '../../shared/ui-spectra-client';
import { showPopupToast } from '../toast';

export interface EventsParams {
  ui: CardUIElements;
  state: CardInternalState;
  tabId: number;
  tabUrl: string;
  update: ConfigUpdateFn;
  getCapturing: () => boolean;
  onMetricsUpdate: () => void;
  render: () => void;
}

// eff: attaches event listeners to the card UI components, managing the lifecycle of user interactions
export function bindCardEvents(params: EventsParams): void {
  const { ui, state, tabId, tabUrl, update, onMetricsUpdate, render } = params;
  const domain = getDomain(tabUrl);

	const readActualSpeed = async (): Promise<number | null> => {
		const response = await sendSpectraRequest(
			'spectra.control.snapshot.get',
			{ tabId },
			{ tabId },
		);
		if (!response.ok) return null;
		const speed = response.data?.fields.speed?.actual;
		return typeof speed === 'number' ? speed : null;
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
		const response = await sendSpectraRequest(
			'spectra.control.intent.submit',
			{
				tabId,
				source: 'popup',
				requestedCoverage: 'active-target',
				target: state.controlSnapshot?.activeMedia ?? null,
				baseRevision: state.controlRevision,
				mutations: [{ field, operation: 'toggle' }],
			},
			{ tabId },
		);
		if (!response.ok) {
			state.lastError = response.error;
			throw new Error(response.error.message);
		}
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
	};

  const setDragging = (field: CardInternalState['draggingField']) => {
    state.draggingField = field;
    state.isDragging = field !== null;
  };

  ui.slider.oninput = (e) => {
    setDragging('volume');
    handleVolume((e.target as HTMLInputElement).value);
  };

  // note: manage dragging state across various input modalities to prevent "flicker" during external UI sync
  ui.slider.onchange = () => {
    setDragging(null);
    void update.flush().catch(() => undefined);
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

    let v = parseInt(ui.slider.value, 10);
    v = e.deltaY < 0
      ? Math.min(v + AUDIO_UI.VOLUME_STEP, AUDIO_UI.MAX_VOLUME)
      : Math.max(v - AUDIO_UI.VOLUME_STEP, 0);
    handleVolume(v);

    // Clear dragging state after wheel stops (300ms debounce)
    if (wheelTimer) clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      setDragging(null);
      void update.flush().catch(() => undefined);
    }, 300);
  }, { passive: false });

  ui.mute.onclick = () => {
	void submitToggle('mediaMuted').catch(() => render());
  };

  if (ui.comp) ui.comp.onchange = (e) => update({ compressor: (e.target as HTMLInputElement).checked });
  if (ui.bass) ui.bass.onchange = (e) => update({ bass: (e.target as HTMLInputElement).checked });
  if (ui.mono) ui.mono.onchange = (e) => update({ mono: (e.target as HTMLInputElement).checked });

  if (ui.eqTrigger && ui.eqDrawer) {
    ui.eqTrigger.onclick = () => {
      ui.eqDrawer.classList.toggle('open');
      const arrow = ui.eqTrigger.querySelector('.eq-arrow');
      if (arrow) {
        arrow.textContent = ui.eqDrawer.classList.contains('open') ? '▲' : '▼';
      }
      // note: trigger metric recalculation after the CSS transition finishes to align the curve spline
      setTimeout(onMetricsUpdate, TIMING.EQ_DRAWER_DELAY);
    };
  }

  if (ui.eqInputs && ui.eqInputs.length > 0) {
    ui.eqInputs.forEach((inp, i) => {
      inp.oninput = (e) => {
        const arr = [...state.config.eqValues];
        arr[i] = parseFloat((e.target as HTMLInputElement).value);
        update({ eqValues: arr });
      };
      inp.onchange = () => {
        void update.flush().catch(() => undefined);
      };

      inp.parentElement?.addEventListener('wheel', (e) => {
        e.preventDefault();
        e.stopPropagation();
        let v = parseFloat(inp.value);
        v = e.deltaY < 0
          ? Math.min(v + AUDIO_UI.EQ_STEP, AUDIO_UI.EQ_MAX)
          : Math.max(v - AUDIO_UI.EQ_STEP, AUDIO_UI.EQ_MIN);
        v = Math.round(v * 10) / 10;

        const arr = [...state.config.eqValues];
        arr[i] = v;
        update({ eqValues: arr });
      }, { passive: false });
    });
  }

  ui.btnSave.onclick = async () => {
    // eff: capture current playback speed to include in the preset
    try {
      const speed = await readActualSpeed();
	  if (speed !== null) {
		state.config.speed = speed;
      }
    } catch (e) {
      console.warn('Failed to get speed for preset save', e);
    }

    try {
      await patchSettings({ scope: 'audio-site', domain, value: state.config, mode: 'replace' });
      // feedback: provide a transient visual confirmation on the save button
      const old = ui.btnSave.innerText;
      ui.btnSave.innerText = '保存成功';
      setTimeout(() => { ui.btnSave.innerText = old; }, TIMING.BUTTON_FEEDBACK_DURATION);
    } catch (error) {
      console.error('Failed to save config:', error);
    }
  };

  // eff: save as global preset
  if (ui.btnSaveGlobal) {
    ui.btnSaveGlobal.onclick = async () => {
      // eff: capture current playback speed
      try {
        const speed = await readActualSpeed();
		if (speed !== null) {
		  state.config.speed = speed;
        }
      } catch (e) {
        console.warn('Failed to get speed for global preset save', e);
      }

      // eff: prompt for preset name
      const { getCurrentDict } = await import('../views/i18n-apply');
      const dict = getCurrentDict();
      const name = prompt(dict?.presetSaveGlobalPrompt || 'Enter preset name:', domain);
      if (!name) return;

      const { saveGlobalPreset } = await import('../views/presets-ui');
      await saveGlobalPreset(name, state.config);

      // feedback
      const old = ui.btnSaveGlobal!.innerText;
      ui.btnSaveGlobal!.innerText = 'OK';
      setTimeout(() => { ui.btnSaveGlobal!.innerText = old; }, TIMING.BUTTON_FEEDBACK_DURATION);
    };
  }

  ui.btnReset.onclick = () => {
	void sendSpectraRequest(
		'spectra.control.operation.submit',
		{
			tabId,
			source: 'popup',
			target: state.controlSnapshot?.activeMedia ?? null,
			baseRevision: state.controlRevision,
			operation: 'audio-reset',
			payload: {},
		},
		{ tabId },
	).then((response) => {
		if (!response.ok) state.lastError = response.error;
	}, (error) => {
		state.lastError = {
			code: 'audio_reset_failed',
			message: error instanceof Error ? error.message : String(error),
			retryable: true,
		};
	}).finally(render);
  };

  bindMediaControls(ui, tabId, state, (changes) => update(changes));
}

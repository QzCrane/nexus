// goal: utility for retrieving and casting references to all interactive DOM elements within a tab control card

import type { CardUIElements } from '../types';

// eff: queries the card container for sliders, toggles, buttons, and display labels, returning a typed element map
export function getCardUIElements(card: HTMLElement): CardUIElements {
  return {
    card,
    title: card.querySelector('.meta-title') as HTMLElement,
    domain: card.querySelector('.meta-domain') as HTMLElement,
    icon: card.querySelector('.meta-icon') as HTMLImageElement,
    enable: card.querySelector('.sw-enable') as HTMLInputElement,
    mask: card.querySelector('.sleep-mask') as HTMLElement,
    maskText: card.querySelector('.sleep-text') as HTMLElement,
    slider: card.querySelector('.vol-slider') as HTMLInputElement,
    fill: card.querySelector('.slider-fill') as HTMLElement,
    val: card.querySelector('.vol-number') as HTMLElement,
    mute: card.querySelector('.btn-mute') as HTMLElement,
    btnSave: card.querySelector('.btn-save') as HTMLElement,
    btnReset: card.querySelector('.btn-reset') as HTMLElement,
    btnSaveGlobal: card.querySelector('.btn-save-global'),
    canvas: card.querySelector('.viz-canvas') as HTMLCanvasElement,
    sliderArea: card.querySelector('.slider-rail-container') as HTMLElement,
    vizIsland: card.querySelector('.viz-island') as HTMLElement | null,
    // Media Controls: context-sensitive buttons for playback, PiP, and tab focus management
    btnPause: card.querySelector('.btn-pause'),
    btnPip: card.querySelector('.btn-pip'),
    btnHotkeyTarget: card.querySelector('.btn-hotkey-target'),
    btnGotoTab: card.querySelector('.btn-goto-tab'),
    speedInput: card.querySelector('.speed-input'),
    speedBtns: card.querySelectorAll('.btn-speed'),
  };
}

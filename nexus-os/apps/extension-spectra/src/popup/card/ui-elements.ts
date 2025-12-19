/**
 * SPECTRA Popup - 获取卡片 UI 元素
 */

import type { CardUIElements } from '../types';

/**
 * 从卡片元素中获取所有 UI 元素引用
 */
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
    comp: card.querySelector('.sw-comp') as HTMLInputElement,
    bass: card.querySelector('.sw-bass') as HTMLInputElement,
    mono: card.querySelector('.sw-mono') as HTMLInputElement,
    eqTrigger: card.querySelector('.eq-trigger') as HTMLElement,
    eqDrawer: card.querySelector('.eq-drawer') as HTMLElement,
    eqInputs: card.querySelectorAll('.eq-col input') as NodeListOf<HTMLInputElement>,
    eqVals: card.querySelectorAll('.eq-val-display') as NodeListOf<HTMLElement>,
    btnSave: card.querySelector('.btn-save') as HTMLElement,
    btnReset: card.querySelector('.btn-reset') as HTMLElement,
    canvas: card.querySelector('.viz-canvas') as HTMLCanvasElement,
    sliderArea: card.querySelector('.slider-rail-container') as HTMLElement,
    tComp: card.querySelector('[data-i18n="comp"]') as HTMLElement,
    tBass: card.querySelector('[data-i18n="bass"]') as HTMLElement,
    tMono: card.querySelector('[data-i18n="mono"]') as HTMLElement,
    tEq: card.querySelector('[data-i18n="eqTitle"]') as HTMLElement,
    vizIsland: card.querySelector('.viz-island') as HTMLElement | null,
  };
}

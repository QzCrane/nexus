// goal: provides streamlined DOM selection helpers and unified cross-process messaging for the popup context

import type { SettingsUIElements } from '../types';
import { RESTRICTED_URL_PREFIXES } from '../constants';
import type {
  SpectraRequestPayload,
  SpectraRequestType,
  SpectraResponseData,
} from '@nexus/contracts';
import { sendSpectraTabRequest } from '../../shared/spectra-client';

export function $<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

// $required: strictly selects an element by ID or throws if missing to prevent silent UI failures
export function $required<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`Required element #${id} not found`);
  return el;
}

export function $$<T extends Element>(selector: string, parent: ParentNode = document): NodeListOf<T> {
  return parent.querySelectorAll<T>(selector);
}

// post: returns a mapped object of DOM references for the global settings panel
export function getSettingsUIElements(): SettingsUIElements {
  return {
    swOsd: $<HTMLInputElement>('set-osd'),
    swViz: $<HTMLInputElement>('set-viz'),
    selLang: $<HTMLSelectElement>('set-lang'),
    txtRegistry: $<HTMLTextAreaElement>('set-registry'),
    groupRegistry: $<HTMLElement>('registry-group'),
    btnSaveReg: $<HTMLElement>('btn-save-registry'),
  };
}

export function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'local';
  }
}

// Browser-provided tab metadata crosses into an extension document. Keep image
// navigation to known image/data and browser URL schemes before assigning src.
export function getSafeImageUrl(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  if (/^data:image\/(?:png|jpe?g|gif|webp|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/=]+$/iu.test(value)) {
    return value;
  }
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'chrome:', 'chrome-extension:'].includes(url.protocol) ? url.href : fallback;
  } catch {
    return fallback;
  }
}

// rule: identifies browser-internal or restricted URLs (e.g. chrome://, edge://) where extensions are disabled
export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true;
  return RESTRICTED_URL_PREFIXES.some(prefix => url.startsWith(prefix));
}

// eff: sends one runtime-validated SPECTRA v2 request to a specific content document
export async function requestTab<T extends SpectraRequestType>(
  tabId: number,
  type: T,
  payload: SpectraRequestPayload<T>,
): Promise<SpectraResponseData<T> | null> {
  try {
    const response = await sendSpectraTabRequest(tabId, type, payload);
    if (response.ok) return response.data;
    console.warn(`[Popup] ${type} rejected: ${response.error.code}: ${response.error.message}`);
    return null;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Receiving end does not exist')) {
      console.debug(`[Popup] tab request skipped for ${type} (no content script)`);
    } else {
      console.error(`[Popup] tab request failed for ${type}:`, error);
    }
    return null;
  }
}



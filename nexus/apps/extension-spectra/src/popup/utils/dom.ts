/**
 * SPECTRA Popup - DOM Utilities
 */

import type { SettingsUIElements } from '../types';
import { RESTRICTED_URL_PREFIXES } from '../constants';
import { createMessenger } from '@nexus/kernel';

export const messenger = createMessenger('popup');

export function $<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

export function $required<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`Required element #${id} not found`);
  return el;
}

export function $$<T extends Element>(selector: string, parent: ParentNode = document): NodeListOf<T> {
  return parent.querySelectorAll<T>(selector);
}

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

export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true;
  return RESTRICTED_URL_PREFIXES.some(prefix => url.startsWith(prefix));
}

export async function sendToTab<T = unknown>(tabId: number, action: string, payload: unknown = {}): Promise<T | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await messenger.sendToTab(tabId, action as any, payload as any) as T;
  } catch (error) {
    console.debug(`[Popup] sendToTab failed for ${action}:`, error);
    return null;
  }
}

export async function sendToBackground<T = unknown>(action: string, payload: unknown = {}): Promise<T | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await messenger.send(action as any, payload as any) as T;
  } catch (error) {
    console.debug(`[Popup] sendToBackground failed for ${action}:`, error);
    return null;
  }
}

export async function ensureInjected(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    return true;
  } catch {
    return false;
  }
}

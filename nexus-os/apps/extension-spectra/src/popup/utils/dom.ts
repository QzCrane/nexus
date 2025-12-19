/**
 * SPECTRA Popup - DOM 辅助函数
 */

import type { SettingsUIElements } from '../types';
import { RESTRICTED_URL_PREFIXES } from '../constants';
import { createMessenger } from '@nexus/kernel';

// ============================================
// NEXUS Messenger 实例 (Popup 专用)
// ============================================

export const messenger = createMessenger('popup');

// ============================================
// 类型安全的 DOM 查询
// ============================================

/** 获取元素 (类型安全) */
export function $<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** 获取元素 (必须存在，否则抛出错误) */
export function $required<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`Required element #${id} not found`);
  return el;
}

/** 选择器查询 */
export function $$<T extends Element>(selector: string, parent: ParentNode = document): NodeListOf<T> {
  return parent.querySelectorAll<T>(selector);
}

// ============================================
// 设置页 UI 元素获取
// ============================================

/** 获取设置页所有 UI 元素引用 */
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

// ============================================
// URL 工具函数
// ============================================

/** 从 URL 提取域名 */
export function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'local';
  }
}

/** 检查 URL 是否受限 (Chrome 内部页面等) */
export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true;
  return RESTRICTED_URL_PREFIXES.some(prefix => url.startsWith(prefix));
}

// ============================================
// 消息发送辅助 (NEXUS Messenger 封装)
// ============================================

/** 向标签页发送 NEXUS 消息 */
export async function sendToTab<T = unknown>(tabId: number, action: string, payload: unknown = {}): Promise<T | null> {
  try {
    return await chrome.tabs.sendMessage(tabId, { action, payload }) as T;
  } catch {
    return null;
  }
}

/** 向 Background 发送 NEXUS 消息 */
export async function sendToBackground<T = unknown>(action: string, payload: unknown = {}): Promise<T | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await messenger.send(action as any, payload as any) as T;
  } catch {
    return null;
  }
}

/** 确保 Content Script 已注入 */
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

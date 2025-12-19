/**
 * SPECTRA Popup - 颜色常量
 */

/** UI 颜色定义 */
export const COLORS = {
  /** 紫色 - Capture 劫持模式 */
  CAPTURE: '#7c3aed',
  /** 蓝色 - Native 原生模式 */
  NATIVE: '#2563eb',
  /** 灰色 - 静音状态 */
  MUTED: '#9ca3af',
  /** 白色 */
  WHITE: '#ffffff',
} as const;

/** EQ 曲线渐变色 */
export const EQ_GRADIENT = {
  TOP: 'rgba(37, 99, 235, 0.25)',
  BOTTOM: 'rgba(37, 99, 235, 0.0)',
  SHADOW: 'rgba(37, 99, 235, 0.5)',
  STROKE: '#2563eb',
} as const;

export type ColorKey = keyof typeof COLORS;

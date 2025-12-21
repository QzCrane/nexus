/**
 * SPECTRA Popup - 颜色常量
 */

import { UIColors } from '@nexus/audio-engine';

/** UI 颜色定义 (从 @nexus/audio-engine 统一导入) */
export const COLORS = UIColors;

/** EQ 曲线渐变色 */
export const EQ_GRADIENT = {
  TOP: 'rgba(37, 99, 235, 0.25)',
  BOTTOM: 'rgba(37, 99, 235, 0.0)',
  SHADOW: 'rgba(37, 99, 235, 0.5)',
  STROKE: '#2563eb',
} as const;

export type ColorKey = keyof typeof COLORS;

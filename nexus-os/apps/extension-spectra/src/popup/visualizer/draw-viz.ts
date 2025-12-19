/**
 * SPECTRA Popup - 频谱条绘制
 */

import { COLORS, UI_SIZES, VIZ_PARAMS } from '../constants';

/**
 * 绘制频谱条可视化
 * 
 * @param canvas - 目标画布
 * @param data - 频率数据数组 (0-255)
 * @param isMuted - 是否静音
 * @param isCapture - 是否 Capture 模式
 */
export function drawViz(
  canvas: HTMLCanvasElement,
  data: number[] | Uint8Array | null,
  isMuted: boolean,
  isCapture: boolean
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;

  // 清空画布
  ctx.clearRect(0, 0, w, h);

  // 静音或无数据时不绘制
  if (!data || isMuted) return;

  const barW = UI_SIZES.VIZ_BAR_WIDTH;
  const gap = UI_SIZES.VIZ_BAR_GAP;
  const count = Math.floor(w / (barW + gap));
  const step = Math.floor(data.length / count) || 1;

  // 根据模式选择颜色
  ctx.fillStyle = isCapture ? COLORS.CAPTURE : COLORS.NATIVE;

  for (let i = 0; i < count; i++) {
    const val = data[i * step] || 0;
    const barH = (val / 255) * h * VIZ_PARAMS.HEIGHT_FACTOR;

    if (barH > VIZ_PARAMS.MIN_VISIBLE_HEIGHT) {
      ctx.fillRect(i * (barW + gap), h - barH, barW, barH);
    }
  }
}

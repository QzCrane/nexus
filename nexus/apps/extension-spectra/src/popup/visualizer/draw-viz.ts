/**
 * SPECTRA Popup - Spectrum Bar Drawing
 */

import { COLORS, UI_SIZES, VIZ_PARAMS } from '../constants';

/**
 * Draws spectrum bar visualization
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

  // Clear canvas
  ctx.clearRect(0, 0, w, h);

  if (!data || isMuted) return;

  const barW = UI_SIZES.VIZ_BAR_WIDTH;
  const gap = UI_SIZES.VIZ_BAR_GAP;
  const count = Math.floor(w / (barW + gap));
  const step = Math.floor(data.length / count) || 1;

  ctx.fillStyle = isCapture ? COLORS.CAPTURE : COLORS.NATIVE;

  for (let i = 0; i < count; i++) {
    const val = data[i * step] || 0;
    const barH = (val / 255) * h * VIZ_PARAMS.HEIGHT_FACTOR;

    if (barH > VIZ_PARAMS.MIN_VISIBLE_HEIGHT) {
      ctx.fillRect(i * (barW + gap), h - barH, barW, barH);
    }
  }
}

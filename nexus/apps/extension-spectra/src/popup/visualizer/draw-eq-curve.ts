// goal: renders a smooth, interpolated curve on a canvas to represent the 10-band equalizer settings

import { UI_SIZES } from '../constants';
import type { MetricsCacheData } from './metrics-cache';

interface Point {
  x: number;
  y: number;
}

// post: converts the theme's opaque color token to an alpha color without
// assuming an rgb() function shape. The previous string replacement produced
// invalid CSS for the canonical hex palette and silently dropped the EQ fill.
export function withAlpha(color: string, alpha: number): string {
  const opacity = Math.max(0, Math.min(1, alpha));
  const value = color.trim();
  const hex = value.match(/^#([\da-f]{3,8})$/iu)?.[1];
  if (hex) {
    const expanded = hex.length === 3 || hex.length === 4
      ? [...hex].map((digit) => `${digit}${digit}`).join('')
      : hex;
    const red = Number.parseInt(expanded.slice(0, 2), 16);
    const green = Number.parseInt(expanded.slice(2, 4), 16);
    const blue = Number.parseInt(expanded.slice(4, 6), 16);
    const sourceAlpha = expanded.length === 8
      ? Number.parseInt(expanded.slice(6, 8), 16) / 255
      : 1;
    return `rgba(${red}, ${green}, ${blue}, ${(sourceAlpha * opacity).toFixed(3)})`;
  }

  const rgb = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/iu);
  if (rgb) {
    const sourceAlpha = rgb[4] === undefined ? 1 : Number(rgb[4]);
    return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${(sourceAlpha * opacity).toFixed(3)})`;
  }

  return value;
}

// eff: calculates spline points from slider offsets and draws a styled curve with gradient fills and shadows
export function drawEqCurve(
  ctx: CanvasRenderingContext2D,
  values: number[],
  cache: MetricsCacheData,
  color: string = '#2563eb'
): void {
  if (!cache.isValid) return;

  const w = cache.width;
  const h = cache.height;

  const points: Point[] = [];

  // note: ensures exactly 10 bands are processed, padding with neutral 0dB if necessary
  const safeValues = [...values];
  while (safeValues.length < 10) safeValues.push(0);

  // note: extend points beyond the canvas edges to ensure the curve appears continuous at the boundaries
  const firstValue = safeValues.at(0);
  if (firstValue === undefined) return;
  points.push({
    x: -20,
    y: cache.midY - (firstValue * cache.scaleFactor),
  });

  for (let i = 0; i < 10; i++) {
    const x = cache.xCoords.at(i);
    const value = safeValues.at(i);
    if (x === undefined || value === undefined) return;
    points.push({
      x,
      y: cache.midY - (value * cache.scaleFactor),
    });
  }

  const lastValue = safeValues.at(9);
  if (lastValue === undefined) return;
  points.push({
    x: w + 20,
    y: cache.midY - (lastValue * cache.scaleFactor),
  });

  // rule: always reset transform and apply DPR scaling to maintain sharpness on high-density displays
  ctx.resetTransform();
  ctx.scale(cache.dpr, cache.dpr);
  ctx.clearRect(0, 0, w, h);

  if (points.length < 2) return;

  // goal: implement a centripetal Catmull-Rom spline via cubic Bezier segments for a smooth "liquid" curve appearance
  const path = new Path2D();
  const firstPoint = points.at(0);
  if (!firstPoint) return;
  path.moveTo(firstPoint.x, firstPoint.y);

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points.at(i === 0 ? 0 : i - 1);
    const p1 = points.at(i);
    const p2 = points.at(i + 1);
    if (!p0 || !p1 || !p2) return;
    const p3 = points[i + 2] ?? p2;

    const tension = 0.5;
    const cp1x = p1.x + (p2.x - p0.x) * tension * 0.33;
    const cp1y = p1.y + (p2.y - p0.y) * tension * 0.33;
    const cp2x = p2.x - (p3.x - p1.x) * tension * 0.33;
    const cp2y = p2.y - (p3.y - p1.y) * tension * 0.33;

    path.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }

  const fillPath = new Path2D(path);
  fillPath.lineTo(w, h);
  fillPath.lineTo(0, h);
  fillPath.closePath();

  // note: generate a dynamic linear gradient that fades from the theme color to transparent at the bottom
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, withAlpha(color, 0.25));
  grad.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = grad;
  ctx.fill(fillPath);

  // rule: apply a subtle bloom effect via shadowBlur and a thick stroke to make the curve feel "premium"
  ctx.shadowColor = withAlpha(color, 0.5);
  ctx.shadowBlur = UI_SIZES.EQ_CURVE_SHADOW_BLUR;
  ctx.shadowOffsetY = 2;
  ctx.lineWidth = UI_SIZES.EQ_CURVE_LINE_WIDTH;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(path);
}

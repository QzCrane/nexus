/**
 * SPECTRA Popup - EQ Curve Drawing
 */

import { EQ_GRADIENT, UI_SIZES } from '../constants';
import type { MetricsCacheData } from './metrics-cache';

interface Point {
  x: number;
  y: number;
}

/**
 * Draws smooth EQ curve using Catmull-Rom spline
 */
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

  // Padding values to ensure at least 10 elements
  const safeValues = [...values];
  while (safeValues.length < 10) safeValues.push(0);

  // Left boundary extension
  points.push({
    x: -20,
    y: cache.midY - (safeValues[0]! * cache.scaleFactor),
  });

  // 10 slider positions
  for (let i = 0; i < 10; i++) {
    points.push({
      x: cache.xCoords[i]!,
      y: cache.midY - (safeValues[i]! * cache.scaleFactor),
    });
  }

  // Right boundary extension
  points.push({
    x: w + 20,
    y: cache.midY - (safeValues[9]! * cache.scaleFactor),
  });

  // Reset transform & apply DPR
  ctx.resetTransform();
  ctx.scale(cache.dpr, cache.dpr);
  ctx.clearRect(0, 0, w, h);

  if (points.length < 2) return;

  // Catmull-Rom spline
  const path = new Path2D();
  const firstPoint = points[0]!;
  path.moveTo(firstPoint.x, firstPoint.y);

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;

    const tension = 0.5;
    const cp1x = p1.x + (p2.x - p0.x) * tension * 0.33;
    const cp1y = p1.y + (p2.y - p0.y) * tension * 0.33;
    const cp2x = p2.x - (p3.x - p1.x) * tension * 0.33;
    const cp2y = p2.y - (p3.y - p1.y) * tension * 0.33;

    path.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }

  // Fill area
  const fillPath = new Path2D(path);
  fillPath.lineTo(w, h);
  fillPath.lineTo(0, h);
  fillPath.closePath();

  // Gradient fill (based on main color)
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, color.replace(')', ', 0.25)').replace('rgb', 'rgba'));
  grad.addColorStop(1, color.replace(')', ', 0.0)').replace('rgb', 'rgba'));
  ctx.fillStyle = grad;
  ctx.fill(fillPath);

  // Stroke curve
  ctx.shadowColor = color.replace(')', ', 0.5)').replace('rgb', 'rgba');
  ctx.shadowBlur = UI_SIZES.EQ_CURVE_SHADOW_BLUR;
  ctx.shadowOffsetY = 2;
  ctx.lineWidth = UI_SIZES.EQ_CURVE_LINE_WIDTH;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(path);
}

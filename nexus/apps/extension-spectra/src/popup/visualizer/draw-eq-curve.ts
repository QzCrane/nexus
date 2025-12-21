/**
 * SPECTRA Popup - EQ 曲线绘制
 */

import { EQ_GRADIENT, UI_SIZES } from '../constants';
import type { MetricsCacheData } from './metrics-cache';

/** 曲线控制点 */
interface Point {
  x: number;
  y: number;
}

/**
 * 绘制 EQ 曲线
 * 
 * @param ctx - 2D 渲染上下文
 * @param values - EQ 值数组 (10段, -12 ~ +12 dB)
 * @param cache - 坐标缓存数据
 * @param color - 曲线主色 (可选)
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

  // 构建控制点
  const points: Point[] = [];

  // 确保 values 至少有 10 个元素
  const safeValues = [...values];
  while (safeValues.length < 10) safeValues.push(0);

  // 左边界延伸点
  points.push({
    x: -20,
    y: cache.midY - (safeValues[0]! * cache.scaleFactor),
  });

  // 10 个滑块位置
  for (let i = 0; i < 10; i++) {
    points.push({
      x: cache.xCoords[i]!,
      y: cache.midY - (safeValues[i]! * cache.scaleFactor),
    });
  }

  // 右边界延伸点
  points.push({
    x: w + 20,
    y: cache.midY - (safeValues[9]! * cache.scaleFactor),
  });

  // 重置变换并设置 DPR 缩放
  ctx.resetTransform();
  ctx.scale(cache.dpr, cache.dpr);
  ctx.clearRect(0, 0, w, h);

  if (points.length < 2) return;

  // 使用 Catmull-Rom 样条绘制平滑曲线
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

  // 创建填充区域
  const fillPath = new Path2D(path);
  fillPath.lineTo(w, h);
  fillPath.lineTo(0, h);
  fillPath.closePath();

  // 渐变填充 (基于主色)
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, color.replace(')', ', 0.25)').replace('rgb', 'rgba'));
  grad.addColorStop(1, color.replace(')', ', 0.0)').replace('rgb', 'rgba'));
  ctx.fillStyle = grad;
  ctx.fill(fillPath);

  // 描边曲线
  ctx.shadowColor = color.replace(')', ', 0.5)').replace('rgb', 'rgba');
  ctx.shadowBlur = UI_SIZES.EQ_CURVE_SHADOW_BLUR;
  ctx.shadowOffsetY = 2;
  ctx.lineWidth = UI_SIZES.EQ_CURVE_LINE_WIDTH;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(path);
}

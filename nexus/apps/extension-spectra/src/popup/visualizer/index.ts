/**
 * SPECTRA Popup - Visualizer 模块导出
 */

// MetricsCache
export { MetricsCache, type MetricsCacheData } from './metrics-cache';

// 绘制函数
export { drawViz } from './draw-viz';
export { drawEqCurve } from './draw-eq-curve';

// 动画循环
export { createVizLoop, type VizLoopParams } from './loop';

// ============================================
// 工厂函数：创建 EQ 曲线绘制器
// ============================================

import { MetricsCache } from './metrics-cache';
import { drawEqCurve } from './draw-eq-curve';

/**
 * 创建 EQ 曲线绘制器
 * 
 * 供 initCard 使用的工厂函数
 */
export function createEqCurveDrawer(
  canvas: HTMLCanvasElement,
  sliderRow: HTMLElement,
  getEqValues: () => number[]
): { draw: (color?: string) => void; updateMetrics: () => void } {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      draw: () => { },
      updateMetrics: () => { },
    };
  }

  let renderRef: (() => void) | null = null;
  let lastColor: string = '#2563eb';

  const metrics = new MetricsCache(sliderRow, canvas, () => {
    if (renderRef) renderRef();
  });

  const draw = (color?: string) => {
    if (color) lastColor = color;
    drawEqCurve(ctx, getEqValues(), metrics, lastColor);
  };

  renderRef = () => draw(lastColor);

  return {
    draw,
    updateMetrics: () => metrics.update(),
  };
}

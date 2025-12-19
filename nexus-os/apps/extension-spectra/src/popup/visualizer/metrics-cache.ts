/**
 * SPECTRA Popup - MetricsCache
 * 
 * 缓存 EQ 滑块位置坐标，用于绘制平滑曲线
 */

import { TIMING } from '../constants';

/** MetricsCache 数据 */
export interface MetricsCacheData {
  xCoords: Float32Array;
  midY: number;
  width: number;
  height: number;
  dpr: number;
  scaleFactor: number;
  isValid: boolean;
}

/**
 * EQ 曲线绘制缓存类
 * 
 * 监听滑块行元素的尺寸变化，自动更新坐标缓存
 */
export class MetricsCache implements MetricsCacheData {
  private row: HTMLElement;
  private canvas: HTMLCanvasElement;
  private onChange: (() => void) | null;
  private observer: ResizeObserver;

  public xCoords: Float32Array = new Float32Array(10);
  public midY = 0;
  public width = 0;
  public height = 0;
  public dpr = 1;
  public scaleFactor = 3.66;
  public isValid = false;

  constructor(
    rowElement: HTMLElement,
    canvas: HTMLCanvasElement,
    onChange?: () => void
  ) {
    this.row = rowElement;
    this.canvas = canvas;
    this.onChange = onChange || null;

    // 监听尺寸变化
    this.observer = new ResizeObserver(() => this.update());
    this.observer.observe(rowElement);

    // 初始更新
    this.update();

    // 初始化循环 (确保首次渲染成功)
    const initLoop = (count: number) => {
      if (this.update() || count <= 0) return;
      requestAnimationFrame(() => initLoop(count - 1));
    };
    initLoop(TIMING.METRICS_INIT_LOOPS);
  }

  /**
   * 更新坐标缓存
   * @returns 是否更新成功
   */
  update(): boolean {
    if (!this.row) return false;

    const rect = this.row.getBoundingClientRect();
    if (rect.width === 0) return false;

    const canvasRect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;

    // 更新画布物理尺寸
    const physW = canvasRect.width * this.dpr;
    const physH = canvasRect.height * this.dpr;
    if (this.canvas.width !== physW || this.canvas.height !== physH) {
      this.canvas.width = physW;
      this.canvas.height = physH;
    }

    this.width = canvasRect.width;
    this.height = canvasRect.height;
    this.midY = (rect.top - canvasRect.top) + (rect.height / 2);

    // 计算缩放因子
    const inputs = this.row.querySelectorAll('input');
    const firstInput = inputs[0];
    if (inputs.length > 0 && firstInput) {
      const inputRect = firstInput.getBoundingClientRect();
      this.scaleFactor = (inputRect.height - 12) / 24;
    }

    // 计算每个滑块的 X 坐标
    inputs.forEach((input, i) => {
      const r = input.getBoundingClientRect();
      this.xCoords[i] = (r.left - canvasRect.left) + (r.width / 2);
    });

    this.isValid = true;
    if (this.onChange) this.onChange();

    return true;
  }

  /** 销毁观察器 */
  destroy(): void {
    this.observer.disconnect();
  }
}

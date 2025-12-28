/**
 * SPECTRA Popup - MetricsCache
 * 
 * Caches EQ slider position coordinates for smooth curve drawing.
 */

import { TIMING } from '../constants';

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
 * EQ Curve Drawing Cache Class
 * 
 * Monitors slider row element size changes and automatically updates coordinate cache.
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

    this.observer = new ResizeObserver(() => this.update());
    this.observer.observe(rowElement);

    this.update();

    // Ensure first render success
    const initLoop = (count: number) => {
      if (this.update() || count <= 0) return;
      requestAnimationFrame(() => initLoop(count - 1));
    };
    initLoop(TIMING.METRICS_INIT_LOOPS);
  }

  update(): boolean {
    if (!this.row) return false;

    const rect = this.row.getBoundingClientRect();
    if (rect.width === 0) return false;

    const canvasRect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;

    // Update canvas physical size
    const physW = canvasRect.width * this.dpr;
    const physH = canvasRect.height * this.dpr;
    if (this.canvas.width !== physW || this.canvas.height !== physH) {
      this.canvas.width = physW;
      this.canvas.height = physH;
    }

    this.width = canvasRect.width;
    this.height = canvasRect.height;
    this.midY = (rect.top - canvasRect.top) + (rect.height / 2);

    const inputs = this.row.querySelectorAll('input');
    const firstInput = inputs[0];
    if (inputs.length > 0 && firstInput) {
      const inputRect = firstInput.getBoundingClientRect();
      this.scaleFactor = (inputRect.height - 12) / 24; // 12/24 based on CSS calc
    }

    inputs.forEach((input, i) => {
      const r = input.getBoundingClientRect();
      this.xCoords[i] = (r.left - canvasRect.left) + (r.width / 2);
    });

    this.isValid = true;
    if (this.onChange) this.onChange();

    return true;
  }

  destroy(): void {
    this.observer.disconnect();
  }
}

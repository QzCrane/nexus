/**
 * SPECTRA Popup - 侧边面板 EQ 曲线绘制
 * 1:1 复刻原版 draw-eq-curve.ts + MetricsCache 实现
 */

import { MetricsCache, type MetricsCacheData } from '../visualizer/metrics-cache';
import { drawEqCurve } from '../visualizer/draw-eq-curve';

/** 缓存实例 */
let metricsCache: MetricsCache | null = null;
let cachedCanvas: HTMLCanvasElement | null = null;
let cachedInputs: NodeListOf<HTMLInputElement> | null = null;

/**
 * 内部绘制函数 (用于 MetricsCache 回调，避免循环)
 */
function internalDraw(): void {
	if (!cachedCanvas || !cachedInputs || cachedInputs.length === 0) return;
	if (!metricsCache || !metricsCache.isValid) return;

	const ctx = cachedCanvas.getContext('2d');
	if (!ctx) return;

	const values: number[] = [];
	cachedInputs.forEach((inp) => values.push(parseFloat(inp.value) || 0));
	drawEqCurve(ctx, values, metricsCache, '#2563eb');
}

/**
 * 初始化侧边面板 EQ 曲线绘制器
 * 
 * 使用原版 MetricsCache 和 drawEqCurve
 */
export function initSidePanelEqCurve(
	canvas: HTMLCanvasElement | null,
	sliderRow: HTMLElement | null,
	inputs: NodeListOf<HTMLInputElement>
): void {
	if (!canvas || !sliderRow || inputs.length === 0) return;

	const ctx = canvas.getContext('2d');
	if (!ctx) return;

	// 缓存引用
	cachedCanvas = canvas;
	cachedInputs = inputs;

	// 销毁旧的缓存
	if (metricsCache) metricsCache.destroy();

	// 创建新的 MetricsCache (回调使用内部函数避免循环)
	metricsCache = new MetricsCache(sliderRow, canvas, internalDraw);
}

/**
 * 绘制侧边面板 EQ 曲线
 * 
 * 使用原版 drawEqCurve 函数
 */
export function drawSidePanelEqCurve(
	canvas: HTMLCanvasElement | null,
	inputs: NodeListOf<HTMLInputElement>
): void {
	if (!canvas || inputs.length === 0) return;

	const ctx = canvas.getContext('2d');
	if (!ctx) return;

	// 获取 EQ 值
	const values: number[] = [];
	inputs.forEach((inp) => values.push(parseFloat(inp.value) || 0));

	// 优先使用 MetricsCache
	if (metricsCache && metricsCache.isValid) {
		drawEqCurve(ctx, values, metricsCache, '#2563eb');
		return;
	}

	// 降级：直接计算并绘制
	fallbackDraw(ctx, canvas, inputs, values);
}

/**
 * 降级绘制 (缓存不可用时)
 */
function fallbackDraw(
	ctx: CanvasRenderingContext2D,
	canvas: HTMLCanvasElement,
	inputs: NodeListOf<HTMLInputElement>,
	values: number[]
): void {
	const canvasRect = canvas.getBoundingClientRect();
	if (canvasRect.width === 0 || canvasRect.height === 0) return;

	const dpr = window.devicePixelRatio || 1;

	// 更新 canvas 物理尺寸
	if (canvas.width !== canvasRect.width * dpr) {
		canvas.width = canvasRect.width * dpr;
		canvas.height = canvasRect.height * dpr;
	}

	const w = canvasRect.width;
	const h = canvasRect.height;
	const midY = h / 2;
	const scaleFactor = (h - 20) / 24; // -12 ~ +12 dB

	// 计算 X 坐标
	const xCoords: number[] = [];
	inputs.forEach((inp) => {
		const r = inp.getBoundingClientRect();
		xCoords.push((r.left - canvasRect.left) + (r.width / 2));
	});

	// 构建缓存数据
	const cache: MetricsCacheData = {
		xCoords: new Float32Array(xCoords),
		midY,
		width: w,
		height: h,
		dpr,
		scaleFactor,
		isValid: true,
	};

	drawEqCurve(ctx, values, cache, '#2563eb');
}

/**
 * 销毁缓存
 */
export function destroySidePanelEqCurve(): void {
	if (metricsCache) {
		metricsCache.destroy();
		metricsCache = null;
	}
	cachedCanvas = null;
	cachedInputs = null;
}



/**
 * SPECTRA Popup - 侧边面板 EQ 曲线绘制
 * 复刻原版 draw-eq-curve.ts 的 Catmull-Rom 样条曲线实现
 */

/** 曲线控制点 */
interface Point {
	x: number;
	y: number;
}

/** 缓存数据 */
interface CacheData {
	xCoords: number[];
	midY: number;
	width: number;
	height: number;
	scaleFactor: number;
}

/** 计算滑块位置并绘制曲线 */
export function drawSidePanelEqCurve(
	canvas: HTMLCanvasElement | null,
	inputs: NodeListOf<HTMLInputElement>
): void {
	if (!canvas || inputs.length === 0) return;
	const ctx = canvas.getContext('2d');
	if (!ctx) return;

	// 计算缓存数据
	const container = canvas.parentElement;
	if (!container) return;

	const canvasRect = canvas.getBoundingClientRect();
	const cache: CacheData = {
		xCoords: [],
		midY: canvasRect.height / 2,
		width: canvasRect.width,
		height: canvasRect.height,
		scaleFactor: (canvasRect.height - 20) / 24, // -12 to +12 dB
	};

	// 计算每个滑块的 X 坐标
	inputs.forEach((inp) => {
		const r = inp.getBoundingClientRect();
		cache.xCoords.push((r.left - canvasRect.left) + (r.width / 2));
	});

	// 获取 EQ 值
	const values: number[] = [];
	inputs.forEach((inp) => values.push(parseFloat(inp.value) || 0));

	// 构建控制点
	const points: Point[] = [];

	// 左边界延伸点
	points.push({
		x: -20,
		y: cache.midY - (values[0]! * cache.scaleFactor),
	});

	// 10 个滑块位置
	for (let i = 0; i < values.length; i++) {
		points.push({
			x: cache.xCoords[i]!,
			y: cache.midY - (values[i]! * cache.scaleFactor),
		});
	}

	// 右边界延伸点
	points.push({
		x: cache.width + 20,
		y: cache.midY - (values[values.length - 1]! * cache.scaleFactor),
	});

	// 更新 canvas 尺寸
	const dpr = window.devicePixelRatio || 1;
	if (canvas.width !== canvasRect.width * dpr) {
		canvas.width = canvasRect.width * dpr;
		canvas.height = canvasRect.height * dpr;
	}

	// 重置并缩放
	ctx.resetTransform();
	ctx.scale(dpr, dpr);
	ctx.clearRect(0, 0, cache.width, cache.height);

	if (points.length < 2) return;

	// Catmull-Rom 样条曲线
	const path = new Path2D();
	path.moveTo(points[0]!.x, points[0]!.y);

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

	// 填充区域
	const fillPath = new Path2D(path);
	fillPath.lineTo(cache.width, cache.height);
	fillPath.lineTo(0, cache.height);
	fillPath.closePath();

	// 渐变填充
	const color = '#2563eb';
	const grad = ctx.createLinearGradient(0, 0, 0, cache.height);
	grad.addColorStop(0, 'rgba(37, 99, 235, 0.25)');
	grad.addColorStop(1, 'rgba(37, 99, 235, 0)');
	ctx.fillStyle = grad;
	ctx.fill(fillPath);

	// 描边
	ctx.shadowColor = 'rgba(37, 99, 235, 0.5)';
	ctx.shadowBlur = 8;
	ctx.shadowOffsetY = 2;
	ctx.lineWidth = 2;
	ctx.strokeStyle = color;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.stroke(path);
}

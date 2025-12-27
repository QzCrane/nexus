/**
 * Smooth Scroll Engine - Mac 风格丝滑滚动
 * 使用 requestAnimationFrame + 缓动函数模拟惯性滚动
 */

/* ====== 配置 ====== */
const CONFIG = {
	/** 滚动灵敏度倍数 (0.6 = 较细腻) */
	sensitivity: 0.6,
	/** 动画时长 (ms) */
	duration: 600,
	/** 缓动函数: ease-out-quart，模拟 Mac 减速曲线 */
	easing: (t: number) => 1 - Math.pow(1 - t, 4),
};

/* ====== 状态 ====== */
interface ScrollState {
	/** 当前滚动容器 */
	container: HTMLElement | null;
	/** 动画 ID */
	animationId: number | null;
	/** 目标滚动位置 */
	targetY: number;
	/** 动画开始时的滚动位置 */
	startY: number;
	/** 动画开始时间 */
	startTime: number;
}

const state: ScrollState = {
	container: null,
	animationId: null,
	targetY: 0,
	startY: 0,
	startTime: 0,
};

/* ====== 核心动画 ====== */

/**
 * 执行平滑滚动动画帧
 */
function animateScroll(timestamp: number): void {
	if (!state.container) return;

	// 首帧记录开始时间
	if (!state.startTime) {
		state.startTime = timestamp;
	}

	const elapsed = timestamp - state.startTime;
	const progress = Math.min(elapsed / CONFIG.duration, 1);
	const easedProgress = CONFIG.easing(progress);

	// 计算当前位置
	const currentY = state.startY + (state.targetY - state.startY) * easedProgress;
	state.container.scrollTop = currentY;

	// 动画未完成，继续
	if (progress < 1) {
		state.animationId = requestAnimationFrame(animateScroll);
	} else {
		state.animationId = null;
	}
}

/**
 * 滚动到目标位置
 */
function scrollTo(container: HTMLElement, targetY: number): void {
	// 取消正在进行的动画
	if (state.animationId !== null) {
		cancelAnimationFrame(state.animationId);
	}

	// 边界限制
	const maxScroll = container.scrollHeight - container.clientHeight;
	const clampedTarget = Math.max(0, Math.min(targetY, maxScroll));

	// 更新状态
	state.container = container;
	state.startY = container.scrollTop;
	state.targetY = clampedTarget;
	state.startTime = 0;

	// 启动动画
	state.animationId = requestAnimationFrame(animateScroll);
}

/* ====== 事件处理 ====== */

/**
 * 处理滚轮事件
 */
function handleWheel(event: WheelEvent): void {
	// 查找最近的可滚动容器
	const container = findScrollableParent(event.target as HTMLElement);
	if (!container) return;

	// 阻止默认滚动
	event.preventDefault();

	// 计算滚动增量 (deltaY 正值向下，负值向上)
	const delta = event.deltaY * CONFIG.sensitivity;

	// 累加到目标位置 (如果动画进行中，追加到目标)
	const currentTarget =
		state.container === container && state.animationId !== null
			? state.targetY
			: container.scrollTop;

	scrollTo(container, currentTarget + delta);
}

/**
 * 查找最近的可滚动父容器
 */
function findScrollableParent(element: HTMLElement | null): HTMLElement | null {
	while (element && element !== document.body) {
		const style = getComputedStyle(element);
		const overflowY = style.overflowY;

		// 检查是否可滚动
		if (
			(overflowY === 'auto' || overflowY === 'scroll') &&
			element.scrollHeight > element.clientHeight
		) {
			return element;
		}

		element = element.parentElement;
	}

	// 回退到 html/body
	const html = document.documentElement;
	if (html.scrollHeight > html.clientHeight) {
		return html;
	}

	return null;
}

/* ====== 初始化 ====== */

/**
 * 启用丝滑滚动
 * @param root 限定作用域的根元素 (默认 document)
 */
export function enableSmoothScroll(root: Document | HTMLElement = document): void {
	root.addEventListener('wheel', handleWheel as EventListener, { passive: false });
	console.log('[SPECTRA] Smooth scroll enabled');
}

/**
 * 禁用丝滑滚动
 */
export function disableSmoothScroll(root: Document | HTMLElement = document): void {
	root.removeEventListener('wheel', handleWheel as EventListener);
	if (state.animationId !== null) {
		cancelAnimationFrame(state.animationId);
		state.animationId = null;
	}
	console.log('[SPECTRA] Smooth scroll disabled');
}

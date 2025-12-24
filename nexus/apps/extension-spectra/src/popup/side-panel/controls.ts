/**
 * SPECTRA Popup - 侧边面板控件绑定
 * 职责：绑定侧边面板中的 Audio/EQ 等控件事件
 */

import type { AudioConfig } from '@nexus/kernel';
import { initSidePanelEqCurve, drawSidePanelEqCurve } from './eq-curve';
import { bindSpeedControls, addWheelSupport, syncSidePanelSpeed } from './speed-controls';

// 导出供外部使用
export { syncSidePanelSpeed };

/** 侧边面板控件元素 */
interface SidePanelControls {
	comp: HTMLInputElement | null;
	bass: HTMLInputElement | null;
	mono: HTMLInputElement | null;
	speedSlider: HTMLInputElement | null;
	speedInput: HTMLInputElement | null;
	eqCanvas: HTMLCanvasElement | null;
	eqInputs: NodeListOf<HTMLInputElement>;
	eqVals: NodeListOf<HTMLElement>;
	panSlider: HTMLInputElement | null;
	delaySlider: HTMLInputElement | null;
	delayVal: HTMLElement | null;
}

let currentConfig: AudioConfig | null = null;

/** 获取侧边面板控件元素 */
function getControls(): SidePanelControls {
	const panel = document.getElementById('side-panel');
	const empty = document.querySelectorAll('.never-match') as NodeListOf<HTMLInputElement>;
	if (!panel) {
		return {
			comp: null, bass: null, mono: null,
			speedSlider: null, speedInput: null,
			eqCanvas: null, eqInputs: empty, eqVals: empty as unknown as NodeListOf<HTMLElement>,
			panSlider: null, delaySlider: null, delayVal: null,
		};
	}
	return {
		comp: panel.querySelector('.sp-sw-comp'),
		bass: panel.querySelector('.sp-sw-bass'),
		mono: panel.querySelector('.sp-sw-mono'),
		speedSlider: panel.querySelector('.sp-speed-slider'),
		speedInput: panel.querySelector('.sp-speed-input'),
		eqCanvas: panel.querySelector('.sp-eq-curve-canvas'),
		eqInputs: panel.querySelectorAll('.sp-eq-input'),
		eqVals: panel.querySelectorAll('.sp-eq-val'),
		panSlider: panel.querySelector('.sp-pan'),
		delaySlider: panel.querySelector('.sp-delay'),
		delayVal: panel.querySelector('.sp-delay-val'),
	};
}

/** 绑定侧边面板控件 */
export function bindSidePanelControls(
	config: AudioConfig,
	updateFn: (changes: Partial<AudioConfig>) => void,
	tabId: number
): void {
	currentConfig = config;
	const c = getControls();

	// Audio chips
	bindAudioChips(c, config, updateFn);

	// Speed 速度控制
	bindSpeedControls(c, tabId);

	// Pan 声道平衡 + 滚轮
	bindPanControl(c, config, updateFn);

	// Delay 声画同步 + 滚轮
	bindDelayControl(c, config, updateFn);

	// EQ sliders
	bindEq(c, config, updateFn);
}

/** 绑定音频开关 */
function bindAudioChips(c: SidePanelControls, config: AudioConfig, updateFn: (changes: Partial<AudioConfig>) => void): void {
	if (c.comp) {
		c.comp.checked = config.compressor;
		c.comp.onchange = (e) => updateFn({ compressor: (e.target as HTMLInputElement).checked });
	}
	if (c.bass) {
		c.bass.checked = config.bass;
		c.bass.onchange = (e) => updateFn({ bass: (e.target as HTMLInputElement).checked });
	}
	if (c.mono) {
		c.mono.checked = config.mono;
		c.mono.onchange = (e) => updateFn({ mono: (e.target as HTMLInputElement).checked });
	}
}

/** 绑定声道平衡 */
function bindPanControl(c: SidePanelControls, config: AudioConfig, updateFn: (changes: Partial<AudioConfig>) => void): void {
	if (c.panSlider) {
		c.panSlider.value = String(config.pan ?? 0);
		c.panSlider.oninput = (e) => updateFn({ pan: parseFloat((e.target as HTMLInputElement).value) });
		addWheelSupport(c.panSlider, 0.1, -1, 1, (v) => updateFn({ pan: v }));
	}
}

/** 绑定延迟控制 */
function bindDelayControl(c: SidePanelControls, config: AudioConfig, updateFn: (changes: Partial<AudioConfig>) => void): void {
	if (c.delaySlider) {
		c.delaySlider.value = String(config.delay ?? 0);
		if (c.delayVal) c.delayVal.textContent = `${config.delay ?? 0}ms`;
		c.delaySlider.oninput = (e) => {
			const delay = parseInt((e.target as HTMLInputElement).value, 10);
			if (c.delayVal) c.delayVal.textContent = `${delay}ms`;
			updateFn({ delay });
		};
		addWheelSupport(c.delaySlider, 10, -500, 500, (v) => {
			if (c.delayVal) c.delayVal.textContent = `${v}ms`;
			updateFn({ delay: v });
		});
	}
}

/** 绑定 EQ 滑块 */
function bindEq(c: SidePanelControls, config: AudioConfig, updateFn: (changes: Partial<AudioConfig>) => void): void {
	const panel = document.getElementById('side-panel');
	const sliderRow = panel?.querySelector('.sp-eq-sliders-row') as HTMLElement | null;
	initSidePanelEqCurve(c.eqCanvas, sliderRow, c.eqInputs);

	c.eqInputs.forEach((inp, i) => {
		const v = config.eqValues?.[i] ?? 0;
		inp.value = String(v);
		updateValDisplay(c.eqVals[i], v);

		inp.oninput = (e) => {
			const val = parseFloat((e.target as HTMLInputElement).value);
			updateValDisplay(c.eqVals[i], val);
			drawSidePanelEqCurve(c.eqCanvas, c.eqInputs);
		};

		inp.onchange = (e) => {
			const arr = [...(currentConfig?.eqValues ?? Array(10).fill(0))];
			arr[i] = parseFloat((e.target as HTMLInputElement).value);
			updateFn({ eqValues: arr });
		};

		// EQ 滑块滚轮支持
		inp.parentElement?.addEventListener('wheel', (e) => {
			e.preventDefault();
			let v = parseFloat(inp.value);
			v = e.deltaY < 0 ? Math.min(v + 0.5, 12) : Math.max(v - 0.5, -12);
			v = Math.round(v * 10) / 10;
			inp.value = String(v);
			updateValDisplay(c.eqVals[i], v);
			drawSidePanelEqCurve(c.eqCanvas, c.eqInputs);
			const arr = [...(currentConfig?.eqValues ?? Array(10).fill(0))];
			arr[i] = v;
			updateFn({ eqValues: arr });
		}, { passive: false });
	});

	drawSidePanelEqCurve(c.eqCanvas, c.eqInputs);
}

/** 更新值显示 */
function updateValDisplay(el: HTMLElement | undefined, v: number): void {
	if (el) el.innerText = (v > 0 ? '+' : '') + v.toFixed(1);
}

/** 同步侧边面板状态 */
export function syncSidePanelState(config: AudioConfig): void {
	currentConfig = config;
	const c = getControls();

	if (c.comp) c.comp.checked = config.compressor;
	if (c.bass) c.bass.checked = config.bass;
	if (c.mono) c.mono.checked = config.mono;
	if (c.panSlider) c.panSlider.value = String(config.pan ?? 0);
	if (c.delaySlider) {
		c.delaySlider.value = String(config.delay ?? 0);
		if (c.delayVal) c.delayVal.textContent = `${config.delay ?? 0}ms`;
	}

	c.eqInputs.forEach((inp, i) => {
		const v = config.eqValues?.[i] ?? 0;
		inp.value = String(v);
		updateValDisplay(c.eqVals[i], v);
	});

	drawSidePanelEqCurve(c.eqCanvas, c.eqInputs);
}

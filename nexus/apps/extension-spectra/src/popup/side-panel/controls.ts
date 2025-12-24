/**
 * SPECTRA Popup - 侧边面板控件绑定
 * 职责：绑定侧边面板中的 Audio/EQ 等控件事件
 */

import type { AudioConfig } from '@nexus/kernel';
import { drawSidePanelEqCurve } from './eq-curve';

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
	};
}

/** 绑定侧边面板控件 */
export function bindSidePanelControls(
	config: AudioConfig,
	updateFn: (changes: Partial<AudioConfig>) => void
): void {
	currentConfig = config;
	const c = getControls();

	// Audio chips
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

	// Speed (预留，待 AudioConfig 添加 speed 属性)
	if (c.speedSlider) c.speedSlider.value = '1';
	if (c.speedInput) c.speedInput.value = '1.00';

	// EQ sliders
	bindEq(c, config, updateFn);
}

/** 绑定 EQ 滑块 */
function bindEq(
	c: SidePanelControls,
	config: AudioConfig,
	updateFn: (changes: Partial<AudioConfig>) => void
): void {
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

	c.eqInputs.forEach((inp, i) => {
		const v = config.eqValues?.[i] ?? 0;
		inp.value = String(v);
		updateValDisplay(c.eqVals[i], v);
	});

	drawSidePanelEqCurve(c.eqCanvas, c.eqInputs);
}

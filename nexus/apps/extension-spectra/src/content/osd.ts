/**
 * SPECTRA Content Script - OSD 屏幕提示
 * 
 * 负责在用户使用快捷键调节音量时显示屏幕提示
 */

import type { AudioConfig } from '@nexus/kernel';
import type { ContentGlobalSettings } from './settings-manager';

/** OSD 状态 */
interface OSDState {
	container: ShadowRoot | null;
	timer: ReturnType<typeof setTimeout> | null;
}

const state: OSDState = {
	container: null,
	timer: null,
};

/**
 * 显示 OSD 提示
 */
export function showOSD(
	config: AudioConfig,
	isCapture: boolean,
	settings: ContentGlobalSettings,
	isPopupOpen: boolean
): void {
	// 如果 Popup 已打开或 OSD 被禁用，不显示
	if (isPopupOpen || !settings.osdEnabled) return;
	if (!config.enabled) return;

	if (!state.container) createOSD();
	if (!state.container) return;

	const osd = state.container.getElementById('osd');
	const fill = state.container.getElementById('fill');
	const val = state.container.getElementById('val');
	const icon = state.container.getElementById('icon');

	if (!osd || !fill || !val || !icon) return;

	osd.classList.add('visible');

	// 颜色逻辑：Capture = 紫色, Native = 蓝色
	osd.classList.toggle('capture', isCapture);

	const isMuted = config.muted || config.volume === 0;
	osd.classList.toggle('muted', isMuted);

	// 进度条宽度 (800% 为最大)
	fill.style.width = Math.min(100, (config.volume / 800) * 100) + '%';
	val.innerText = isMuted ? 'MUTE' : config.volume + '%';
	icon.innerText = isMuted ? '🔇' : (config.volume > 100 ? '🚀' : '🔊');

	if (state.timer) clearTimeout(state.timer);
	state.timer = setTimeout(() => osd.classList.remove('visible'), 2000);
}

/** 创建 OSD DOM 结构 */
function createOSD(): void {
	if (!document.body) return;

	const host = document.createElement('div');
	host.style.cssText = 'position: fixed; top: 15%; left: 50%; transform: translateX(-50%); z-index: 2147483647; pointer-events: none;';
	document.body.appendChild(host);

	const shadow = host.attachShadow({ mode: 'open' });
	shadow.innerHTML = `
    <style>
      .osd { background: rgba(20,20,30,0.85); backdrop-filter: blur(8px); padding: 12px 20px; border-radius: 30px; color: white; display: flex; align-items: center; gap: 12px; font-family: system-ui, sans-serif; transition: opacity 0.2s, transform 0.2s; opacity: 0; transform: translateY(-10px); }
      .osd.visible { opacity: 1; transform: translateY(0); }
      .bar-bg { width: 120px; height: 6px; background: rgba(255,255,255,0.2); border-radius: 3px; overflow: hidden; position: relative; }
      .bar-fill { height: 100%; width: 0%; transition: width 0.05s linear; border-radius: 3px; }
      .marker { position: absolute; left: 12.5%; top: 0; bottom: 0; width: 2px; background: rgba(255,255,255,0.6); z-index: 5; }
      .text { font-weight: 600; font-size: 14px; min-width: 40px; text-align: right; }
      .bar-fill { background: #3b82f6; }
      .osd.capture .bar-fill { background: #8b5cf6; }
      .osd.muted .bar-fill { background: #9ca3af !important; }
      .osd.muted #icon { opacity: 0.6; }
    </style>
    <div class="osd" id="osd">
      <span id="icon">🔊</span>
      <div class="bar-bg">
        <div class="marker"></div>
        <div class="bar-fill" id="fill"></div>
      </div>
      <span class="text" id="val">100%</span>
    </div>
  `;
	state.container = shadow;
}

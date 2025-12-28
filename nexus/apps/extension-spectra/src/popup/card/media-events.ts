/**
 * SPECTRA Popup - Card Media Events
 *
 * Responsibilities: Bind Pause/Play, PiP, Speed, Hotkey Target controls.
 */

import type { CardUIElements } from '../types';
import { sendToTab } from '../utils/dom';
import { syncSidePanelSpeed } from '../side-panel/controls';

const PAUSE_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
const PLAY_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

export function bindMediaControls(ui: CardUIElements, tabId: number): void {
	// Pause/Play
	if (ui.btnPause) {
		ui.btnPause.onclick = async () => {
			const res = await sendToTab<{ playing: boolean }>(tabId, 'MEDIA_TOGGLE_PLAY', {});
			if (res && ui.btnPause) {
				ui.btnPause.innerHTML = res.playing ? PAUSE_SVG : PLAY_SVG;
			}
		};
	}

	// PiP
	if (ui.btnPip) {
		ui.btnPip.onclick = async () => {
			const res = await sendToTab<{ active: boolean }>(tabId, 'MEDIA_TOGGLE_PIP', {});
			if (res && ui.btnPip) {
				ui.btnPip.classList.toggle('active', res.active);
			}
		};
	}

	// Speed Buttons
	ui.speedBtns.forEach(btn => {
		btn.onclick = async () => {
			const delta = parseFloat(btn.dataset.delta || '0');
			const stateRes = await sendToTab<{ speed: number }>(tabId, 'MEDIA_GET_STATE', {});
			const currentSpeed = stateRes?.speed ?? 1;
			const newSpeed = Math.max(0.1, Math.min(16, currentSpeed + delta));
			const res = await sendToTab<{ speed: number }>(tabId, 'MEDIA_SET_SPEED', { speed: newSpeed });
			if (res && ui.speedInput) {
				ui.speedInput.value = res.speed.toFixed(2);
			}
		};
	});

	// Speed Input - change + wheel
	if (ui.speedInput) {
		const updateSpeed = async (speed: number) => {
			const clampedSpeed = Math.max(0.1, Math.min(16, speed));
			const res = await sendToTab<{ speed: number }>(tabId, 'MEDIA_SET_SPEED', { speed: clampedSpeed });
			if (res) {
				const finalSpeed = res.speed;
				if (ui.speedInput) ui.speedInput.value = finalSpeed.toFixed(2);
				// Sync Side Panel
				syncSidePanelSpeed(finalSpeed);
			}
		};

		ui.speedInput.onchange = (e) => {
			const speed = parseFloat((e.target as HTMLInputElement).value) || 1;
			updateSpeed(speed);
		};

		// Wheel support
		ui.speedInput.onwheel = (e) => {
			e.preventDefault();
			const current = parseFloat(ui.speedInput!.value) || 1;
			const delta = e.deltaY < 0 ? 0.1 : -0.1;
			updateSpeed(current + delta);
		};
	}

	// Hotkey Target Button
	if (ui.btnHotkeyTarget) {
		const btn = ui.btnHotkeyTarget;

		// Init: Check storage
		chrome.storage.local.get(['hotkeyTargetTabId'], (result) => {
			if (result.hotkeyTargetTabId === tabId) {
				btn.classList.add('active');
			}
		});

		// Toggle: Set current tab as target
		btn.onclick = () => {
			chrome.storage.local.set({ hotkeyTargetTabId: tabId }, () => {
				document.querySelectorAll('.btn-hotkey-target').forEach(b => b.classList.remove('active'));
				btn.classList.add('active');
			});
		};
	}

	// Goto Tab Button
	if (ui.btnGotoTab) {
		ui.btnGotoTab.onclick = () => {
			chrome.tabs.update(tabId, { active: true });
		};
	}
}


// goal: binds secondary media control UI elements to content script commands for playback and focus management

import type { AudioConfig } from '@nexus/kernel';
import type { CardUIElements } from '../types';
import { requestTab } from '../utils/dom';
import { syncSidePanelSpeed } from '../side-panel/controls';
import { getHotkeyTarget, setHotkeyTarget } from '../../shared/registry-client';

const SVG_NS = 'http://www.w3.org/2000/svg';

// eff: attaches click and input handlers to playback buttons, speed controls, and tab-focus utilities
// note: speed controls now use unified update flow through onSpeedChange callback
export function bindMediaControls(ui: CardUIElements, tabId: number, update?: (changes: Partial<AudioConfig>) => void): void {
	if (ui.btnPause) {
		ui.btnPause.onclick = async () => {
			const res = await requestTab(tabId, 'spectra.media.play.toggle', {});
			if (res && ui.btnPause) {
				ui.btnPause.replaceChildren(createPlaybackIcon(res.playing));
			}
		};
	}

	if (ui.btnPip) {
		ui.btnPip.onclick = async () => {
			const res = await requestTab(tabId, 'spectra.media.pip.toggle', {});
			if (res && ui.btnPip) {
				ui.btnPip.classList.toggle('active', res.active);
				ui.btnPip.setAttribute('aria-pressed', String(res.active));
			}
		};
	}

	// rule: speed controls use unified update flow via update callback (same as volume)
	ui.speedBtns.forEach(btn => {
		btn.onclick = () => {
			const delta = parseFloat(btn.dataset.delta || '0');
			const currentSpeed = parseFloat(ui.speedInput?.value || '1');
			// note: fix floating point precision errors (e.g. 1.1 + 0.1 = 1.2000000000000002)
			const rawSpeed = currentSpeed + delta;
			const newSpeed = Math.max(0.1, Math.min(16, Math.round(rawSpeed * 100) / 100));
			if (ui.speedInput) ui.speedInput.value = newSpeed.toFixed(2);
			syncSidePanelSpeed(newSpeed);
			update?.({ speed: newSpeed });
		};
	});

	if (ui.speedInput) {
		const handleSpeedChange = (speed: number) => {
			const clampedSpeed = Math.max(0.1, Math.min(16, speed));
			if (ui.speedInput) ui.speedInput.value = clampedSpeed.toFixed(2);
			syncSidePanelSpeed(clampedSpeed);
			update?.({ speed: clampedSpeed });
		};

		ui.speedInput.onchange = (e) => {
			const speed = parseFloat((e.target as HTMLInputElement).value) || 1;
			handleSpeedChange(speed);
		};

		ui.speedInput.onwheel = (e) => {
			e.preventDefault();
			const current = parseFloat(ui.speedInput!.value) || 1;
			const delta = e.deltaY < 0 ? 0.1 : -0.1;
			handleSpeedChange(current + delta);
		};
	}

	if (ui.btnHotkeyTarget) {
		const btn = ui.btnHotkeyTarget;
		btn.setAttribute('aria-pressed', 'false');

		void getHotkeyTarget().then(result => {
			if (result.tabId === tabId) {
				btn.classList.add('active');
				btn.setAttribute('aria-pressed', 'true');
			}
		}).catch(() => undefined);

		btn.onclick = () => {
			void setHotkeyTarget(tabId).then(() => {
				// note: enforce exclusive "active" state across all rendered cards in the popup
				document.querySelectorAll<HTMLElement>('.btn-hotkey-target').forEach((button) => {
					button.classList.remove('active');
					button.setAttribute('aria-pressed', 'false');
				});
				btn.classList.add('active');
				btn.setAttribute('aria-pressed', 'true');
			}).catch(() => undefined);
		};
	}

	if (ui.btnGotoTab) {
		ui.btnGotoTab.onclick = () => {
			chrome.tabs.update(tabId, { active: true });
		};
	}
}

function createPlaybackIcon(playing: boolean): SVGSVGElement {
	const svg = document.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('width', '12');
	svg.setAttribute('height', '12');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('fill', 'currentColor');
	svg.setAttribute('aria-hidden', 'true');

	if (playing) {
		for (const x of ['6', '14']) {
			const rect = document.createElementNS(SVG_NS, 'rect');
			rect.setAttribute('x', x);
			rect.setAttribute('y', '4');
			rect.setAttribute('width', '4');
			rect.setAttribute('height', '16');
			svg.append(rect);
		}
	} else {
		const path = document.createElementNS(SVG_NS, 'path');
		path.setAttribute('d', 'M8 5v14l11-7z');
		svg.append(path);
	}

	return svg;
}


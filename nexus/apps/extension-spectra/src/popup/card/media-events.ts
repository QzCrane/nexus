// goal: binds secondary media control UI elements to content script commands for playback and focus management

import type { AudioConfig } from '@nexus/kernel';
import type { CardUIElements } from '../types';
import type { ControlMutation, ControlOperationAck } from '@nexus/contracts';
import { sendSpectraRequest } from '../../shared/ui-spectra-client';
import { syncSidePanelSpeed } from '../side-panel/controls';
import { getHotkeyTarget, setHotkeyTarget } from '../../shared/registry-client';
import type { CardInternalState } from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';

async function submitMutation(tabId: number, state: CardInternalState, mutation: ControlMutation) {
	const target = mutation.field === 'pip'
		? state.controlSnapshot?.activeVideo ?? null
		: state.controlSnapshot?.activeMedia ?? null;
	const response = await sendSpectraRequest(
		'spectra.control.intent.submit',
		{
			tabId,
			source: 'popup',
			requestedCoverage: 'active-target',
			target,
			baseRevision: state.controlRevision,
			mutations: [mutation],
		},
		{ tabId },
	);
	if (!response.ok) throw new Error(response.error.message);
	const field = response.data.fields[mutation.field];
	if (field?.phase !== 'applied') {
		throw new Error(field?.lastError?.message ?? `Control ${mutation.field} was not applied`);
	}
	return response.data;
}

// eff: attaches click and input handlers to playback buttons, speed controls, and tab-focus utilities
// note: speed controls now use unified update flow through onSpeedChange callback
export function bindMediaControls(
	ui: CardUIElements,
	tabId: number,
	state: CardInternalState,
	update?: (changes: Partial<AudioConfig>) => void,
): void {
	if (ui.btnPause) {
		ui.btnPause.onclick = async () => {
			const response = await sendSpectraRequest(
				'spectra.control.operation.submit',
				{
					tabId,
					source: 'popup',
					target: state.controlSnapshot?.activeMedia ?? null,
					baseRevision: state.controlRevision,
					operation: 'playback-toggle',
					payload: {},
				},
				{ tabId },
			);
			if (!response.ok) throw new Error(response.error.message);
			const playing = (response.data as ControlOperationAck<'playback-toggle'>).result.playing;
			if (typeof playing === 'boolean' && ui.btnPause) renderPlaybackButton(ui.btnPause, playing);
		};
	}

	if (ui.btnPip) {
		ui.btnPip.onclick = async () => {
			const ack = await submitMutation(tabId, state, { field: 'pip', operation: 'toggle' });
			const active = ack.fields.pip?.actual;
			if (typeof active === 'boolean' && ui.btnPip) {
				ui.btnPip.classList.toggle('active', active);
				ui.btnPip.setAttribute('aria-pressed', String(active));
			}
		};
	}

	// rule: speed controls use unified update flow via update callback (same as volume)
	ui.speedBtns.forEach(btn => {
		btn.onclick = () => {
			const delta = parseFloat(btn.dataset.delta || '0');
			void submitMutation(tabId, state, { field: 'speed', operation: 'delta', value: delta })
				.then((ack) => {
					const actual = ack.fields.speed?.actual;
					if (typeof actual !== 'number') return;
					if (ui.speedInput) ui.speedInput.value = actual.toFixed(2);
					syncSidePanelSpeed(actual);
				});
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

export function renderPlaybackButton(button: HTMLElement, playing: boolean): void {
	button.replaceChildren(createPlaybackIcon(playing));
	button.setAttribute('aria-pressed', String(playing));
	button.setAttribute('aria-label', playing ? 'Pause media' : 'Play media');
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


// goal: binds secondary media control UI elements to content script commands for playback and focus management

import type { AudioConfig } from '@nexus/kernel';
import type { CardUIElements } from '../types';
import type { ControlMutation, ControlOperationAck } from '@nexus/contracts';
import { sendSpectraRequest } from '../../shared/ui-spectra-client';
import { syncSidePanelSpeed } from '../side-panel/controls';
import { getHotkeyTarget, setHotkeyTarget } from '../../shared/registry-client';
import type { CardInternalState } from './types';
import { showPopupToast } from '../toast';
import {
	SPECTRA_TRUSTED_PIP_EVENT,
	type SpectraTrustedPipResult,
} from '../../shared/trusted-activation';

const SVG_NS = 'http://www.w3.org/2000/svg';

interface ControlUiFailure {
	code: string;
	message: string;
	retryable: boolean;
}

class ControlUiError extends Error {
	constructor(readonly failure: ControlUiFailure) {
		super(failure.message);
		this.name = 'ControlUiError';
	}
}

async function togglePictureInPicture(tabId: number): Promise<SpectraTrustedPipResult> {
	const injections = await chrome.scripting.executeScript({
		target: { tabId },
		world: 'ISOLATED',
		args: [SPECTRA_TRUSTED_PIP_EVENT],
		func: ((eventName: string) => {
			const entering = document.pictureInPictureElement === null;
			const actualEvent = entering ? 'enterpictureinpicture' : 'leavepictureinpicture';
			return new Promise<SpectraTrustedPipResult>((resolve, reject) => {
				let timer: ReturnType<typeof setTimeout> | null = null;
				const cleanup = () => {
					document.removeEventListener(actualEvent, onActual, true);
					if (timer !== null) clearTimeout(timer);
				};
				const onActual = () => {
					cleanup();
					resolve({ active: document.pictureInPictureElement !== null });
				};
				document.addEventListener(actualEvent, onActual, { capture: true, once: true });
				timer = setTimeout(() => {
					cleanup();
					reject(new Error('Native Picture-in-Picture did not acknowledge the click'));
				}, 2_000);
				document.dispatchEvent(new Event(eventName));
			});
		}) as unknown as () => void,
	}) as unknown as Array<{
		result?: SpectraTrustedPipResult;
		error?: { message?: string } | string;
	}>;
	const [injection] = injections;
	const result = injection?.result as SpectraTrustedPipResult | undefined;
	if (!result || typeof result.active !== 'boolean') {
		const injectionError = typeof injection?.error === 'string'
			? injection.error
			: injection?.error?.message;
		throw new Error(injectionError ?? 'The native PiP runtime returned no actual state');
	}
	return result;
}

function asControlUiFailure(error: unknown): ControlUiFailure {
	if (error instanceof ControlUiError) return error.failure;
	return {
		code: 'control_failed',
		message: error instanceof Error ? error.message : String(error),
		retryable: true,
	};
}

async function reportControlFailure(
	error: unknown,
	state: CardInternalState,
): Promise<void> {
	const failure = asControlUiFailure(error);
	state.lastError = failure;
	showPopupToast(failure.message, 'error');
}

async function submitMutation(tabId: number, state: CardInternalState, mutation: ControlMutation) {
	const response = await sendSpectraRequest(
		'spectra.control.intent.submit',
		{
			tabId,
			source: 'popup',
			requestedCoverage: 'active-target',
			target: state.controlSnapshot?.activeMedia ?? null,
			baseRevision: state.controlRevision,
			mutations: [mutation],
		},
		{ tabId },
	);
	if (!response.ok) throw new ControlUiError(response.error);
	const field = response.data.fields[mutation.field];
	if (field?.phase !== 'applied') {
		throw new ControlUiError(field?.lastError ?? {
			code: 'control_not_applied',
			message: `Control ${mutation.field} was not applied`,
			retryable: true,
		});
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
		ui.btnPause.onclick = () => {
			void sendSpectraRequest(
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
			).then((response) => {
				if (!response.ok) throw new ControlUiError(response.error);
				const playing = (response.data as ControlOperationAck<'playback-toggle'>).result.playing;
				if (typeof playing === 'boolean' && ui.btnPause) renderPlaybackButton(ui.btnPause, playing);
			}).catch((error: unknown) => reportControlFailure(error, state));
		};
	}

	if (ui.btnPip) {
		ui.btnPip.onclick = () => {
			ui.btnPip?.setAttribute('aria-busy', 'true');
			// The first call in the click stack is a one-shot isolated-world injection.
			// It reaches the sole native writer without a Background/message await.
			void togglePictureInPicture(tabId)
				.then((result) => {
					if (!ui.btnPip) return;
					ui.btnPip.classList.toggle('active', result.active);
					ui.btnPip.setAttribute('aria-pressed', String(result.active));
				})
				.catch((error: unknown) => reportControlFailure(error, state))
				.finally(() => ui.btnPip?.removeAttribute('aria-busy'));
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
				})
				.catch((error: unknown) => reportControlFailure(error, state));
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


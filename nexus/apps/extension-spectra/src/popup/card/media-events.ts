// goal: binds secondary media control UI elements to content script commands for playback and focus management

import type { CardUIElements } from '../types';
import type {
	ControlFieldStates,
	ControlMutation,
	MediaTarget,
} from '@nexus/contracts';
import { clampControlValue } from '@nexus/contracts/ui-runtime';
import { submitControlIntent, submitControlOperation } from './intent-recovery';
import { syncSidePanelSpeed } from '../side-panel/controls';
import { getHotkeyTarget, setHotkeyTarget } from '../../shared/hotkey-target-client';
import type { CardInternalState } from './types';
import type { ConfigErrorHandler, ConfigUpdateFn } from './state';
import { showPopupToast } from '../toast';
import { parseFiniteControlInput } from '../utils/control-input';
import { getCurrentDict } from '../views/i18n-apply';
import { applyControlSnapshot } from './messaging';
import { sendSpectraRequest } from '../../shared/ui-spectra-client';
import { createSerializedToggleQueue } from '../../shared/serialized-toggle';
import {
	SPECTRA_TRUSTED_PIP_EVENT,
	SPECTRA_TRUSTED_PIP_REQUEST_ATTRIBUTE,
	SPECTRA_TRUSTED_PIP_RESULT_ATTRIBUTE,
	type SpectraTrustedPipOutcome,
	type SpectraTrustedPipResult,
} from '../../shared/trusted-activation';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TRUSTED_PIP_ACK_TIMEOUT_MS = 2_000;

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

// rule: SCTRL-005/014/025 — the click handler captures the video target
// exactly once and resolves it through a per-tab map. The single-parameter
// `togglePictureInPicture(tabId)` keeps the dispatch site decoupled from
// any closure or positional argument, so the IPC stack cannot drift between
// click-time snapshot and executor-time target.
interface PipToggleContext {
	documentId: string;
	target: MediaTarget;
}

const pipToggleByTab = new Map<number, PipToggleContext>();

function togglePictureInPicture(tabId: number): Promise<SpectraTrustedPipResult> {
	const context = pipToggleByTab.get(tabId);
	if (!context) throw new Error('The active video target is unavailable');
	return dispatchPictureInPicture(tabId, context.documentId, context.target);
}

async function dispatchPictureInPicture(
	tabId: number,
	documentId: string,
	target: MediaTarget,
): Promise<SpectraTrustedPipResult> {
	if (!documentId) throw new Error('The current document identity is unavailable');
	if (target.kind !== 'video' || target.documentId !== documentId) {
		throw new Error('The selected video target is unavailable');
	}
	const requestId = crypto.randomUUID();
	const [injection] = await chrome.scripting.executeScript({
		target: { tabId },
		world: 'ISOLATED',
		args: [
			SPECTRA_TRUSTED_PIP_EVENT,
			SPECTRA_TRUSTED_PIP_REQUEST_ATTRIBUTE,
			SPECTRA_TRUSTED_PIP_RESULT_ATTRIBUTE,
			requestId,
			documentId,
			target,
			TRUSTED_PIP_ACK_TIMEOUT_MS,
		],
		func: ((
			requestEvent: string,
			requestAttribute: string,
			resultAttribute: string,
			currentRequestId: string,
			currentDocumentId: string,
			currentTarget: MediaTarget,
			timeoutMs: number,
		) => {
			return new Promise<SpectraTrustedPipOutcome | null>((resolve) => {
				const root = document.documentElement;
				let timeoutId: number | null = null;
				let observer: MutationObserver | null = null;
				let settled = false;

				const removeMatchingAttribute = (attribute: string): void => {
					const encoded = root.getAttribute(attribute);
					if (!encoded) return;
					try {
						const candidate = JSON.parse(encoded) as { requestId?: unknown };
						if (candidate?.requestId === currentRequestId) root.removeAttribute(attribute);
					} catch {
						// A malformed or foreign value is not owned by this request.
						return;
					}
				};
				const cleanup = (): void => {
					observer?.disconnect();
					if (timeoutId !== null) window.clearTimeout(timeoutId);
					removeMatchingAttribute(requestAttribute);
					removeMatchingAttribute(resultAttribute);
				};
				const finish = (outcome: SpectraTrustedPipOutcome | null): void => {
					if (settled) return;
					settled = true;
					cleanup();
					resolve(outcome);
				};
				const readOutcome = (): void => {
					const encoded = root.getAttribute(resultAttribute);
					if (!encoded) return;
					try {
						const outcome = JSON.parse(encoded) as SpectraTrustedPipOutcome;
						if (!outcome || outcome.requestId !== currentRequestId) return;
						finish(outcome);
					} catch {
						// The lifecycle-bound bridge owns valid result encoding.
						root.removeAttribute(resultAttribute);
					}
				};

				observer = new MutationObserver(readOutcome);
				observer.observe(root, { attributes: true, attributeFilter: [resultAttribute] });
				timeoutId = window.setTimeout(() => finish(null), timeoutMs);
				root.removeAttribute(resultAttribute);
				root.setAttribute(
					requestAttribute,
					JSON.stringify({
						requestId: currentRequestId,
						documentId: currentDocumentId,
						target: currentTarget,
					}),
				);
				// The Promise executor runs synchronously, so the native writer still
				// receives the same live user activation as the original click.
				document.dispatchEvent(new Event(requestEvent));
				// Cover synchronous rejection before the observer's microtask runs.
				readOutcome();
			});
		}) as unknown as () => void,
	}) as unknown as Array<{
		result?: SpectraTrustedPipOutcome | null;
		error?: { message?: string } | string;
	}>;
	const outcome = injection?.result;
	if (!outcome || outcome.requestId !== requestId) {
		const injectionError = typeof injection?.error === 'string'
			? injection.error
			: injection?.error?.message;
		throw new Error(injectionError ?? 'Native Picture-in-Picture bridge did not acknowledge the click');
	}
	if (!outcome.ok) throw new Error(outcome.error);
	return { active: outcome.active };
}

function asControlUiFailure(error: unknown): ControlUiFailure {
	if (error instanceof ControlUiError) return error.failure;
	return {
		code: 'control_failed',
		message: error instanceof Error ? error.message : String(error),
		retryable: true,
	};
}

type AcknowledgedControl = {
	tabId: number;
	documentId: string;
	generation: number;
	revision: number;
	target: MediaTarget | null;
	fields: ControlFieldStates;
	mediaObservation?: import('@nexus/contracts').MediaObservationStamp;
};

function projectAcknowledgedControl(state: CardInternalState, ack: AcknowledgedControl, render: () => void): void {
	const current = state.controlSnapshot;
	if (current && (current.tabId !== ack.tabId || current.documentId !== ack.documentId
		|| ack.generation < current.generation
		|| ack.generation === current.generation && ack.revision < current.revision)) return;

	if (current) {
		applyControlSnapshot(state, {
			...current,
			generation: ack.generation,
			revision: ack.revision,
			activeMedia: ack.target ?? current.activeMedia,
			activeVideo: ack.target?.kind === 'video' ? ack.target : current.activeVideo,
			fields: { ...current.fields, ...ack.fields },
			mediaObservation: ack.mediaObservation,
		}, render);
	} else {
		// An ACK has no origin and cannot invent the first card identity. Read
		// the coordinator's committed projection through the same admission path.
		void sendSpectraRequest('spectra.control.snapshot.get', { tabId: ack.tabId }).then((response) => {
			if (response.ok && response.data) applyControlSnapshot(state, response.data, render);
		}).catch((error: unknown) => {
			console.debug('[SPECTRA Popup] Acknowledged snapshot confirmation unavailable', error);
		});
	}
}

async function reportControlFailure(
	error: unknown,
	state: CardInternalState,
	onError?: ConfigErrorHandler,
): Promise<void> {
	if (onError) {
		onError(error, state);
		return;
	}
	const failure = asControlUiFailure(error);
	state.lastError = failure;
	showPopupToast(failure.message, 'error');
}

async function submitMutation(tabId: number, state: CardInternalState, render: () => void, mutation: ControlMutation) {
	const response = await submitControlIntent(
		{ tabId, state, render },
		{ requestedCoverage: 'active-target', mutations: [mutation] },
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
	projectAcknowledgedControl(state, response.data, render);
	return response.data;
}

/**
 * The video target a click acts on.
 *
 * The first paint is a forecast assembled from durable facts before Content has
 * answered, so it can legitimately lack a target on a tab that plainly has one.
 * Trusting that forecast made the first PiP click report "No active video
 * target" and only the second one work. Ask the live snapshot once before
 * declaring absence: one message round trip still fits inside the click's
 * transient activation, and a forecast that already has a target pays nothing.
 */
async function resolveVideoTarget(
	tabId: number,
	state: CardInternalState,
	render: () => void,
): Promise<{ documentId: string; target: MediaTarget } | null> {
	const pick = (): { documentId: string; target: MediaTarget } | null => {
		const snapshot = state.controlSnapshot;
		const target = snapshot?.activeVideo
			?? (snapshot?.activeMedia?.kind === 'video' ? snapshot.activeMedia : null);
		return snapshot?.documentId && target ? { documentId: snapshot.documentId, target } : null;
	};
	const forecast = pick();
	if (forecast) return forecast;
	try {
		const response = await sendSpectraRequest('spectra.control.snapshot.get', { tabId });
		if (response.ok && response.data) applyControlSnapshot(state, response.data, render);
	} catch {
		return null;
	}
	return pick();
}

// eff: attaches click and input handlers to playback buttons, speed controls, and tab-focus utilities
export function bindMediaControls(
	ui: CardUIElements,
	tabId: number,
	state: CardInternalState,
	update: ConfigUpdateFn,
	render: () => void,
	onError?: ConfigErrorHandler,
): void {
	if (ui.btnPause) {
		const playback = createSerializedToggleQueue<boolean | null>({
			readCurrent: () => {
				const actual = state.controlSnapshot?.fields.playing?.actual;
				return typeof actual === 'boolean' ? actual : null;
			},
			nextValue: (actual) => actual === null ? null : !actual,
			commit: (playing) => update.runControl(async () => {
				const response = playing === null
					? await submitControlOperation({ tabId, state, render }, { operation: 'playback-toggle', payload: {} })
					: await submitControlIntent({ tabId, state, render }, { requestedCoverage: 'active-target', target: null, patch: { playing } });
				if (!response.ok) throw new ControlUiError(response.error);
				const acknowledgement = response.data;
				if (acknowledgement.fields.playing?.phase !== 'applied') throw new ControlUiError(acknowledgement.fields.playing?.lastError ?? { code: 'control_not_applied', message: 'Playback was not acknowledged', retryable: true });
				projectAcknowledgedControl(state, acknowledgement, render);
				render();
			}),
			setBusy: (busy) => {
				state.playbackPending = busy;
				render();
			},
			onError: (error) => {
				void reportControlFailure(error, state, onError).catch((failure: unknown) => {
					console.error('[SPECTRA Popup] Playback error presentation failed:', failure);
				});
			},
		});
		ui.btnPause.onclick = () => { void playback.enqueue(); };
	}

	if (ui.btnPip) {
		ui.btnPip.onclick = () => {
			// Kept as a detached task rather than runControl: that queue awaits the
			// volume flush first, and PiP has to reach the native call while the
			// click's transient activation is still live.
			void (async () => {
				const resolved = await resolveVideoTarget(tabId, state, render);
				if (!resolved) {
					await reportControlFailure(new Error('No active video target'), state, onError);
					return;
				}
				ui.btnPip?.setAttribute('aria-busy', 'true');
				pipToggleByTab.set(tabId, { documentId: resolved.documentId, target: resolved.target });
				// The first call in the click stack is a one-shot isolated-world injection.
				// It reaches the sole native writer without a Background/message await.
				try {
					const result = await togglePictureInPicture(tabId);
					if (!ui.btnPip) return;
					ui.btnPip.classList.toggle('active', result.active);
					ui.btnPip.setAttribute('aria-pressed', String(result.active));
				} catch (error) {
					await reportControlFailure(error, state, onError);
				} finally {
					pipToggleByTab.delete(tabId);
					ui.btnPip?.removeAttribute('aria-busy');
				}
			})();
		};
	}

	const submitSpeed = (operation: 'set' | 'delta', value: number) => {
		void update.runControl(() => submitMutation(tabId, state, render, {
			field: 'speed', operation, value,
		}))
			.then((ack) => {
				const actual = ack.fields.speed?.actual;
				if (typeof actual !== 'number') return;
				if (ui.speedInput && document.activeElement !== ui.speedInput) ui.speedInput.value = actual.toFixed(2);
				syncSidePanelSpeed(tabId, actual);
			})
			.catch((error: unknown) => reportControlFailure(error, state, onError));
	};

	ui.speedBtns.forEach(btn => {
		btn.onclick = () => {
			const delta = parseFloat(btn.dataset.delta || '0');
			submitSpeed('delta', delta);
		};
	});

	const speedInput = ui.speedInput;
	if (speedInput) {
		const submitClampedSpeed = (speed: number) => {
			const clampedSpeed = clampControlValue(speed, 'speed', 1);
			submitSpeed('set', clampedSpeed);
		};

		speedInput.onchange = (e) => {
			submitClampedSpeed(parseFiniteControlInput((e.target as HTMLInputElement).value, 1));
		};

		speedInput.onwheel = (e) => {
			e.preventDefault();
			const current = parseFiniteControlInput(speedInput.value, 1);
			const delta = e.deltaY < 0 ? 0.1 : -0.1;
			submitClampedSpeed(current + delta);
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
		}).catch((error: unknown) => reportControlFailure(error, state, onError));

		btn.onclick = () => {
			const clearing = btn.classList.contains('active');
			void setHotkeyTarget(clearing ? null : tabId).then(() => {
				// note: enforce exclusive "active" state across all rendered cards in the popup
				document.querySelectorAll<HTMLElement>('.btn-hotkey-target').forEach((button) => {
					button.classList.remove('active');
					button.setAttribute('aria-pressed', 'false');
				});
				if (!clearing) {
					btn.classList.add('active');
					btn.setAttribute('aria-pressed', 'true');
				}
			}).catch((error: unknown) => reportControlFailure(error, state, onError));
		};
	}

	if (ui.btnGotoTab) {
		ui.btnGotoTab.onclick = () => {
			void chrome.tabs.update(tabId, { active: true })
				.catch((error: unknown) => reportControlFailure(error, state, onError));
		};
	}
}

export function renderPlaybackButton(button: HTMLElement, playing: boolean | null): void {
	if (playing === null) {
		button.textContent = '…';
		button.setAttribute('aria-pressed', 'mixed');
		button.setAttribute('aria-busy', 'true');
	} else {
		button.replaceChildren(createPlaybackIcon(playing));
		button.setAttribute('aria-pressed', String(playing));
		button.removeAttribute('aria-busy');
	}
	const localized = getCurrentDict()?.btnPause;
	const label = typeof localized === 'string' && localized.trim().length > 0
		? localized
		: 'Pause/Play';
	button.title = label;
	button.setAttribute('aria-label', label);
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

// goal: binds interactive video manipulation controls (filters, transforms, A/B loops) in the side panel to content script actions

import type {
	ControlMutation,
	ControlOperation,
	ControlOperationAck,
	ControlOperationPayload,
	ControlOperationRequest,
	ControlPatch,
	ControlSnapshot,
	VideoFilterState,
} from '@nexus/contracts';
import { sendSpectraRequest } from '../../shared/ui-spectra-client';
import { showPopupToast } from '../toast';
import {
	classifyControlSnapshot,
	type ControlSnapshotAdmission,
} from '../control-snapshot-order';

let currentTabId: number | null = null;
let currentSnapshot: ControlSnapshot | null = null;
let pendingFilter: VideoFilterState | null = null;
let filterTimer: ReturnType<typeof setTimeout> | null = null;
let filterInFlight = false;
let lastFilterSentAt = 0;
const FILTER_SEND_INTERVAL_MS = 50;
let boundPanel: HTMLElement | null = null;
let pagehideListener: (() => void) | null = null;
let selectionEpoch = 0;

interface TabControlTail {
	selectionEpoch: number;
	settled: Promise<void>;
}

const tabControlTails = new Map<number, TabControlTail>();

interface ControlTargetFence {
	selectionEpoch: number;
	tabId: number | null;
	documentId: string | null;
	origin: string | null;
	generation: number | null;
	frameId: number | null;
	mediaId: string | null;
	sourceRevision: number | null;
}

function captureTargetFence(): ControlTargetFence {
	const video = currentSnapshot?.activeVideo;
	return {
		selectionEpoch,
		tabId: currentTabId,
		documentId: currentSnapshot?.documentId ?? null,
		origin: currentSnapshot?.origin ?? null,
		generation: currentSnapshot?.generation ?? null,
		frameId: video?.frameId ?? null,
		mediaId: video?.mediaId ?? null,
		sourceRevision: video?.sourceRevision ?? null,
	};
}

function isCurrentTarget(fence: ControlTargetFence): boolean {
	if (selectionEpoch !== fence.selectionEpoch || currentTabId !== fence.tabId) return false;
	const video = currentSnapshot?.activeVideo;
	return (currentSnapshot?.documentId ?? null) === fence.documentId
		&& (currentSnapshot?.origin ?? null) === fence.origin
		&& (currentSnapshot?.generation ?? null) === fence.generation
		&& (video?.frameId ?? null) === fence.frameId
		&& (video?.mediaId ?? null) === fence.mediaId
		&& (video?.sourceRevision ?? null) === fence.sourceRevision;
}

async function restoreAuthoritativeSnapshot(fence: ControlTargetFence): Promise<void> {
	if (!isCurrentTarget(fence)) return;
	if (filterTimer) clearTimeout(filterTimer);
	filterTimer = null;
	pendingFilter = null;
	const tabId = fence.tabId;
	if (currentSnapshot) renderVideoControlSnapshot(currentSnapshot, true);
	if (tabId === null) return;
	try {
		const response = await sendSpectraRequest(
			'spectra.control.snapshot.get',
			{ tabId },
			{ tabId },
		);
		if (!response.ok) throw new Error(response.error.message);
		if (response.data && isCurrentTarget(fence)) {
			syncVideoControlSnapshot(response.data);
			if (isCurrentTarget(fence) && currentSnapshot) renderVideoControlSnapshot(currentSnapshot, true);
		}
	} catch (error) {
		console.warn('[SPECTRA] Unable to refresh video controls after a rejected action', error);
	}
}

async function presentControlFailure(error: unknown, fence: ControlTargetFence): Promise<void> {
	if (!isCurrentTarget(fence)) return;
	showPopupToast(
		error instanceof Error ? error.message : 'The video control could not be applied',
		'error',
	);
	await restoreAuthoritativeSnapshot(fence);
}

async function refreshActionAuthority(fence: ControlTargetFence): Promise<void> {
	if (!isCurrentTarget(fence) || fence.tabId === null) return;
	const response = await sendSpectraRequest(
		'spectra.control.snapshot.get',
		{ tabId: fence.tabId },
		{ tabId: fence.tabId },
	);
	if (!response.ok) throw new Error(response.error.message);
	if (!response.data) throw new Error('The active video target is unavailable');
	const admission = syncVideoControlSnapshot(response.data);
	if (admission !== 'accepted' && admission !== 'stale') {
		throw new Error('The active video target is unavailable');
	}
	if (!isCurrentTarget(fence)) throw new Error('The active video target changed');
}

function enqueueControlAction<T>(
	fence: ControlTargetFence,
	action: (fence: ControlTargetFence) => Promise<T>,
): Promise<T | undefined> {
	const tabId = fence.tabId;
	if (tabId === null) return Promise.resolve(undefined);
	const previous = tabControlTails.get(tabId);
	const queued = (previous?.settled ?? Promise.resolve()).then(async () => {
		if (!isCurrentTarget(fence)) return undefined;
		if (previous && previous.selectionEpoch !== fence.selectionEpoch) {
			await refreshActionAuthority(fence);
		}
		if (!isCurrentTarget(fence)) return undefined;
		return action(fence);
	});
	const handled = queued.catch(async (error: unknown) => {
		if (!isCurrentTarget(fence)) return undefined;
		try {
			await presentControlFailure(error, fence);
		} catch (recoveryError: unknown) {
			console.warn('[SPECTRA] Video-control failure recovery failed', recoveryError);
		}
		return undefined;
	});
	const entry: TabControlTail = {
		selectionEpoch: fence.selectionEpoch,
		settled: handled.then(() => undefined),
	};
	tabControlTails.set(tabId, entry);
	void entry.settled.then(() => {
		if (tabControlTails.get(tabId) === entry) tabControlTails.delete(tabId);
	});
	return handled;
}

function runControlAction(action: (fence: ControlTargetFence) => Promise<void>): void {
	const fence = captureTargetFence();
	void enqueueControlAction(fence, action);
}

// A reopened panel must not observe a snapshot from before an older session's
// still-running write. The caller keeps controls disabled while this drains.
export async function waitForPendingVideoControlActions(tabId: number): Promise<void> {
	while (true) {
		const pending = tabControlTails.get(tabId);
		if (!pending) return;
		await pending.settled;
		if (tabControlTails.get(tabId) === pending) return;
	}
}

type ControlAckLike = Pick<
	ControlSnapshot,
	'tabId' | 'documentId' | 'generation' | 'revision' | 'fields'
> & { target: ControlSnapshot['activeMedia'] };

function updateSnapshotFromAck(ack: ControlAckLike | null, fence: ControlTargetFence): boolean {
	if (!ack || !currentSnapshot || !isCurrentTarget(fence)
		|| ack.tabId !== currentSnapshot.tabId
		|| ack.documentId !== currentSnapshot.documentId
		|| ack.generation < currentSnapshot.generation
		|| ack.generation === currentSnapshot.generation && ack.revision < currentSnapshot.revision) return false;
	currentSnapshot = {
		...currentSnapshot,
		generation: ack.generation,
		revision: ack.revision,
		activeMedia: currentSnapshot.activeMedia,
		activeVideo: ack.target?.kind === 'video'
			? ack.target
			: currentSnapshot.activeVideo,
		fields: { ...currentSnapshot.fields, ...ack.fields },
	};
	return true;
}

async function submitMutation(mutation: ControlMutation, fence: ControlTargetFence) {
	if (!isCurrentTarget(fence) || currentTabId === null || !currentSnapshot) {
		throw new Error('The active video target is unavailable');
	}
	const tabId = currentTabId;
	const snapshot = currentSnapshot;
	const response = await sendSpectraRequest(
		'spectra.control.intent.submit',
		{
			tabId,
			source: 'popup',
			requestedCoverage: 'active-target',
			target: snapshot.activeVideo,
			baseRevision: snapshot.revision,
			mutations: [mutation],
		},
		{ tabId },
	);
	if (!response.ok) throw new Error(response.error.message);
	return updateSnapshotFromAck(response.data, fence) ? response.data : null;
}

async function submitPatch(patch: ControlPatch, fence: ControlTargetFence) {
	if (!isCurrentTarget(fence) || currentTabId === null || !currentSnapshot) {
		throw new Error('The active video target is unavailable');
	}
	const tabId = currentTabId;
	const snapshot = currentSnapshot;
	const response = await sendSpectraRequest(
		'spectra.control.intent.submit',
		{
			tabId,
			source: 'popup',
			requestedCoverage: 'active-target',
			target: snapshot.activeVideo,
			baseRevision: snapshot.revision,
			patch,
		},
		{ tabId },
	);
	if (!response.ok) throw new Error(response.error.message);
	return updateSnapshotFromAck(response.data, fence) ? response.data : null;
}

async function submitOperation<O extends ControlOperation>(
	operation: O,
	payload: ControlOperationPayload<O>,
	fence: ControlTargetFence,
): Promise<ControlOperationAck<O> | null> {
	if (!isCurrentTarget(fence) || currentTabId === null || !currentSnapshot) {
		throw new Error('The active video target is unavailable');
	}
	const tabId = currentTabId;
	const snapshot = currentSnapshot;
	const response = await sendSpectraRequest(
		'spectra.control.operation.submit',
		{
			tabId,
			source: 'popup',
			target: snapshot.activeVideo,
			baseRevision: snapshot.revision,
			operation,
			payload,
		} as unknown as ControlOperationRequest,
		{ tabId },
	);
	if (!response.ok) throw new Error(response.error.message);
	const acknowledgement = response.data as ControlOperationAck<O>;
	return updateSnapshotFromAck(acknowledgement, fence) ? acknowledgement : null;
}

function readFilter(panel: HTMLElement): VideoFilterState {
	return {
		brightness: Number.parseInt(panel.querySelector<HTMLInputElement>('.sp-brightness')?.value ?? '100', 10),
		contrast: Number.parseInt(panel.querySelector<HTMLInputElement>('.sp-contrast')?.value ?? '100', 10),
		saturate: Number.parseInt(panel.querySelector<HTMLInputElement>('.sp-saturate')?.value ?? '100', 10),
		grayscale: panel.querySelector<HTMLInputElement>('.sp-sw-grayscale')?.checked === true,
		invert: panel.querySelector<HTMLInputElement>('.sp-sw-invert')?.checked === true,
	};
}

// eff: sets the target tab for all subsequent video control commands
export function setVideoControlTabId(tabId: number | null): void {
	if (currentTabId !== tabId) {
		selectionEpoch += 1;
		if (filterTimer) clearTimeout(filterTimer);
		filterTimer = null;
		pendingFilter = null;
		currentSnapshot = null;
	}
	currentTabId = tabId;
}

// eff: identifies and initializes all video-related UI components within the side panel container
export function bindVideoControls(): void {
	const panel = document.getElementById('side-panel');
	if (!panel) return;
	if (boundPanel === panel) return;
	if (boundPanel && pagehideListener) window.removeEventListener('pagehide', pagehideListener);
	boundPanel = panel;

	bindButtons(panel);
	bindFilterSliders(panel);
	bindFilterSwitches(panel);
	bindSeekButtons(panel);
	pagehideListener = () => {
		const fence = captureTargetFence();
		void flushFilter(fence);
	};
	window.addEventListener('pagehide', pagehideListener, { once: true });
}

export function disposeVideoControls(): void {
	selectionEpoch += 1;
	currentTabId = null;
	currentSnapshot = null;
	pendingFilter = null;
	filterInFlight = false;
	if (filterTimer) clearTimeout(filterTimer);
	filterTimer = null;
	if (pagehideListener) window.removeEventListener('pagehide', pagehideListener);
	pagehideListener = null;
	if (boundPanel) {
		boundPanel.querySelectorAll<HTMLElement>('button, input').forEach((element) => {
			if (element instanceof HTMLButtonElement) element.onclick = null;
			if (element instanceof HTMLInputElement) {
				element.oninput = null;
				element.onchange = null;
				element.onwheel = null;
			}
		});
	}
	boundPanel = null;
	tabControlTails.clear();
}

export function setVideoControlAvailability(available: boolean, hasVideo = available): void {
	const panel = document.getElementById('side-panel');
	if (!panel) return;
	panel.querySelectorAll<HTMLButtonElement>(
		'.sp-btn[data-action], .sp-btn-small[data-action], .sp-btn-reset, .sp-btn-save',
	)
		.forEach((button) => {
			button.disabled = !available || button.matches('[data-action]') && !hasVideo;
		});
	panel.querySelectorAll<HTMLInputElement>(
		'.sp-speed-slider, .sp-speed-input, .sp-pan, .sp-delay, .sp-eq-input, '
		+ '.sp-brightness, .sp-contrast, .sp-saturate, .sp-sw-grayscale, .sp-sw-invert',
	).forEach((input) => {
		const isVideoInput = input.matches('.sp-brightness, .sp-contrast, .sp-saturate, .sp-sw-grayscale, .sp-sw-invert');
		input.disabled = !available || isVideoInput && !hasVideo;
	});
}

// note: handles discrete action buttons like rotation, mirroring, and A/B marker placement via a centralized switch
function bindButtons(panel: HTMLElement): void {
	const btns = panel.querySelectorAll<HTMLButtonElement>('.sp-btn[data-action]');

	btns.forEach(btn => {
		const action = btn.dataset.action;
		if (!action) return;
		if (['mirror', 'crop', 'fullscreen', 'dim', 'mark-a', 'mark-b'].includes(action)) {
			btn.setAttribute('aria-pressed', String(btn.classList.contains('active')));
		}

		btn.onclick = () => runControlAction(async (fence) => {
			if (currentTabId === null || !currentSnapshot) throw new Error('The active video target is unavailable');

			switch (action) {
			case 'rotate': {
					await submitMutation({ field: 'rotation', operation: 'delta', value: 90 }, fence);
					if (!isCurrentTarget(fence)) return;
					break;
				}
				case 'mirror': {
					const ack = await submitMutation({ field: 'mirrored', operation: 'toggle' }, fence);
					if (!isCurrentTarget(fence)) return;
					const mirrored = ack?.fields.mirrored?.actual;
					if (typeof mirrored === 'boolean') setPressed(btn, mirrored);
					break;
				}
				case 'screenshot': {
					await submitOperation('screenshot', {}, fence);
					break;
				}
				case 'crop': {
					const ack = await submitMutation({ field: 'fill', operation: 'toggle' }, fence);
					if (!isCurrentTarget(fence)) return;
					const fill = ack?.fields.fill?.actual;
					if (typeof fill === 'boolean') setPressed(btn, fill);
					break;
				}
				case 'fullscreen': {
					const ack = await submitMutation({ field: 'fullscreen', operation: 'toggle' }, fence);
					if (!isCurrentTarget(fence)) return;
					const active = ack?.fields.fullscreen?.actual;
					if (typeof active === 'boolean') setPressed(btn, active);
					break;
				}
				case 'dim': {
					const ack = await submitMutation({ field: 'dimEnabled', operation: 'toggle' }, fence);
					if (!isCurrentTarget(fence)) return;
					const active = ack?.fields.dimEnabled?.actual;
					if (typeof active === 'boolean') setPressed(btn, active);
					break;
				}
				case 'mark-a': {
					const ack = await submitOperation('ab-set-a', {}, fence);
					if (!isCurrentTarget(fence) || !ack) return;
					setPressed(btn, ack.result.abLoop.pointA !== null);
					break;
				}
				case 'mark-b': {
					const ack = await submitOperation('ab-set-b', {}, fence);
					if (!isCurrentTarget(fence) || !ack) return;
					setPressed(btn, ack.result.abLoop.pointB !== null);
					break;
				}
				case 'ab-loop': {
					const ack = await submitOperation('ab-clear', {}, fence);
					if (!isCurrentTarget(fence) || !ack) return;
					for (const marker of panel.querySelectorAll<HTMLElement>('.sp-btn-marker[data-action="mark-a"], .sp-btn-marker[data-action="mark-b"]')) {
						setPressed(marker, false);
					}
					break;
				}
			}
		});
	});
}

export function syncVideoControlSnapshot(snapshot: ControlSnapshot): ControlSnapshotAdmission {
	if (snapshot.tabId !== currentTabId) return 'tab-conflict';
	const admission = classifyControlSnapshot(currentSnapshot, snapshot);
	if (admission !== 'accepted') return admission;
	if (currentSnapshot && (snapshot.documentId !== currentSnapshot.documentId
		|| snapshot.origin !== currentSnapshot.origin)) {
		if (filterTimer) clearTimeout(filterTimer);
		filterTimer = null;
		pendingFilter = null;
	}
	currentSnapshot = snapshot;
	renderVideoControlSnapshot(snapshot);
	setVideoControlAvailability(true, snapshot.activeVideo !== null);
	return 'accepted';
}

function renderVideoControlSnapshot(snapshot: ControlSnapshot, force = false): void {
	const panel = document.getElementById('side-panel');
	if (!panel) return;
	const actual = <T>(field: keyof ControlSnapshot['fields']): T | undefined => {
		const value = snapshot.fields[field]?.actual;
		return value === null || value === undefined ? undefined : value as T;
	};
	const pressed = (action: string, value: boolean | undefined): void => {
		const button = panel.querySelector<HTMLElement>(`.sp-btn[data-action="${action}"]`);
		if (button && typeof value === 'boolean') setPressed(button, value);
	};
	const rotation = actual<number>('rotation');
	const rotate = panel.querySelector<HTMLElement>('.sp-btn[data-action="rotate"]');
	if (rotate && typeof rotation === 'number') rotate.title = `Rotation: ${rotation}°`;
	pressed('mirror', actual<boolean>('mirrored'));
	pressed('crop', actual<boolean>('fill'));
	pressed('fullscreen', actual<boolean>('fullscreen'));
	pressed('dim', actual<boolean>('dimEnabled'));

	const filter = actual<VideoFilterState>('filter');
	if (filter) {
		for (const [selector, value] of [
			['.sp-brightness', filter.brightness],
			['.sp-contrast', filter.contrast],
			['.sp-saturate', filter.saturate],
		] as const) {
			const input = panel.querySelector<HTMLInputElement>(selector);
			if (input && (force || document.activeElement !== input)) input.value = String(value);
		}
		const grayscale = panel.querySelector<HTMLInputElement>('.sp-sw-grayscale');
		const invert = panel.querySelector<HTMLInputElement>('.sp-sw-invert');
		if (grayscale) grayscale.checked = filter.grayscale;
		if (invert) invert.checked = filter.invert;
	} else if (snapshot.activeVideo === null) {
		for (const selector of ['.sp-brightness', '.sp-contrast', '.sp-saturate']) {
			const input = panel.querySelector<HTMLInputElement>(selector);
			if (input) input.value = '100';
		}
		const grayscale = panel.querySelector<HTMLInputElement>('.sp-sw-grayscale');
		const invert = panel.querySelector<HTMLInputElement>('.sp-sw-invert');
		if (grayscale) grayscale.checked = false;
		if (invert) invert.checked = false;
	}
	const abLoop = actual<import('@nexus/contracts').ABLoopState>('abLoop');
	if (abLoop) {
		pressed('mark-a', abLoop.pointA !== null);
		pressed('mark-b', abLoop.pointB !== null);
		pressed('ab-loop', abLoop.enabled);
	} else if (snapshot.activeVideo === null) {
		pressed('mark-a', false);
		pressed('mark-b', false);
		pressed('ab-loop', false);
	}
}

function setPressed(button: HTMLElement, pressed: boolean): void {
	button.classList.toggle('active', pressed);
	button.setAttribute('aria-pressed', String(pressed));
}

function bindFilterSliders(panel: HTMLElement): void {
	const sliders: Array<{
		cls: string;
		val: string;
	}> = [
		{ cls: '.sp-brightness', val: '.sp-brightness-val' },
		{ cls: '.sp-contrast', val: '.sp-contrast-val' },
		{ cls: '.sp-saturate', val: '.sp-saturate-val' },
	];

	sliders.forEach(({ cls, val }) => {
		const slider = panel.querySelector<HTMLInputElement>(cls);
		const valEl = panel.querySelector<HTMLElement>(val);
		if (!slider) return;

		slider.oninput = () => {
			if (valEl) valEl.textContent = `${slider.value}%`;
			queueFilter(panel);
		};

		slider.onchange = () => queueFilter(panel, true);
	});
}

function bindFilterSwitches(panel: HTMLElement): void {
	const grayscale = panel.querySelector<HTMLInputElement>('.sp-sw-grayscale');
	const invert = panel.querySelector<HTMLInputElement>('.sp-sw-invert');

	if (grayscale) {
		grayscale.onchange = () => queueFilter(panel, true);
	}

	if (invert) {
		invert.onchange = () => queueFilter(panel, true);
	}
}

function queueFilter(panel: HTMLElement, flushNow = false): void {
	const fence = captureTargetFence();
	pendingFilter = readFilter(panel);
	if (filterTimer) clearTimeout(filterTimer);
	if (flushNow) {
		filterTimer = null;
		void flushFilter(fence);
		return;
	}
	const delay = flushNow
		? 0
		: Math.max(0, FILTER_SEND_INTERVAL_MS - (performance.now() - lastFilterSentAt));
	filterTimer = setTimeout(() => {
		filterTimer = null;
		void flushFilter(fence);
	}, delay);
}

async function flushFilter(fence: ControlTargetFence = captureTargetFence()): Promise<void> {
	if (filterInFlight || !pendingFilter) return;
	if (!isCurrentTarget(fence)) return;
	const filter = pendingFilter;
	pendingFilter = null;
	filterInFlight = true;
	lastFilterSentAt = performance.now();
	try {
		await enqueueControlAction(
			fence,
			(currentFence) => submitPatch({ filter, filterEnabled: true }, currentFence),
		);
	} finally {
		filterInFlight = false;
		if (pendingFilter) {
			const panel = document.getElementById('side-panel');
			if (panel) queueFilter(panel);
		}
	}
}

// eff: attaches click handlers to seek buttons providing discrete jumps (e.g. +/- 5s, +/- 30s) based on dataset deltas
function bindSeekButtons(panel: HTMLElement): void {
	const seekBtns = panel.querySelectorAll<HTMLButtonElement>('.sp-btn-small[data-action="seek"]');

	seekBtns.forEach(btn => {
		btn.onclick = () => runControlAction(async (fence) => {
			if (currentTabId === null || !currentSnapshot) {
				throw new Error('The active video target is unavailable');
			}
			const delta = parseFloat(btn.dataset.delta ?? '0');
			if (delta !== 0) await submitOperation('seek-relative', { delta }, fence);
		});
	});
}

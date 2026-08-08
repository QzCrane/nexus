// goal: Hover Zoom heavy content runtime
// eff: Loaded only after the minimal bootstrap observes a relevant user interaction

import type { HoverZoomSettings } from '../tools/hover-zoom/types';
import { initRulesForHost } from '../tools/hover-zoom/content/resolvers/rule-resolver';
import { isValidTrigger } from '../tools/hover-zoom/content/resolvers/trigger-validator';
import {
	detectResourcePreference,
	type ModifierSnapshot,
} from '../tools/hover-zoom/content/utils/resource-key-helper';
import { showHighlight, hideHighlight } from '../tools/hover-zoom/content/utils/highlight';
import { createInitialState, createPreloadState } from './hover-zoom-state';
import {
	cancel,
	clearTriggerTimer,
	createOnClick,
	createOnMove,
	createOnOut,
	createOnOver,
	getElementAtMouse,
	tryTrigger,
} from './hover-zoom-events';
import { createOnKeyDown, createOnKeyUp } from './hover-zoom-keys';

export interface HoverZoomActivationSnapshot extends ModifierSnapshot {
	x: number;
	y: number;
	mouseHasMoved: boolean;
	source: 'mouseover' | 'mousemove' | 'keydown' | 'keyup';
}

export interface HoverZoomRuntime {
	activate(snapshot: HoverZoomActivationSnapshot): Promise<void>;
	updateSettings(settings: HoverZoomSettings): Promise<void>;
}

const state = createInitialState({} as HoverZoomSettings);
const preload = createPreloadState();
let runtime: HoverZoomRuntime | null = null;

function findTriggerElement(element: HTMLElement | null): HTMLElement | null {
	let current = element;
	while (current && !isValidTrigger(current)) current = current.parentElement;
	return current && isValidTrigger(current) ? current : null;
}

/** Initialize the heavy runtime from the bootstrap-owned settings snapshot. */
export async function init(initialSettings: HoverZoomSettings): Promise<HoverZoomRuntime> {
	if (runtime) {
		await runtime.updateSettings(initialSettings);
		return runtime;
	}

	state.initialized = true;
	state.settings = initialSettings;

	const onOver = createOnOver(state, preload);
	const onOut = createOnOut(state);
	const onMove = createOnMove(state, preload);
	const onClick = createOnClick(state);
	const onKeyDown = createOnKeyDown(state, preload);
	const onKeyUp = createOnKeyUp(state);
	let listenersAttached = false;
	let rulesInitialized = false;
	let activationPromise: Promise<void> | null = null;

	const attachListeners = (): Promise<void> => {
		if (listenersAttached || !state.settings.enabled) return Promise.resolve();
		if (activationPromise) return activationPromise;

		activationPromise = (async () => {
			if (!rulesInitialized) {
				await initRulesForHost();
				rulesInitialized = true;
			}
			if (!state.settings.enabled || listenersAttached) return;
			listenersAttached = true;
			document.addEventListener('mouseover', onOver, true);
			document.addEventListener('mouseout', onOut, true);
			document.addEventListener('mousemove', onMove, { passive: true });
			document.addEventListener('click', onClick, true);
			document.addEventListener('keydown', onKeyDown, true);
			document.addEventListener('keyup', onKeyUp, true);
		})().finally(() => {
			activationPromise = null;
		});
		return activationPromise;
	};

	const detachListeners = (): void => {
		if (listenersAttached) {
			listenersAttached = false;
			document.removeEventListener('mouseover', onOver, true);
			document.removeEventListener('mouseout', onOut, true);
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('click', onClick, true);
			document.removeEventListener('keydown', onKeyDown, true);
			document.removeEventListener('keyup', onKeyUp, true);
		}
		clearTriggerTimer();
		cancel(state);
		state.modifiersActive = false;
		state.currentResourcePref = 'auto';
		preload.pending = null;
		if (preload.preloadImage) preload.preloadImage.src = '';
	};

	const updateSettings = async (settings: HoverZoomSettings): Promise<void> => {
		state.settings = settings;
		state.viewer?.updateSettings(settings);
		if (settings.enabled) await attachListeners();
		else detachListeners();
	};

	const activate = async (snapshot: HoverZoomActivationSnapshot): Promise<void> => {
		state.lastX = snapshot.x;
		state.lastY = snapshot.y;
		state.mouseHasMoved = snapshot.mouseHasMoved;
		if (!state.settings.enabled) return;

		if (snapshot.source === 'mouseover' && state.settings.highlightMode === 'always') {
			const hovered = findTriggerElement(getElementAtMouse(state));
			hovered ? showHighlight(hovered) : hideHighlight();
		}

		const resourcePref = detectResourcePreference(state.settings.resourceKeys, snapshot);
		if (resourcePref === null) {
			state.modifiersActive = false;
			state.currentResourcePref = 'auto';
			return;
		}

		state.modifiersActive = true;
		state.currentResourcePref = resourcePref;
		if (!state.mouseHasMoved || snapshot.source === 'keyup') return;
		if (state.viewer?.getIsVisible()) return;

		const trigger = findTriggerElement(getElementAtMouse(state));
		if (!trigger) return;
		if (state.settings.highlightMode === 'hotkey') showHighlight(trigger);
		await tryTrigger(state, preload, trigger);
	};

	runtime = { activate, updateSettings };
	await attachListeners();
	return runtime;
}

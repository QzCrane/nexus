// goal: owns the event-driven lifecycle of every media element in the current document

import { AudioMode, WebAudioController } from '@nexus/audio-engine';
import { DEFAULT_AUDIO_CONFIG } from '@nexus/kernel';
import { registerDomMedia, refreshDomMedia } from '../../audio/dom-volume';
import {
	getElementState,
	holdSettingByPlugin,
} from '../../audio/volume-observer';
import type { PolicyExecutor } from '../../logic/policy-executor';
import { toWebAudioProcessingConfig } from '../../logic/mode-executor';
import type { PolicyExecutorState } from '../../types';
import { createCleanupManager, createEventListener, debounce } from '../../utils/timing';
import { isExtensionContextValid } from '../context-guard';

export const MEDIA_REGISTRY_CHANGED_EVENT = 'spectra:media-registry-change';
export const MEDIA_REGISTRY_REFRESH_EVENT = 'spectra:media-registry-refresh';

let activeMediaRegistry: Set<HTMLMediaElement> | null = null;

export function hasMediaElements(): boolean {
	if (activeMediaRegistry) return activeMediaRegistry.size > 0;
	return document.querySelector('video, audio') !== null;
}

export function createMediaObserver(
	state: PolicyExecutorState,
	audioController: WebAudioController,
	_policyExecutor: PolicyExecutor,
	onMediaStateChange?: () => void,
): () => void {
	const cleanup = createCleanupManager();
	const media = new Set<HTMLMediaElement>();
	const elementDisposers = new Map<HTMLMediaElement, () => void>();
	activeMediaRegistry = media;

	const notifyRegistryChanged = debounce(() => {
		document.dispatchEvent(new CustomEvent(MEDIA_REGISTRY_CHANGED_EVENT));
		onMediaStateChange?.();
	}, 50);

	const applySpeed = (element: HTMLMediaElement): void => {
		const elementState = getElementState(element);
		const desiredSpeed = state.config.speed;
		if (desiredSpeed === DEFAULT_AUDIO_CONFIG.speed) {
			if (!elementState.speedOwnedBySpectra) return;
			holdSettingByPlugin(element);
			try {
				element.playbackRate = elementState.baselineSpeed;
				elementState.speed = elementState.baselineSpeed;
				elementState.speedOwnedBySpectra = false;
			} catch {
				// Detached or page-proxied media can reject property writes.
			}
			return;
		}
		if (Math.abs(element.playbackRate - desiredSpeed) < 0.005) return;
		if (!elementState.speedOwnedBySpectra) {
			elementState.baselineSpeed = element.playbackRate;
			elementState.speedOwnedBySpectra = true;
		}
		holdSettingByPlugin(element);
		try {
			element.playbackRate = desiredSpeed;
			elementState.speed = desiredSpeed;
		} catch {
			// Keep the registry alive when a site exposes a read-only media proxy.
		}
	};

	const applyCurrentConfig = (element: HTMLMediaElement, attachWebAudio = false): void => {
		applySpeed(element);
		refreshDomMedia(element);
		if (state.activeMode !== AudioMode.NATIVE_WEBAUDIO || !attachWebAudio) return;
		audioController.attachNode(element);
		audioController.updateElementParams(element, toWebAudioProcessingConfig(state.config));
	};

	const unregister = (element: HTMLMediaElement): boolean => {
		const dispose = elementDisposers.get(element);
		if (!dispose) return false;
		elementDisposers.delete(element);
		media.delete(element);
		dispose();
		audioController.detachNode(element);
		return true;
	};

	const register = (element: HTMLMediaElement): boolean => {
		if (elementDisposers.has(element)) return false;
		media.add(element);
		applySpeed(element);
		const disposeDomMonitor = registerDomMedia(element, () => notifyRegistryChanged());
		const handleActiveMediaEvent = () => {
			if (!media.has(element)) return;
			applyCurrentConfig(element);
			notifyRegistryChanged();
		};
		const handlePassiveMediaEvent = () => {
			if (media.has(element)) notifyRegistryChanged();
		};
		element.addEventListener('play', handleActiveMediaEvent);
		element.addEventListener('loadedmetadata', handleActiveMediaEvent);
		element.addEventListener('pause', handlePassiveMediaEvent);
		element.addEventListener('ended', handlePassiveMediaEvent);
		elementDisposers.set(element, () => {
			element.removeEventListener('play', handleActiveMediaEvent);
			element.removeEventListener('loadedmetadata', handleActiveMediaEvent);
			element.removeEventListener('pause', handlePassiveMediaEvent);
			element.removeEventListener('ended', handlePassiveMediaEvent);
			disposeDomMonitor();
		});
		applyCurrentConfig(element, true);
		return true;
	};

	const collect = (node: Node, output: Set<HTMLMediaElement>): void => {
		if (node instanceof HTMLMediaElement) output.add(node);
		if (node instanceof Element) {
			node.querySelectorAll<HTMLMediaElement>('video, audio').forEach((element) => output.add(element));
		}
	};

	const reconcileDocument = (): void => {
		if (!isExtensionContextValid()) return;
		const present = new Set(document.querySelectorAll<HTMLMediaElement>('video, audio'));
		let changed = false;
		for (const element of media) {
			if (!present.has(element)) changed = unregister(element) || changed;
		}
		for (const element of present) changed = register(element) || changed;
		if (changed) notifyRegistryChanged();
	};

	document.querySelectorAll<HTMLMediaElement>('video, audio').forEach((element) => register(element));

	const observer = new MutationObserver((records) => {
		if (!isExtensionContextValid()) return;
		const added = new Set<HTMLMediaElement>();
		const removed = new Set<HTMLMediaElement>();
		for (const record of records) {
			record.addedNodes.forEach((node) => collect(node, added));
			record.removedNodes.forEach((node) => collect(node, removed));
		}

		let changed = false;
		for (const element of removed) changed = unregister(element) || changed;
		for (const element of added) changed = register(element) || changed;
		if (changed) notifyRegistryChanged();
	});

	observer.observe(document.documentElement, { childList: true, subtree: true });
	cleanup.add(() => observer.disconnect());
	cleanup.add(createEventListener(document, MEDIA_REGISTRY_REFRESH_EVENT, reconcileDocument));
	cleanup.add(createEventListener(window, 'popstate', reconcileDocument));
	cleanup.add(createEventListener(window, 'hashchange', reconcileDocument));
	cleanup.add(notifyRegistryChanged.cancel);
	cleanup.add(() => {
		for (const element of [...media]) unregister(element);
		if (activeMediaRegistry === media) activeMediaRegistry = null;
	});

	return cleanup.dispose;
}

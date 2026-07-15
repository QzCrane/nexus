// goal: execute strictly validated SPECTRA v2 media/video commands in one document

import {
	rpcFailure,
	rpcSuccess,
	type SpectraRequestEnvelope,
	type SpectraRequestType,
} from '@nexus/contracts';
import type { PolicyExecutor, PolicyExecutorState } from './policy-executor';
import { executeHotkeyAction } from '../input/hotkey-actions';
import { getMediaState, seekVideo, togglePip, togglePlay } from './media-control';
import {
	rotateVideo,
	takeScreenshot,
	toggleCrop,
	toggleFullscreen,
	toggleMirror,
} from '../video/video-transform';
import { resetVideoFilter, setVideoFilter, toggleDimBackground } from '../video/video-filter';
import { clearABLoop, getABState, setPointA, setPointB } from '../video/ab-loop';
import { addMarker, jumpToMarker, listMarkers, removeMarker } from '../video/time-marker';

type ContentCommandType = Extract<
	SpectraRequestType,
	| 'spectra.audio.visualizer.get'
	| 'spectra.hotkey.trigger'
	| `spectra.media.${string}`
	| `spectra.video.${string}`
>;

export interface SpectraCommandHandlerDeps {
	state: PolicyExecutorState;
	policyExecutor?: PolicyExecutor;
	getVisualizerData: () => Uint8Array | null;
}

export function isContentCommandType(type: SpectraRequestType): type is ContentCommandType {
	return type === 'spectra.audio.visualizer.get'
		|| type === 'spectra.hotkey.trigger'
		|| type.startsWith('spectra.media.')
		|| type.startsWith('spectra.video.');
}

function respondWithFailure(
	sendResponse: (response?: unknown) => void,
	error: unknown,
): void {
	sendResponse(rpcFailure(
		'command_failed',
		error instanceof Error ? error.message : String(error),
		true,
	));
}

// post: returns true when an asynchronous response keeps the message port open
export function handleSpectraContentCommand(
	message: SpectraRequestEnvelope,
	deps: SpectraCommandHandlerDeps,
	sendResponse: (response?: unknown) => void,
): boolean {
	try {
		switch (message.type) {
			case 'spectra.audio.visualizer.get': {
				const data = deps.getVisualizerData();
				sendResponse(rpcSuccess({ buffer: data ? Array.from(data) : null }));
				return false;
			}
			case 'spectra.hotkey.trigger':
				executeHotkeyAction(message.payload.action);
				sendResponse(rpcSuccess({ handled: true as const }));
				return false;
			case 'spectra.media.state.get':
				sendResponse(rpcSuccess(getMediaState()));
				return false;
			case 'spectra.media.play.toggle':
				sendResponse(rpcSuccess({ playing: togglePlay() }));
				return false;
			case 'spectra.media.pip.toggle':
				void togglePip().then(
					(active) => sendResponse(rpcSuccess({ active })),
					(error) => respondWithFailure(sendResponse, error),
				);
				return true;
			case 'spectra.media.speed.set': {
				if (!deps.policyExecutor) {
					sendResponse(rpcFailure('runtime_booting', 'Audio runtime is still starting', true));
					return false;
				}
				const requested = message.payload.delta === undefined
					? message.payload.speed ?? 1
					: (deps.state.config.speed || 1) + message.payload.delta;
				const speed = Math.max(0.1, Math.min(16, requested));
				const preservePitch = message.payload.preservePitch ?? true;
				void deps.policyExecutor.updateConfig({ speed }, { showOSD: true }).then(
					(result) => sendResponse(result.ok
						? rpcSuccess({ speed, preservePitch })
						: result),
					(error) => respondWithFailure(sendResponse, error),
				);
				return true;
			}
			case 'spectra.video.rotate':
				sendResponse(rpcSuccess({ rotation: rotateVideo(message.payload.delta) }));
				return false;
			case 'spectra.video.mirror.toggle':
				sendResponse(rpcSuccess({ mirrored: toggleMirror() }));
				return false;
			case 'spectra.video.screenshot':
				sendResponse(rpcSuccess({ dataUrl: takeScreenshot() }));
				return false;
			case 'spectra.video.fullscreen.toggle':
				void toggleFullscreen().then(
					(active) => sendResponse(rpcSuccess({ active })),
					(error) => respondWithFailure(sendResponse, error),
				);
				return true;
			case 'spectra.video.crop.toggle':
				sendResponse(rpcSuccess({ cropped: toggleCrop() }));
				return false;
			case 'spectra.video.seek':
				sendResponse(rpcSuccess({ currentTime: seekVideo(message.payload.delta) }));
				return false;
			case 'spectra.video.filter.set':
				sendResponse(rpcSuccess({ applied: setVideoFilter(message.payload) }));
				return false;
			case 'spectra.video.filter.reset':
				sendResponse(rpcSuccess({ reset: resetVideoFilter() }));
				return false;
			case 'spectra.video.dim.toggle':
				sendResponse(rpcSuccess(toggleDimBackground(message.payload)));
				return false;
			case 'spectra.video.ab.a.set':
				sendResponse(rpcSuccess({ pointA: setPointA() }));
				return false;
			case 'spectra.video.ab.b.set':
				sendResponse(rpcSuccess(setPointB()));
				return false;
			case 'spectra.video.ab.clear':
				sendResponse(rpcSuccess({ cleared: clearABLoop() }));
				return false;
			case 'spectra.video.ab.get':
				sendResponse(rpcSuccess(getABState()));
				return false;
			case 'spectra.video.marker.add':
				sendResponse(rpcSuccess({ marker: addMarker(message.payload.label) }));
				return false;
			case 'spectra.video.marker.remove':
				sendResponse(rpcSuccess({ removed: removeMarker(message.payload.id) }));
				return false;
			case 'spectra.video.marker.jump':
				sendResponse(rpcSuccess(jumpToMarker(message.payload.id)));
				return false;
			case 'spectra.video.marker.list':
				sendResponse(rpcSuccess({ markers: listMarkers() }));
				return false;
		}
	} catch (error) {
		respondWithFailure(sendResponse, error);
	}
	return false;
}

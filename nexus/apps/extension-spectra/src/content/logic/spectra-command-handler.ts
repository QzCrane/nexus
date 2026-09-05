// goal: content-owned reads and explicit retirement of unauthorizable legacy mutation RPCs

import {
	rpcFailure,
	rpcSuccess,
	type SpectraRequestEnvelope,
	type SpectraRequestType,
} from '@nexus/contracts';
import { executeHotkeyAction } from '../input/hotkey-actions';
import { getActiveMediaRegistry } from '../core/media-registry';
import { getABState } from '../video/ab-loop';
import { listMarkers } from '../video/time-marker';

type ContentCommandType = Extract<
	SpectraRequestType,
	| 'spectra.hotkey.trigger'
	| `spectra.media.${string}`
	| `spectra.video.${string}`
>;

export function isContentCommandType(type: SpectraRequestType): type is ContentCommandType {
	return type === 'spectra.hotkey.trigger'
		|| type.startsWith('spectra.media.')
		|| type.startsWith('spectra.video.');
}

function respondWithFailure(sendResponse: (response?: unknown) => void, error: unknown): void {
	sendResponse(rpcFailure(
		'command_failed',
		error instanceof Error ? error.message : String(error),
		true,
	));
}

function activeMediaState(): {
	playing: boolean;
	speed: number;
	pipActive: boolean;
	preservePitch: boolean;
} {
	const media = getActiveMediaRegistry()?.resolve(null)?.element ?? null;
	return {
		playing: media ? !media.paused : false,
		speed: media?.playbackRate ?? 1,
		pipActive: document.pictureInPictureElement === media,
		preservePitch: media && 'preservesPitch' in media
			? (media as HTMLMediaElement & { preservesPitch: boolean }).preservesPitch
			: true,
	};
}

// post: returns true when an asynchronous response keeps the message port open
export function handleSpectraContentCommand(
	message: SpectraRequestEnvelope,
	sendResponse: (response?: unknown) => void,
): boolean {
	try {
		switch (message.type) {
			case 'spectra.hotkey.trigger':
				void executeHotkeyAction(message.payload.action).then(
					() => sendResponse(rpcSuccess({ handled: true as const })),
					(error) => respondWithFailure(sendResponse, error),
				);
				return true;
			case 'spectra.media.state.get':
				sendResponse(rpcSuccess(activeMediaState()));
				return false;
			case 'spectra.media.play.toggle':
			case 'spectra.media.pip.toggle':
			case 'spectra.media.speed.set':
			case 'spectra.video.rotate':
			case 'spectra.video.mirror.toggle':
			case 'spectra.video.screenshot':
			case 'spectra.video.fullscreen.toggle':
			case 'spectra.video.crop.toggle':
			case 'spectra.video.seek':
			case 'spectra.video.filter.set':
			case 'spectra.video.filter.reset':
			case 'spectra.video.dim.toggle':
			case 'spectra.video.ab.a.set':
			case 'spectra.video.ab.b.set':
			case 'spectra.video.ab.clear':
			case 'spectra.video.marker.add':
			case 'spectra.video.marker.remove':
			case 'spectra.video.marker.jump':
				sendResponse(rpcFailure(
					'legacy_command_retired',
					'Legacy content mutation RPCs are retired; use the sender-authorized control coordinator',
				));
				return false;
			case 'spectra.video.ab.get':
				sendResponse(rpcSuccess(getABState()));
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

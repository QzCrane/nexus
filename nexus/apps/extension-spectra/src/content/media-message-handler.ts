/**
 * SPECTRA Content Script - 媒体消息处理器
 *
 * 职责：处理 MEDIA_* 和 VIDEO_* 系列消息
 */

import { Actions } from '@nexus/contracts';
import { togglePlay, togglePip, setSpeed, getMediaState, seekVideo } from './media-control';
import { rotateVideo, toggleMirror, takeScreenshot, toggleFullscreen, toggleCrop } from './video-transform';
import { setVideoFilter, resetVideoFilter, toggleDimBackground } from './video-filter';

/** 媒体消息 Payload 类型 */
type MsgPayload = { speed?: number; delta?: number; brightness?: number; contrast?: number; saturate?: number; grayscale?: boolean; invert?: boolean } | undefined;

/**
 * 处理媒体控制消息
 * @returns true if handled, false if not a media action
 */
export function handleMediaMessage(
	action: string,
	payload: unknown,
	sendResponse: (response?: unknown) => void
): boolean {
	const p = payload as MsgPayload;

	switch (action) {
		case Actions.MEDIA_TOGGLE_PLAY: {
			const playing = togglePlay();
			sendResponse({ playing });
			return true;
		}

		case Actions.MEDIA_TOGGLE_PIP: {
			togglePip().then(active => sendResponse({ active }));
			return true;
		}

		case Actions.MEDIA_SET_SPEED: {
			const speed = setSpeed(p?.speed ?? 1);
			sendResponse({ speed });
			return true;
		}

		case Actions.MEDIA_GET_STATE: {
			sendResponse(getMediaState());
			return true;
		}

		case Actions.VIDEO_ROTATE: {
			const rotation = rotateVideo();
			sendResponse({ rotation });
			return true;
		}

		case Actions.VIDEO_MIRROR: {
			const mirrored = toggleMirror();
			sendResponse({ mirrored });
			return true;
		}

		case Actions.VIDEO_SCREENSHOT: {
			const dataUrl = takeScreenshot();
			sendResponse({ dataUrl });
			return true;
		}

		case Actions.VIDEO_FULLSCREEN: {
			toggleFullscreen().then(active => sendResponse({ active }));
			return true;
		}

		case Actions.VIDEO_CROP: {
			const cropped = toggleCrop();
			sendResponse({ cropped });
			return true;
		}

		case Actions.VIDEO_SEEK: {
			const currentTime = seekVideo(p?.delta ?? 0);
			sendResponse({ currentTime });
			return true;
		}

		case Actions.VIDEO_SET_FILTER: {
			const applied = setVideoFilter(p ?? {});
			sendResponse({ applied });
			return true;
		}

		case Actions.VIDEO_RESET_FILTER: {
			const reset = resetVideoFilter();
			sendResponse({ reset });
			return true;
		}

		case Actions.VIDEO_DIM_BACKGROUND: {
			const dp = payload as { enabled?: boolean; opacity?: number } | undefined;
			const result = toggleDimBackground(dp);
			sendResponse(result);
			return true;
		}

		default:
			return false;
	}
}

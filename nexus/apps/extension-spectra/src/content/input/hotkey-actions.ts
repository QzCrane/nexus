// goal: routes global hotkey actions to their respective functional handlers (media, video, audio, etc.)

import type { HotkeyAction, HotkeyParams } from '@nexus/contracts';
import { createLogger } from '../../shared/logger';
import { togglePlay, togglePip, getMediaState, seekVideo } from '../logic/media-control';
import { rotateVideo, toggleMirror, takeScreenshot, toggleFullscreen } from '../video/video-transform';
import { resetVideoFilter, toggleDimBackground, toggleVideoFilter } from '../video/video-filter';
import { addMarker } from '../video/time-marker';
import { setPointA, setPointB, clearABLoop, getABState, skipABLoop } from '../video/ab-loop';
import { showToast } from '../ui/toast';
import {
	sendVolumeAction, sendSpeedAction, sendAudioReset, sendAudioAdjustment, sendCaptureToggle, jumpMarker, toggleLoop, sendTabAction,
} from './hotkey-helpers';
import { sendSpectraRequest } from '../../shared/spectra-client';

export { setCaptureModeToggler, setConfigGetter, setConfigUpdater } from './hotkey-helpers';

const log = createLogger('HotkeyActions');

type HotkeyHandler = (params?: HotkeyParams) => void;

function showInfo(): void {
	const media = getMediaState();
	const ab = getABState();
	const abLabel = ab.pointA !== null && ab.pointB !== null
		? ` · A/B ${ab.pointA.toFixed(1)}–${ab.pointB.toFixed(1)}s`
		: '';
	showToast(`${media.playing ? 'Playing' : 'Paused'} · ${media.speed.toFixed(2)}x${abLabel}`);
}

function executeUserScript(params?: HotkeyParams): void {
	if (!params?.script) return;
	void sendSpectraRequest('spectra.user-script.execute', { script: params.script })
		.then((response) => {
			if (!response.ok) {
				log.warn('User script execution failed:', response.error.message);
				showToast(response.error.message);
			}
		})
		.catch((error) => log.error('User script message failed:', error));
}

function openUrl(params?: HotkeyParams): void {
	if (!params?.url) return;
	try {
		const url = new URL(params.url);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Unsupported URL protocol');
		const opened = window.open(url.href, '_blank', 'noopener,noreferrer');
		if (opened) opened.opener = null;
	} catch {
		showToast('Only HTTP and HTTPS URLs are allowed');
	}
}

// inv: every persisted HotkeyAction has an explicit runtime disposition.
export const HOTKEY_ACTION_HANDLERS = {
	none: () => undefined,
	play_pause: () => togglePlay(),
	seek_forward_5s: () => seekVideo(5),
	seek_forward_10s: () => seekVideo(10),
	seek_forward_30s: () => seekVideo(30),
	seek_backward_5s: () => seekVideo(-5),
	seek_backward_10s: () => seekVideo(-10),
	seek_backward_30s: () => seekVideo(-30),
	seek_frame_forward: () => seekVideo(1 / 30),
	seek_frame_backward: () => seekVideo(-1 / 30),
	speed_up: (params) => sendSpeedAction('speed_up', params),
	speed_down: (params) => sendSpeedAction('speed_down', params),
	speed_reset: (params) => sendSpeedAction('speed_reset', params),
	speed_set: (params) => sendSpeedAction('speed_set', params),
	volume_up: (params) => sendVolumeAction('volume_up', params),
	volume_down: (params) => sendVolumeAction('volume_down', params),
	volume_mute: (params) => sendVolumeAction('volume_mute', params),
	volume_set: (params) => sendVolumeAction('volume_set', params),
	audio_reset: () => sendAudioReset(),
	gain_up: (params) => sendAudioAdjustment('gain_up', params),
	gain_down: (params) => sendAudioAdjustment('gain_down', params),
	pitch_up: () => showToast('Pitch controls are unavailable; reassign this shortcut in Options'),
	pitch_down: () => showToast('Pitch controls are unavailable; reassign this shortcut in Options'),
	pitch_reset: () => showToast('Pitch controls are unavailable; reassign this shortcut in Options'),
	delay_up: (params) => sendAudioAdjustment('delay_up', params),
	delay_down: (params) => sendAudioAdjustment('delay_down', params),
	delay_reset: (params) => sendAudioAdjustment('delay_reset', params),
	pan_left: (params) => sendAudioAdjustment('pan_left', params),
	pan_right: (params) => sendAudioAdjustment('pan_right', params),
	pan_reset: (params) => sendAudioAdjustment('pan_reset', params),
	mono_toggle: (params) => sendAudioAdjustment('mono_toggle', params),
	capture_toggle: () => sendCaptureToggle(),
	fullscreen_toggle: () => toggleFullscreen(),
	pip_toggle: () => togglePip(),
	rotate_cw: () => rotateVideo(90),
	rotate_ccw: () => rotateVideo(-90),
	mirror_toggle: () => toggleMirror(),
	screenshot: () => takeScreenshot(),
	dim_background: () => toggleDimBackground(),
	marker_add: () => { addMarker(); showToast('Marker added'); },
	marker_jump_prev: () => jumpMarker(false),
	marker_jump_next: () => jumpMarker(true),
	ab_set_a: () => { setPointA(); showToast('Point A set'); },
	ab_set_b: () => { setPointB(); showToast('Point B set'); },
	ab_clear: () => { clearABLoop(); showToast('AB loop cleared'); },
	ab_skip: () => showToast(skipABLoop() ? 'Skipped A/B segment' : 'Set A and B first'),
	loop_toggle: () => toggleLoop(),
	fx_toggle: () => showToast(toggleVideoFilter() ? 'Video effects on' : 'Video effects off'),
	fx_reset: () => resetVideoFilter(),
	tab_pin: () => sendTabAction('tab_pin'),
	tab_mute: () => sendTabAction('tab_mute'),
	show_info: () => showInfo(),
	open_popup: () => { void sendSpectraRequest('spectra.ui.open', { view: 'popup' }).catch(() => undefined); },
	open_options: () => { void sendSpectraRequest('spectra.ui.open', { view: 'options' }).catch(() => undefined); },
	run_js: executeUserScript,
	open_url: openUrl,
} satisfies Record<HotkeyAction, HotkeyHandler>;

export const HANDLED_HOTKEY_ACTIONS: ReadonlySet<HotkeyAction> = new Set(
	Object.keys(HOTKEY_ACTION_HANDLERS) as HotkeyAction[],
);

// eff: executes the requested action through the exhaustive, testable registry
export function executeHotkeyAction(action: HotkeyAction, params?: HotkeyParams): void {
	log.debug(`Executing action: ${action}`, params);
	HOTKEY_ACTION_HANDLERS[action](params);
}

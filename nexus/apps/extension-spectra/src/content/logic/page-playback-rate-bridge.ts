// goal: ask a page-world player setter to update the exact controlled media element

import {
	SPECTRA_PLAYBACK_RATE_EVENT,
	SPECTRA_PLAYBACK_RATE_REQUEST_ATTRIBUTE,
	SPECTRA_PLAYBACK_RATE_RESULT_ATTRIBUTE,
	type SpectraPlaybackRateRequest,
	type SpectraPlaybackRateResult,
} from '../../shared/playback-rate-bridge';

function decodeResult(encoded: string | null, requestId: string): number | null {
	if (!encoded) return null;
	try {
		const result = JSON.parse(encoded) as Partial<SpectraPlaybackRateResult>;
		return result.requestId === requestId
			&& typeof result.actual === 'number'
			&& Number.isFinite(result.actual)
			? result.actual
			: null;
	} catch {
		return null;
	}
}

export function writePageSynchronizedPlaybackRate(
	element: HTMLMediaElement,
	speed: number,
): number | null {
	if (typeof document === 'undefined'
		|| typeof element.closest !== 'function'
		|| !element.closest('.xgplayer, xg-video-container')) return null;
	const requestId = crypto.randomUUID();
	const request: SpectraPlaybackRateRequest = { requestId, speed };
	try {
		element.setAttribute(SPECTRA_PLAYBACK_RATE_REQUEST_ATTRIBUTE, JSON.stringify(request));
		element.dispatchEvent(new Event(SPECTRA_PLAYBACK_RATE_EVENT));
		return decodeResult(
			element.getAttribute(SPECTRA_PLAYBACK_RATE_RESULT_ATTRIBUTE),
			requestId,
		);
	} finally {
		element.removeAttribute(SPECTRA_PLAYBACK_RATE_REQUEST_ATTRIBUTE);
		element.removeAttribute(SPECTRA_PLAYBACK_RATE_RESULT_ATTRIBUTE);
	}
}

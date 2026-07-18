// goal: exact-element DOM boundary for player-owned playback-rate state

export const SPECTRA_PLAYBACK_RATE_REQUEST_ATTRIBUTE =
	'data-spectra-playback-rate-request-v1' as const;
export const SPECTRA_PLAYBACK_RATE_RESULT_ATTRIBUTE =
	'data-spectra-playback-rate-result-v1' as const;
export const SPECTRA_PLAYBACK_RATE_EVENT =
	'spectra:playback-rate:v1' as const;

export interface SpectraPlaybackRateRequest {
	requestId: string;
	speed: number;
}

export interface SpectraPlaybackRateResult {
	requestId: string;
	actual: number | null;
	error?: string;
}

// goal: stable DOM boundary between the MAIN fullscreen wrapper and isolated audio runtime

export const SPECTRA_FULLSCREEN_BRIDGE_READY_ATTRIBUTE =
	'data-spectra-fullscreen-bridge-ready-v1' as const;
export const SPECTRA_FULLSCREEN_REQUEST_ATTRIBUTE =
	'data-spectra-fullscreen-request-v1' as const;
export const SPECTRA_FULLSCREEN_RESULT_ATTRIBUTE =
	'data-spectra-fullscreen-result-v1' as const;
export const SPECTRA_FULLSCREEN_PREPARE_EVENT =
	'spectra:fullscreen-prepare:v1' as const;
export const SPECTRA_FULLSCREEN_READY_EVENT =
	'spectra:fullscreen-ready:v1' as const;
export const SPECTRA_FULLSCREEN_FINISH_EVENT =
	'spectra:fullscreen-finish:v1' as const;

export interface SpectraFullscreenBridgeMessage {
	requestId: string;
}

const SPECTRA_FULLSCREEN_REQUEST_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Only ids minted by the MAIN bridge are valid across the page-visible boundary. */
export function isSpectraFullscreenRequestId(value: unknown): value is string {
	return typeof value === 'string'
		&& value.length === 36
		&& SPECTRA_FULLSCREEN_REQUEST_ID.test(value);
}

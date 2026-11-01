// goal: exact-element, capability-discovered page-media read/write protocol

export const SPECTRA_PAGE_MEDIA_REQUEST_ATTRIBUTE =
	'data-spectra-page-media-request-v2' as const;
export const SPECTRA_PAGE_MEDIA_RESULT_ATTRIBUTE =
	'data-spectra-page-media-result-v2' as const;
export const SPECTRA_PAGE_MEDIA_EVENT = 'spectra:page-media:v2' as const;

export const SPECTRA_PAGE_MEDIA_FIELDS = [
	'volumeBase',
	'mediaMuted',
	'speed',
] as const;

export type SpectraPageMediaField = (typeof SPECTRA_PAGE_MEDIA_FIELDS)[number];
export type SpectraPageMediaOperation = 'read' | 'write' | 'probe';
export type SpectraPageMediaValue = number | boolean;

export interface SpectraPageMediaRequest {
	requestId: string;
	operation: SpectraPageMediaOperation;
	field: SpectraPageMediaField;
	value?: SpectraPageMediaValue;
}

export interface SpectraPageMediaResult {
	requestId: string;
	field: SpectraPageMediaField;
	supported: boolean;
	actual: SpectraPageMediaValue | null;
	error?: string;
	/**
	 * Set when a declared site adapter produced this answer. The executor uses it
	 * to attribute ownership to `declared-official` rather than `page-native`,
	 * so evidence and telemetry keep the two sources separable.
	 */
	adapterId?: string;
	/**
	 * What the player's own UI showed after the operation, when the adapter
	 * declares a projection. `null` means the projection was unreadable at that
	 * moment — never that the UI agreed.
	 */
	projection?: SpectraPageMediaValue | null;
}

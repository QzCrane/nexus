// goal: narrow stable v2 site-route RPC facade shared by Popup and Content

import {
	isRegistryAddResult,
	isRegistryQueryResult,
	isRegistryRemoveResult,
	isRegistrySnapshot,
} from './media-route.contracts.js';
import {
	isRpcError,
	isRpcFailureResult,
	isRpcSuccessResult,
} from './spectra.protocol-primitives.js';
import type {
	SpectraRequestType,
	SpectraResponse,
} from './spectra.protocol.js';

export {
	createSiteRouteFingerprint,
	isDomainEntry,
	isMediaRouteFingerprint,
	isRegistryEntries,
} from './media-route.contracts.js';
export { normalizeHostname } from './domain.contracts.js';
export type {
	DomainEntry,
	MediaRoute,
	RegistryAddResult,
	RegistryQueryResult,
	RegistryRemoveResult,
	RegistrySnapshot,
} from './media-route.contracts.js';
export { SPECTRA_PROTOCOL_VERSION } from './spectra.protocol-primitives.js';

export const SPECTRA_REGISTRY_REQUEST_TYPES = [
	'spectra.registry.get',
	'spectra.registry.add',
	'spectra.registry.remove',
	'spectra.registry.query',
	'spectra.registry.mark-probed',
] as const satisfies readonly SpectraRequestType[];

export type SpectraRegistryRequestType = (typeof SPECTRA_REGISTRY_REQUEST_TYPES)[number];

function isRegistryRpcResult(
	value: unknown,
	isSuccessData: (data: unknown) => boolean,
): boolean {
	if (isRpcSuccessResult(value)) return isSuccessData(value.data);
	return isRpcFailureResult(value) && isRpcError(value.error);
}

function isRegistryResponseData(type: SpectraRegistryRequestType, value: unknown): boolean {
	switch (type) {
		case 'spectra.registry.get': return isRegistrySnapshot(value);
		case 'spectra.registry.add':
		case 'spectra.registry.mark-probed': return isRegistryAddResult(value);
		case 'spectra.registry.remove': return isRegistryRemoveResult(value);
		case 'spectra.registry.query': return isRegistryQueryResult(value);
	}
}

export function isSpectraRegistryResponse<T extends SpectraRegistryRequestType>(
	type: T,
	value: unknown,
): value is SpectraResponse<T> {
	return isRegistryRpcResult(value, (data) => isRegistryResponseData(type, data));
}

// Content uses only the query/automatic-record pair. These focused guards are
// projections of the same canonical DTO validators, so the isolated runtime
// does not have to carry Popup's list/add/remove response schemas.
export function isSpectraRegistryQueryResponse(
	value: unknown,
): value is SpectraResponse<'spectra.registry.query'> {
	return isRegistryRpcResult(value, isRegistryQueryResult);
}

export function isSpectraRegistryRecordResponse(
	value: unknown,
): value is SpectraResponse<'spectra.registry.mark-probed'> {
	return isRegistryRpcResult(value, isRegistryAddResult);
}

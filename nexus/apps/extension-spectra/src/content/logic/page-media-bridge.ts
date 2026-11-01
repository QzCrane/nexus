// goal: synchronously cross the exact-element ISOLATED/MAIN boundary for page-owned media semantics

import { isFiniteControlValue, type ControlValues } from '@nexus/contracts';
import {
	SPECTRA_PAGE_MEDIA_EVENT,
	SPECTRA_PAGE_MEDIA_REQUEST_ATTRIBUTE,
	SPECTRA_PAGE_MEDIA_RESULT_ATTRIBUTE,
	type SpectraPageMediaField,
	type SpectraPageMediaRequest,
	type SpectraPageMediaResult,
} from '../../shared/page-media-bridge';

function isActualValue<K extends SpectraPageMediaField>(
	field: K,
	value: unknown,
): value is ControlValues[K] {
	if (field === 'mediaMuted') return typeof value === 'boolean';
	return field === 'volumeBase'
		? isFiniteControlValue(value, 'nativeVolume')
		: isFiniteControlValue(value, 'speed');
}

function decodeResult<K extends SpectraPageMediaField>(
	encoded: string | null,
	requestId: string,
	field: K,
): SpectraPageMediaResult | null {
	if (!encoded) return null;
	try {
		const result = JSON.parse(encoded) as Partial<SpectraPageMediaResult>;
		return result.requestId === requestId
			&& result.field === field
			&& typeof result.supported === 'boolean'
			&& (result.actual === null || isActualValue(field, result.actual))
			&& (result.error === undefined || typeof result.error === 'string')
			&& (result.adapterId === undefined || typeof result.adapterId === 'string')
			&& (result.projection === undefined
				|| result.projection === null
				|| isActualValue(field, result.projection))
			? result as SpectraPageMediaResult
			: null;
	} catch {
		return null;
	}
}

function dispatch<K extends SpectraPageMediaField>(
	element: HTMLMediaElement,
	request: SpectraPageMediaRequest & { field: K },
	result?: { value: SpectraPageMediaResult | null },
): ControlValues[K] | null {
	if (typeof document === 'undefined'
		|| typeof element.setAttribute !== 'function'
		|| typeof element.dispatchEvent !== 'function') return null;
	try {
		element.setAttribute(SPECTRA_PAGE_MEDIA_REQUEST_ATTRIBUTE, JSON.stringify(request));
		element.dispatchEvent(new Event(SPECTRA_PAGE_MEDIA_EVENT, { composed: true }));
		const decoded = decodeResult(
			element.getAttribute(SPECTRA_PAGE_MEDIA_RESULT_ATTRIBUTE),
			request.requestId,
			request.field,
		);
		if (result) result.value = decoded;
		if (!decoded?.supported) return null;
		if (request.operation === 'probe') return true as ControlValues[K];
		if (decoded.error || decoded.actual === null) {
			throw new Error(decoded.error ?? `Page-media ${request.field} returned no actual value`);
		}
		return decoded.actual as ControlValues[K];
	} finally {
		element.removeAttribute(SPECTRA_PAGE_MEDIA_REQUEST_ATTRIBUTE);
		element.removeAttribute(SPECTRA_PAGE_MEDIA_RESULT_ATTRIBUTE);
	}
}

export function readPageMediaField<K extends SpectraPageMediaField>(
	element: HTMLMediaElement,
	field: K,
): ControlValues[K] | null {
	return dispatch(element, {
		requestId: crypto.randomUUID(),
		operation: 'read',
		field,
	});
}

/** Everything the bridge knows about a read, including its evidence channels. */
export interface PageMediaEvidence<K extends SpectraPageMediaField> {
	readonly actual: ControlValues[K];
	/**
	 * What the player's own UI showed. `null` means unreadable — never that the
	 * UI agreed. Only a declared adapter can produce one.
	 */
	readonly projection: ControlValues[K] | null;
	/** Set when a declared site adapter answered; null for generic discovery. */
	readonly adapterId: string | null;
}

export function readPageMediaEvidence<K extends SpectraPageMediaField>(
	element: HTMLMediaElement,
	field: K,
): PageMediaEvidence<K> | null {
	const holder: { value: SpectraPageMediaResult | null } = { value: null };
	const actual = dispatch(element, {
		requestId: crypto.randomUUID(),
		operation: 'read',
		field,
	}, holder);
	if (actual === null || !holder.value) return null;
	return {
		actual,
		projection: (holder.value.projection ?? null) as ControlValues[K] | null,
		adapterId: holder.value.adapterId ?? null,
	};
}

export interface PageMediaProbe {
	readonly supported: boolean;
	/** Present when the host matched a declared row, even if discovery failed. */
	readonly adapterId: string | null;
}

// post: reports whether an amplified page volume controller exists for this
// element WITHOUT any read or write — page-entry solidification depends on
// this being side-effect-free.
export function probePageMediaCapability(
	element: HTMLMediaElement,
	field: SpectraPageMediaField,
): boolean {
	return probePageMediaDetail(element, field).supported;
}

export function probePageMediaDetail(
	element: HTMLMediaElement,
	field: SpectraPageMediaField,
): PageMediaProbe {
	const holder: { value: SpectraPageMediaResult | null } = { value: null };
	try {
		const supported = dispatch(element, {
			requestId: crypto.randomUUID(),
			operation: 'probe',
			field,
		}, holder) !== null;
		return { supported, adapterId: holder.value?.adapterId ?? null };
	} catch {
		return { supported: false, adapterId: null };
	}
}

export function writePageMediaField(
	element: HTMLMediaElement,
	field: SpectraPageMediaField,
	value: ControlValues[SpectraPageMediaField],
): ControlValues[SpectraPageMediaField] | null {
	return dispatch(element, {
		requestId: crypto.randomUUID(),
		operation: 'write',
		field,
		value,
	});
}

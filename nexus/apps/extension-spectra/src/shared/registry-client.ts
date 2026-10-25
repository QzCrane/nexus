// goal: stable typed client for the v2 site-route registry projection

import type {
	MediaRoute,
	RegistryAddResult,
	RegistryQueryResult,
	RegistryRemoveResult,
	RegistrySnapshot,
} from '@nexus/contracts/registry-runtime';
import {
	SPECTRA_PROTOCOL_VERSION,
	isSpectraRegistryQueryResponse,
	isSpectraRegistryRecordResponse,
	isSpectraRegistryResponse,
	type SpectraRegistryRequestType,
} from '@nexus/contracts/registry-runtime';
import { createSpectraRequest } from '@nexus/contracts';
import type { MediaRouteRulesSnapshot, MediaRouteScope, SpectraRequestPayload, SpectraResponse } from '@nexus/contracts';
import { sendSpectraRequest } from './spectra-client';

async function sendRegistryEnvelope<T extends SpectraRegistryRequestType>(
	type: T,
	payload: SpectraRequestPayload<T>,
): Promise<unknown> {
	return chrome.runtime.sendMessage(createSpectraRequest(type, payload));
}

async function sendRegistryRequest<T extends SpectraRegistryRequestType>(
	type: T,
	payload: SpectraRequestPayload<T>,
): Promise<SpectraResponse<T>> {
	const response = await sendRegistryEnvelope(type, payload);
	if (!isSpectraRegistryResponse(type, response)) {
		throw new Error(
			`Background returned an invalid SPECTRA extension RPC v${SPECTRA_PROTOCOL_VERSION} site-route response for ${type}`,
		);
	}
	return response;
}

async function sendContentRegistryQuery(
	domain: string,
	fingerprint: string,
): Promise<SpectraResponse<'spectra.registry.query'>> {
	const response = await sendRegistryEnvelope('spectra.registry.query', { domain, fingerprint });
	if (!isSpectraRegistryQueryResponse(response)) {
		throw new Error(
			`Background returned an invalid SPECTRA extension RPC v${SPECTRA_PROTOCOL_VERSION} site-route response for spectra.registry.query`,
		);
	}
	return response;
}

async function sendContentRegistryRecord(
	domain: string,
	fingerprint: string,
	route: MediaRoute,
	options: { force?: boolean },
): Promise<SpectraResponse<'spectra.registry.mark-probed'>> {
	const response = await sendRegistryEnvelope('spectra.registry.mark-probed', {
		domain,
		fingerprint,
		route,
		...(options.force ? { force: true } : {}),
	});
	if (!isSpectraRegistryRecordResponse(response)) {
		throw new Error(
			`Background returned an invalid SPECTRA extension RPC v${SPECTRA_PROTOCOL_VERSION} site-route response for spectra.registry.mark-probed`,
		);
	}
	return response;
}

export async function getRegistrySnapshot(): Promise<RegistrySnapshot> {
	const response = await sendRegistryRequest('spectra.registry.get', {});
	if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
	return response.data;
}

export async function addRegistryDomain(domain: string, route: MediaRoute): Promise<RegistryAddResult> {
	const response = await sendRegistryRequest('spectra.registry.add', { domain, route });
	if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
	return response.data;
}

export async function removeRegistryDomain(fingerprint: string): Promise<RegistryRemoveResult> {
	const response = await sendRegistryRequest('spectra.registry.remove', { fingerprint });
	if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
	return response.data;
}

export async function getMediaRouteRules(): Promise<MediaRouteRulesSnapshot> {
	const response = await sendSpectraRequest('spectra.media-route.rules.get', {});
	if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
	return response.data;
}

export async function upsertMediaRouteRule(
	scope: MediaRouteScope,
	route: MediaRoute,
): Promise<MediaRouteRulesSnapshot> {
	const response = await sendSpectraRequest('spectra.media-route.rules.upsert', {
		domain: scope.domain,
		...(scope.pathPrefix ? { pathPrefix: scope.pathPrefix } : {}),
		route,
	});
	if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
	return response.data;
}

export async function removeMediaRouteRule(fingerprint: string): Promise<MediaRouteRulesSnapshot> {
	const response = await sendSpectraRequest('spectra.media-route.rules.remove', { fingerprint });
	if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
	return response.data;
}

export async function queryRegistryDomain(
	domain: string,
	fingerprint: string,
): Promise<RegistryQueryResult> {
	const response = await sendContentRegistryQuery(domain, fingerprint);
	if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
	return response.data;
}

export async function markRegistryDomainProbed(
	domain: string,
	fingerprint: string,
	route: MediaRoute,
	options: { force?: boolean } = {},
): Promise<RegistryAddResult> {
	const response = await sendContentRegistryRecord(domain, fingerprint, route, options);
	if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
	return response.data;
}

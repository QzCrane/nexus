// goal: typed client for background-owned registry and hotkey target state

import type {
	HotkeyTargetState,
	RegistryAddResult,
	RegistryQueryResult,
	RegistryRemoveResult,
	RegistrySnapshot,
} from '@nexus/contracts';
import { sendSpectraRequest } from './spectra-client';

export async function getRegistrySnapshot(): Promise<RegistrySnapshot> {
	const response = await sendSpectraRequest('spectra.registry.get', {});
	if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
	return response.data;
}

export async function addRegistryDomain(domain: string, restricted: boolean): Promise<RegistryAddResult> {
	const response = await sendSpectraRequest('spectra.registry.add', { domain, restricted });
	if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
	return response.data;
}

export async function removeRegistryDomain(domain: string): Promise<RegistryRemoveResult> {
	const response = await sendSpectraRequest('spectra.registry.remove', { domain });
	if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
	return response.data;
}

export async function queryRegistryDomain(domain: string): Promise<RegistryQueryResult> {
	const response = await sendSpectraRequest('spectra.registry.query', { domain });
	if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
	return response.data;
}

export async function markRegistryDomainProbed(
	domain: string,
	restricted: boolean,
): Promise<RegistryAddResult> {
	const response = await sendSpectraRequest('spectra.registry.mark-probed', { domain, restricted });
	if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
	return response.data;
}

export async function getHotkeyTarget(): Promise<HotkeyTargetState> {
	const response = await sendSpectraRequest('spectra.hotkey-target.get', {});
	if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
	return response.data;
}

export async function setHotkeyTarget(tabId: number | null): Promise<HotkeyTargetState> {
	const response = await sendSpectraRequest('spectra.hotkey-target.set', { tabId });
	if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
	return response.data;
}

// goal: persistence logic for per-domain audio settings using 'siteSettings' key

import { AudioConfig, DEFAULT_AUDIO_CONFIG } from '../messages/protocol.js';
import { normalizeHostname, resolveAudioVolume } from '@nexus/contracts';

const KEY = 'siteSettings';
type SiteSettingsMap = Record<string, AudioConfig>;

function canonicalizeAudioConfig(value: Partial<AudioConfig>): AudioConfig {
	const volume = resolveAudioVolume({
		volume: value.volume ?? DEFAULT_AUDIO_CONFIG.volume,
		volumeBase: value.volumeBase,
		boost: value.boost,
	});
	return {
		...DEFAULT_AUDIO_CONFIG,
		...value,
		volume: volume.effectiveVolume,
		volumeBase: volume.volumeBase,
		boost: volume.boost,
	};
}

// eff: retrieves config merged with defaults for the given domain
export async function getAudioConfig(domain: string): Promise<AudioConfig> {
	const normalizedDomain = normalizeHostname(domain);
	if (!normalizedDomain) return { ...DEFAULT_AUDIO_CONFIG };
	const result = await chrome.storage.local.get(KEY);
	const settings: SiteSettingsMap = result[KEY] || {};
	return settings[normalizedDomain]
		? canonicalizeAudioConfig(settings[normalizedDomain])
		: { ...DEFAULT_AUDIO_CONFIG };
}

// eff: partially update or create domain settings merged with defaults
export async function setAudioConfig(domain: string, config: Partial<AudioConfig>): Promise<void> {
	const normalizedDomain = normalizeHostname(domain);
	if (!normalizedDomain) throw new Error('Invalid audio settings hostname');
	const result = await chrome.storage.local.get(KEY);
	const settings: SiteSettingsMap = result[KEY] || {};
	settings[normalizedDomain] = canonicalizeAudioConfig({ ...settings[normalizedDomain], ...config });
	await chrome.storage.local.set({ [KEY]: settings });
}

export async function removeAudioConfig(domain: string): Promise<void> {
	const normalizedDomain = normalizeHostname(domain);
	if (!normalizedDomain) return;
	const result = await chrome.storage.local.get(KEY);
	const settings: SiteSettingsMap = result[KEY] || {};
	delete settings[normalizedDomain];
	await chrome.storage.local.set({ [KEY]: settings });
}

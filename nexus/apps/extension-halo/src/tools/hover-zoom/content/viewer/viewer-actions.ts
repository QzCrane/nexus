
import type { EnhancedResult } from '../resolvers/rule-resolver';

export function downloadMedia(source: EnhancedResult | null) {
	if (source) {
		// rule: swallow rejection — the background may not have a HALO_DOWNLOAD
		// handler (e.g. optional downloads permission not granted), in which case
		// chrome.runtime.sendMessage rejects. The user already clicked download,
		// so an unhandled rejection would surface as a confusing console error.
		chrome.runtime.sendMessage({ type: 'HALO_DOWNLOAD', url: source.url }).catch(() => {});
	}
}

export function copyUrl(source: EnhancedResult | null) {
	if (source) {
		navigator.clipboard.writeText(source.url);
	}
}

export function openInNewTab(source: EnhancedResult | null) {
	if (source) {
		window.open(source.url, '_blank');
	}
}

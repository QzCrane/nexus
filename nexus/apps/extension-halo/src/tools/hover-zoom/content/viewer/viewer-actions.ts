
import type { EnhancedResult } from '../resolvers/rule-resolver';

export function downloadMedia(source: EnhancedResult | null) {
	if (source) {
		chrome.runtime.sendMessage({ type: 'HALO_DOWNLOAD', url: source.url });
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

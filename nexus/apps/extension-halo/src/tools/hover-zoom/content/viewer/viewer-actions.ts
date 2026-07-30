
import type { EnhancedResult } from '../resolvers/rule-resolver';

export function downloadMedia(source: EnhancedResult | null) {
	if (source) {
		void chrome.runtime
			.sendMessage({ type: 'HALO_DOWNLOAD', url: source.url })
			.catch((error: unknown) => {
				console.warn('[HALO:HoverZoom] Download request failed', error);
			});
	}
}

export function copyUrl(source: EnhancedResult | null) {
	if (source) {
		void navigator.clipboard.writeText(source.url).catch((error: unknown) => {
			console.warn('[HALO:HoverZoom] Copy URL failed', error);
		});
	}
}

export function openInNewTab(source: EnhancedResult | null) {
	if (source) {
		window.open(source.url, '_blank');
	}
}

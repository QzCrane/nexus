// goal: Font Inspector core logic - extract font info from page

import type { FontInfo } from './types';

// Get fonts from current page
export async function getPageFonts(): Promise<FontInfo[]> {
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (!tab?.id) return [];

		const [result] = await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			func: () => {
				const fonts: Array<{ family: string; weight: string; size: string; lineHeight: string; color: string; element: string }> = [];
				const seen = new Set<string>();

				const elements = document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, a, span, div, li, button, input, label');
				for (const el of Array.from(elements).slice(0, 100)) {
					const style = window.getComputedStyle(el);
					const family = style.fontFamily.split(',')[0]!.replace(/["']/g, '').trim();
					const key = `${family}|${style.fontWeight}|${style.fontSize}`;

					if (!seen.has(key) && family) {
						seen.add(key);
						fonts.push({
							family,
							weight: style.fontWeight,
							size: style.fontSize,
							lineHeight: style.lineHeight,
							color: style.color,
							element: el.tagName.toLowerCase(),
						});
					}
				}

				return fonts;
			},
		});

		return result?.result || [];
	} catch {
		return [];
	}
}

// Group fonts by family
export function groupByFamily(fonts: FontInfo[]): Map<string, FontInfo[]> {
	const groups = new Map<string, FontInfo[]>();
	for (const font of fonts) {
		const existing = groups.get(font.family) || [];
		existing.push(font);
		groups.set(font.family, existing);
	}
	return groups;
}

// Get Google Fonts URL
export function getGoogleFontsUrl(family: string): string {
	return `https://fonts.google.com/specimen/${encodeURIComponent(family.replace(/\s+/g, '+'))}`;
}

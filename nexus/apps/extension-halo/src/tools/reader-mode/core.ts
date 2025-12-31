// goal: Reader Mode core logic - extract and display readable content

import type { ReaderConfig, ArticleContent } from './types';

// Extract article content from page (simplified readability algorithm)
export async function extractArticle(): Promise<ArticleContent | null> {
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (!tab?.id) return null;

		const [result] = await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			func: () => {
				// Find main content
				const selectors = ['article', '[role="main"]', 'main', '.post-content', '.article-content', '.entry-content', '#content'];
				let content: Element | null = null;

				for (const sel of selectors) {
					content = document.querySelector(sel);
					if (content) break;
				}

				if (!content) content = document.body;

				// Get title
				const title = document.querySelector('h1')?.textContent?.trim() ||
					document.title.split(/[|\-–]/)[0].trim();

				// Get site name
				const siteName = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') || 
					window.location.hostname;

				// Get byline
				const byline = document.querySelector('[rel="author"], .author, .byline')?.textContent?.trim() || '';

				// Clean content
				const clone = content.cloneNode(true) as Element;
				clone.querySelectorAll('script, style, nav, header, footer, aside, .ad, .advertisement, .social-share').forEach((el) => el.remove());

				return {
					title,
					content: clone.innerHTML,
					textContent: clone.textContent?.trim() || '',
					siteName,
					byline,
				};
			},
		});

		return result?.result || null;
	} catch {
		return null;
	}
}

// Default config
export const DEFAULT_CONFIG: ReaderConfig = {
	fontSize: 18,
	lineHeight: 1.8,
	maxWidth: 680,
	theme: 'dark',
	fontFamily: 'Georgia, serif',
};

// Theme styles
export const THEMES: Record<string, { bg: string; text: string; accent: string }> = {
	light: { bg: '#ffffff', text: '#1a1a1a', accent: '#6366f1' },
	sepia: { bg: '#f4ecd8', text: '#5b4636', accent: '#8b6914' },
	dark: { bg: '#1a1a1a', text: '#e0e0e0', accent: '#818cf8' },
};

// Font options
export const FONTS = [
	{ id: 'Georgia, serif', name: 'Georgia' },
	{ id: 'system-ui, sans-serif', name: 'System' },
	{ id: '"Merriweather", serif', name: 'Merriweather' },
	{ id: '"Open Sans", sans-serif', name: 'Open Sans' },
];

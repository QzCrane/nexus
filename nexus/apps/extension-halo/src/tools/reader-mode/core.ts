// goal: Reader Mode core logic - extract and display readable content

import type { ReaderConfig, ArticleContent } from './types';

// rule: panel.tsx renders article.content via dangerouslySetInnerHTML in the
// sidepanel context which has chrome.storage access, and additionally slices the
// content to 2000 chars — slicing can split a tag mid-attribute and reintroduce
// an unsafe fragment. Re-sanitize after slicing.
export function sanitizeHtml(html: string): string {
	return html
		.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
		.replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
		.replace(/\son\w+\s*=\s*'[^']*'/gi, '')
		.replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
		.replace(/javascript:/gi, '');
}

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
					document.title.split(/[|\-–]/)[0]?.trim() || '';

				// Get site name
				const siteName = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ||
					window.location.hostname;

				// Get byline
				const byline = document.querySelector('[rel="author"], .author, .byline')?.textContent?.trim() || '';

				// Clean content
				const clone = content.cloneNode(true) as Element;
				clone.querySelectorAll('script, style, nav, header, footer, aside, .ad, .advertisement, .social-share').forEach((el) => {
					el.remove();
				});

				// rule: sanitize before returning innerHTML — page DOM is attacker-controlled
				// and panel.tsx renders via dangerouslySetInnerHTML in the sidepanel context
				// which has chrome.storage access. Inline <script>/on*/javascript: URLs would
				// otherwise execute in the extension privileged context (XSS → RCE-equivalent).
				clone.querySelectorAll('script, iframe, object, embed, link, meta, base, form, svg, math').forEach((el) => {
					el.remove();
				});
				clone.querySelectorAll('*').forEach((el) => {
					for (const attr of Array.from(el.attributes)) {
						const name = attr.name.toLowerCase();
						if (name.startsWith('on') || name === 'style') {
							el.removeAttribute(attr.name);
							continue;
						}
						if (name === 'href' || name === 'src' || name === 'xlink:href' || name === 'formaction' || name === 'poster') {
							const val = attr.value.trim().toLowerCase();
							if (val.startsWith('javascript:') || val.startsWith('vbscript:') || val.startsWith('data:text/html') || val.startsWith('data:application/')) {
								el.removeAttribute(attr.name);
							}
						}
					}
				});

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
export const THEMES: Record<ReaderConfig['theme'], { bg: string; text: string; accent: string }> = {
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

// goal: Tech Stack core logic - detect website technologies

import type { TechDetection, TechCategory } from './types';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';

const TECH_CATEGORIES = new Set<TechCategory>(['framework', 'library', 'cms', 'analytics', 'cdn', 'server', 'language', 'other']);
export const techDetectionCodec: ToolStateCodec<TechDetection[]> = {
	decode(value) {
		if (!Array.isArray(value) || value.length > 256) return { kind: 'invalid', reason: 'Stored technology scan row count is invalid.' };
		const techs: TechDetection[] = [];
		for (const item of value) {
			if (typeof item !== 'object' || item === null || Array.isArray(item)) return { kind: 'invalid', reason: 'Stored technology scan contains a non-record row.' };
			const row = item as Record<string, unknown>;
			if (typeof row.name !== 'string' || row.name.length > 256 || typeof row.category !== 'string' || !TECH_CATEGORIES.has(row.category as TechCategory)
				|| typeof row.confidence !== 'number' || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1
				|| (row.version !== undefined && (typeof row.version !== 'string' || row.version.length > 256))
				|| (row.icon !== undefined && (typeof row.icon !== 'string' || row.icon.length > 64))) return { kind: 'invalid', reason: 'Stored technology scan has invalid fields.' };
			techs.push(row as unknown as TechDetection);
		}
		return { kind: 'valid', value: techs };
	},
	encode: (value) => value,
};

// Detection rules
const DETECTIONS: Array<{
	name: string;
	category: TechCategory;
	icon: string;
	patterns: Array<{ type: 'global' | 'script' | 'meta' | 'header'; pattern: string | RegExp }>;
}> = [
		// Frameworks
		{
			name: 'React', category: 'framework', icon: '⚛️', patterns: [
				{ type: 'global', pattern: '__REACT_DEVTOOLS_GLOBAL_HOOK__' },
				{ type: 'global', pattern: '_reactRootContainer' },
				{ type: 'script', pattern: /react(-dom)?\..*\.js/i },
			]
		},
		{
			name: 'Vue.js', category: 'framework', icon: '💚', patterns: [
				{ type: 'global', pattern: '__VUE__' },
				{ type: 'global', pattern: '__VUE_DEVTOOLS_GLOBAL_HOOK__' },
				{ type: 'script', pattern: /vue\..*\.js/i },
			]
		},
		{
			name: 'Angular', category: 'framework', icon: '🅰️', patterns: [
				{ type: 'global', pattern: 'ng' },
				{ type: 'script', pattern: /angular.*\.js/i },
			]
		},
		{
			name: 'Next.js', category: 'framework', icon: '▲', patterns: [
				{ type: 'global', pattern: '__NEXT_DATA__' },
				{ type: 'meta', pattern: 'next-head-count' },
			]
		},
		{
			name: 'Nuxt.js', category: 'framework', icon: '💚', patterns: [
				{ type: 'global', pattern: '__NUXT__' },
			]
		},
		{
			name: 'Svelte', category: 'framework', icon: '🔶', patterns: [
				{ type: 'script', pattern: /svelte.*\.js/i },
			]
		},

		// Libraries
		{
			name: 'jQuery', category: 'library', icon: '📜', patterns: [
				{ type: 'global', pattern: 'jQuery' },
				{ type: 'script', pattern: /jquery.*\.js/i },
			]
		},
		{
			name: 'Lodash', category: 'library', icon: '🔧', patterns: [
				{ type: 'global', pattern: '_' },
				{ type: 'script', pattern: /lodash.*\.js/i },
			]
		},
		{
			name: 'Three.js', category: 'library', icon: '🎨', patterns: [
				{ type: 'global', pattern: 'THREE' },
			]
		},

		// CMS
		{
			name: 'WordPress', category: 'cms', icon: '📝', patterns: [
				{ type: 'meta', pattern: 'generator.*WordPress' },
				{ type: 'script', pattern: /wp-content|wp-includes/i },
			]
		},
		{
			name: 'Shopify', category: 'cms', icon: '🛒', patterns: [
				{ type: 'global', pattern: 'Shopify' },
				{ type: 'script', pattern: /cdn\.shopify\.com/i },
			]
		},

		// Analytics
		{
			name: 'Google Analytics', category: 'analytics', icon: '📊', patterns: [
				{ type: 'global', pattern: 'ga' },
				{ type: 'global', pattern: 'gtag' },
				{ type: 'script', pattern: /google-analytics\.com|googletagmanager\.com/i },
			]
		},
		{
			name: 'Hotjar', category: 'analytics', icon: '🔥', patterns: [
				{ type: 'global', pattern: 'hj' },
			]
		},

		// CDN
		{
			name: 'Cloudflare', category: 'cdn', icon: '☁️', patterns: [
				{ type: 'header', pattern: 'cf-ray' },
			]
		},

		// Server
		{
			name: 'nginx', category: 'server', icon: '🌐', patterns: [
				{ type: 'header', pattern: 'server.*nginx' },
			]
		},
		{
			name: 'Apache', category: 'server', icon: '🪶', patterns: [
				{ type: 'header', pattern: 'server.*Apache' },
			]
		},
	];

// Detect technologies from page
export async function detectTechStack(): Promise<TechDetection[]> {
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (!tab?.id) return [];

		const [result] = await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			func: () => {
				const detected: Array<{ name: string; type: string; value: string }> = [];

				// Check globals
				const globals = ['__REACT_DEVTOOLS_GLOBAL_HOOK__', '__VUE__', '__NEXT_DATA__', '__NUXT__',
					'jQuery', 'ng', 'THREE', 'Shopify', 'ga', 'gtag', 'hj', '_reactRootContainer',
					'__VUE_DEVTOOLS_GLOBAL_HOOK__'];
				for (const g of globals) {
					if ((window as unknown as Record<string, unknown>)[g]) {
						detected.push({ name: g, type: 'global', value: 'true' });
					}
				}

				// Check scripts
				const scripts = Array.from(document.querySelectorAll('script[src]'));
				for (const s of scripts) {
					detected.push({ name: 'script', type: 'script', value: (s as HTMLScriptElement).src });
				}

				// Check meta tags
				const metas = Array.from(document.querySelectorAll('meta'));
				for (const m of metas) {
					const name = m.getAttribute('name') || m.getAttribute('property') || '';
					const content = m.getAttribute('content') || '';
					if (name || content) {
						detected.push({ name, type: 'meta', value: content });
					}
				}

				return detected;
			},
		});

		const pageData = result?.result || [];
		const techs: TechDetection[] = [];

		for (const det of DETECTIONS) {
			let matched = false;
			for (const pattern of det.patterns) {
				if (pattern.type === 'global') {
					matched = pageData.some((d: { type: string; name: string }) => d.type === 'global' && d.name === pattern.pattern);
				} else if (pattern.type === 'script') {
					matched = pageData.some((d: { type: string; value: string }) =>
						d.type === 'script' && (typeof pattern.pattern === 'string' ? d.value.includes(pattern.pattern) : pattern.pattern.test(d.value)));
				} else if (pattern.type === 'meta') {
					matched = pageData.some((d: { type: string; name: string; value: string }) =>
						d.type === 'meta' && (typeof pattern.pattern === 'string' ? (d.name + d.value).includes(pattern.pattern) : pattern.pattern.test(d.name + d.value)));
				}
				if (matched) break;
			}

			if (matched) {
				techs.push({ name: det.name, category: det.category, confidence: 0.9, icon: det.icon });
			}
		}

		return techs;
	} catch {
		return [];
	}
}

// Category labels
export const CATEGORY_LABELS: Record<TechCategory, string> = {
	framework: '🏗️ Frameworks',
	library: '📚 Libraries',
	cms: '📝 CMS',
	analytics: '📊 Analytics',
	cdn: '☁️ CDN',
	server: '🖥️ Server',
	language: '💻 Language',
	other: '🔧 Other',
};

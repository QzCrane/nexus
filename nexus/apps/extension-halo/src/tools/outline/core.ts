// goal: Outline extraction logic

import type { HeadingItem, OutlineSettings } from './types';
import { STORAGE_KEY, DEFAULT_SETTINGS } from './types';

/**
 * Generate unique ID for heading
 */
function generateId(text: string, index: number): string {
	const slug = text
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 50);
	return `${slug || 'heading'}-${index}`;
}

interface RawHeading {
	level: number;
	text: string;
	index: number;
}

/**
 * Extract headings from page via content script
 */
export async function extractHeadings(
	settings: OutlineSettings = DEFAULT_SETTINGS
): Promise<HeadingItem[]> {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (!tab?.id) return [];

	const minLevel = settings.minLevel;
	const maxLevel = settings.maxLevel;

	try {
		const results = await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			func: () => {
				// inv: access minLevel/maxLevel from closure not possible, use all h1-h6
				const elements = document.querySelectorAll('h1,h2,h3,h4,h5,h6');
				return Array.from(elements).map((el, i) => ({
					level: parseInt(el.tagName.slice(1), 10),
					text: (el.textContent || '').trim().slice(0, 200),
					index: i,
				}));
			},
		});

		const rawHeadings: RawHeading[] = results[0]?.result || [];
		// Filter by level client-side
		return rawHeadings
			.filter(h => h.level >= minLevel && h.level <= maxLevel)
			.map((h, i) => ({
				id: generateId(h.text, i),
				level: h.level,
				text: h.text,
			}));
	} catch (e) {
		console.error('Failed to extract headings:', e);
		return [];
	}
}

/**
 * Scroll to heading on page
 */
export async function scrollToHeading(index: number): Promise<void> {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (!tab?.id) return;

	// Send message to content script instead of executeScript with args
	await chrome.tabs.sendMessage(tab.id, {
		type: 'HALO_SCROLL_TO_HEADING',
		index,
	});
}

/**
 * Copy outline as markdown
 */
export function outlineToMarkdown(headings: HeadingItem[], showNumbers: boolean): string {
	const counters = [0, 0, 0, 0, 0, 0];

	return headings.map((h) => {
		const level = Math.min(6, Math.max(1, Math.trunc(h.level)));
		const indent = '  '.repeat(level - 1);
		let prefix = '-';

		if (showNumbers) {
			const counterIndex = level - 1;
			counters[counterIndex] = (counters[counterIndex] ?? 0) + 1;
			// Reset lower level counters
			for (let i = level; i < 6; i++) {
				counters[i] = 0;
			}
			prefix = `${counters.slice(0, level).filter(n => n > 0).join('.')}.`;
		}

		return `${indent}${prefix} ${h.text}`;
	}).join('\n');
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}

/**
 * Load settings from storage
 */
export async function loadSettings(): Promise<OutlineSettings> {
	const result = await chrome.storage.local.get([STORAGE_KEY]);
	return { ...DEFAULT_SETTINGS, ...result[STORAGE_KEY] };
}

/**
 * Save settings to storage
 */
export async function saveSettings(settings: Partial<OutlineSettings>): Promise<OutlineSettings> {
	const current = await loadSettings();
	const updated = { ...current, ...settings };
	await chrome.storage.local.set({ [STORAGE_KEY]: updated });
	return updated;
}

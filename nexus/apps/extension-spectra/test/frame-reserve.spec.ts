// goal: pin theme/surface prepaint and reject every historical height hint
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { injectFrameHeightKey } from '../scripts/frame-reserve-key';
import { THEME_MODE_KEY } from '../src/shared/popup-bootstrap';

const shippedHeadScript = injectFrameHeightKey(
	readFileSync(resolve(import.meta.dir, '../public/frame-reserve.js'), 'utf8'),
);

interface HeadScriptRun {
	attributes: Map<string, string>;
	height: string;
	overflowY: string;
	reads: string[];
}

function runHeadScript(options: {
	stored?: Record<string, string>;
	systemDark?: boolean;
	search?: string;
	isActionPopup?: boolean;
} = {}): HeadScriptRun {
	const attributes = new Map<string, string>();
	const reads: string[] = [];
	const style = { height: '', overflowY: '' };
	const html = {
		style,
		setAttribute(name: string, value: string) { attributes.set(name, value); },
	};
	const window = {
		localStorage: {
			getItem(key: string): string | null {
				reads.push(key);
				return options.stored?.[key] ?? null;
			},
		},
		matchMedia: () => ({ matches: options.systemDark === true }),
		location: { search: options.search ?? '' },
	};
	const chrome = {
		extension: {
			getViews: () => (options.isActionPopup === false ? [] : [window]),
		},
	};
	// The shipped script is an IIFE over exactly these names.
	const invoke = new Function('window', 'document', 'chrome', shippedHeadScript) as (
		windowLike: unknown,
		documentLike: unknown,
		chromeLike: unknown,
	) => void;
	invoke(window, { documentElement: html }, chrome);
	return { attributes, height: style.height, overflowY: style.overflowY, reads };
}

describe('popup theme before the first paint', () => {
	test('paints the committed mode, not the system one', () => {
		const light = runHeadScript({ stored: { [THEME_MODE_KEY]: 'light' }, systemDark: true });
		expect(light.attributes.get('data-theme')).toBe('light');
		const dark = runHeadScript({ stored: { [THEME_MODE_KEY]: 'dark' }, systemDark: false });
		expect(dark.attributes.get('data-theme')).toBe('dark');
	});

	test('resolves `system` from the media query, because that is what it means', () => {
		// The stored mode is `system`; the OS can have changed since it was stored,
		// so the answer has to come from the query, not from the stored value.
		expect(runHeadScript({ stored: { [THEME_MODE_KEY]: 'system' }, systemDark: true })
			.attributes.get('data-theme')).toBe('dark');
		expect(runHeadScript({ stored: { [THEME_MODE_KEY]: 'system' }, systemDark: false })
			.attributes.get('data-theme')).toBe('light');
	});

	test('defaults to the system theme when nothing was ever committed', () => {
		expect(runHeadScript({ systemDark: true }).attributes.get('data-theme')).toBe('dark');
		expect(runHeadScript({ systemDark: false }).attributes.get('data-theme')).toBe('light');
	});
});

describe('popup frame before the first paint', () => {
	test.each(['?cards=1&main=1&lang=zh-CN&viz=0', '?cards=1&main=1&lang=zh-CN&viz=1', '?cards=3', '', '?cards=lots'])
	('never reserves an old 600px frame for intrinsic content (%s)', (search) => {
		const run = runHeadScript({ search, stored: {
			'spectra.popup.frame.1': '600', 'spectra.popup.frame.3': '600',
			'spectra.popup.frame.last': '600', 'spectra.popup.frameHeight': '600',
		} });
		expect(run.height).toBe('');
		expect(run.overflowY).toBe('');
		expect(run.attributes.has('data-spectra-frame-reserved')).toBe(false);
		expect(run.attributes.has('data-spectra-frame-source')).toBe(false);
		expect(run.reads).toEqual([THEME_MODE_KEY]);
	});
});

describe('popup surface before the first paint', () => {
	test('marks the Action Popup so the tab-hosted reflow rules stay out of it', () => {
		expect(runHeadScript().attributes.get('data-spectra-surface')).toBe('action-popup');
	});

	test('leaves a tab-hosted page to reflow', () => {
		const run = runHeadScript({ isActionPopup: false });
		expect(run.attributes.has('data-spectra-surface')).toBe(false);
	});
});

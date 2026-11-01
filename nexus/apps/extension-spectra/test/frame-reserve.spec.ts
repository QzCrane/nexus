// goal: pin the only two decisions that happen before the Popup can paint
//
// The theme and the frame have to be right in the *first* frame, so they cannot
// be tested through the Popup module - that module runs after the paint. These
// cases execute the shipped head script itself against a stub document, which is
// the same code Chrome runs before it shows the window.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { injectFrameHeightKey } from '../scripts/frame-reserve-key';
import {
	FRAME_HEIGHT_KEY,
	FRAME_HEIGHT_KEY_LAST,
	FRAME_MAX_HEIGHT_PX,
	THEME_MODE_KEY,
	frameHeightKeyForCards,
} from '../src/shared/popup-bootstrap';

const shippedHeadScript = injectFrameHeightKey(
	readFileSync(resolve(import.meta.dir, '../public/frame-reserve.js'), 'utf8'),
);

interface HeadScriptRun {
	attributes: Map<string, string>;
	height: string;
	overflowY: string;
}

function runHeadScript(options: {
	stored?: Record<string, string>;
	systemDark?: boolean;
	search?: string;
	isActionPopup?: boolean;
} = {}): HeadScriptRun {
	const attributes = new Map<string, string>();
	const style = { height: '', overflowY: '' };
	const html = {
		style,
		setAttribute(name: string, value: string) { attributes.set(name, value); },
	};
	const window = {
		localStorage: {
			getItem(key: string): string | null {
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
	return { attributes, height: style.height, overflowY: style.overflowY };
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
	test('sizes the window from the entry for the announced count', () => {
		const run = runHeadScript({
			search: '?cards=2',
			stored: {
				[frameHeightKeyForCards(2)]: '431',
				[FRAME_HEIGHT_KEY_LAST]: '298',
				[FRAME_HEIGHT_KEY]: '298',
			},
		});
		expect(run.height).toBe('431px');
		expect(run.overflowY).toBe('hidden');
		expect(run.attributes.get('data-spectra-frame-reserved')).toBe('431');
		// The shape's own entry answered - not the most recent open's height.
		expect(run.attributes.get('data-spectra-frame-source')).toBe(frameHeightKeyForCards(2));
	});

	test('falls back to the last settled height when this shape was never measured', () => {
		const run = runHeadScript({
			search: '?cards=3',
			stored: { [FRAME_HEIGHT_KEY_LAST]: '298' },
		});
		expect(run.height).toBe('298px');
		expect(run.attributes.get('data-spectra-frame-source')).toBe(FRAME_HEIGHT_KEY_LAST);
	});

	test('falls back to the single hint an older build wrote', () => {
		const run = runHeadScript({ stored: { [FRAME_HEIGHT_KEY]: '312' } });
		expect(run.height).toBe('312px');
		expect(run.attributes.get('data-spectra-frame-source')).toBe(FRAME_HEIGHT_KEY);
	});

	test('reserves nothing at all when no open ever recorded a height', () => {
		// The one open that is allowed to grow: there is no fact to reserve from,
		// and inventing one would open the window at a size nothing asked for.
		const run = runHeadScript();
		expect(run.height).toBe('');
		expect(run.overflowY).toBe('');
		expect(run.attributes.has('data-spectra-frame-reserved')).toBe(false);
	});

	test('never reserves past the height Chrome grants a Popup', () => {
		const run = runHeadScript({
			search: '?cards=9',
			stored: { [frameHeightKeyForCards(9)]: '1200' },
		});
		expect(run.height).toBe(`${FRAME_MAX_HEIGHT_PX}px`);
	});

	test('ignores a count that is not a count', () => {
		const run = runHeadScript({
			search: '?cards=lots',
			stored: { [FRAME_HEIGHT_KEY_LAST]: '298', [FRAME_HEIGHT_KEY]: '298' },
		});
		expect(run.height).toBe('298px');
		expect(run.attributes.get('data-spectra-frame-source')).toBe(FRAME_HEIGHT_KEY_LAST);
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

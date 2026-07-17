import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { formatKeyCombo, parseParams } from '../src/options/formatters';
import { EDITABLE_HOTKEY_ACTIONS, LEGACY_UNSUPPORTED_ACTIONS } from '../src/options/supported-hotkey-actions';
import {
	getActionName as getLoadedActionName,
	getOptionsDictionary,
	getPopupDictionary,
	loadLocaleCatalog,
	SUPPORTED_SPECTRA_LANGUAGES,
} from '../src/shared/i18n/catalog';
import { createLocaleAssetCatalogs, createLocaleCatalogs } from '../scripts/i18n-assets';
import { getContentOSDMessages } from '../src/shared/i18n/content-osd';
import { resolveRegistryNavigationKey } from '../src/popup/views/registry-ui';

describe('hotkey editor contract', () => {
	test('only exposes actions with runtime handlers', () => {
		expect(EDITABLE_HOTKEY_ACTIONS.has('gain_up')).toBe(true);
		expect(EDITABLE_HOTKEY_ACTIONS.has('ab_skip')).toBe(true);
		expect(EDITABLE_HOTKEY_ACTIONS.has('fx_toggle')).toBe(true);
		expect(EDITABLE_HOTKEY_ACTIONS.has('open_popup')).toBe(true);
		expect(EDITABLE_HOTKEY_ACTIONS.has('pitch_up')).toBe(false);
		expect(LEGACY_UNSUPPORTED_ACTIONS.has('pitch_reset')).toBe(true);
	});

	test('rejects unsafe URL protocols and out-of-range values', () => {
		expect(parseParams('open_url', 'javascript:alert(1)')).toBeUndefined();
		expect(parseParams('open_url', 'https://example.com/a')).toEqual({ url: 'https://example.com/a' });
		expect(parseParams('speed_set', '17')).toBeUndefined();
		expect(parseParams('volume_set', '-1')).toBeUndefined();
		expect(parseParams('volume_set', '0')).toEqual({ volume: 0 });
		expect(parseParams('volume_set', '800')).toEqual({ volume: 800 });
		expect(parseParams('volume_set', '801')).toBeUndefined();
	});

	test('formats physical key codes accessibly', () => {
		expect(formatKeyCombo({
			code: 'KeyK',
			modifiers: { ctrl: true, alt: false, shift: true, meta: false },
		})).toBe('Ctrl + Shift + K');
	});
});

describe('options translations', () => {
	test('every supported locale resolves the complete shared schema', () => {
		const catalogs = createLocaleCatalogs();
		const english = catalogs['en-US'];
		if (!english) throw new Error('English locale catalog is missing');
		const popupKeys = Object.keys(english.popup).sort();
		const optionsKeys = Object.keys(english.options).sort();
		const actionKeys = Object.keys(english.actions).sort();
		for (const locale of SUPPORTED_SPECTRA_LANGUAGES) {
			const dictionary = catalogs[locale];
			if (!dictionary) throw new Error(`${locale} locale catalog is missing`);
			expect(Object.keys(dictionary.popup).sort(), `${locale} popup`).toEqual(popupKeys);
			expect(Object.keys(dictionary.options).sort(), `${locale} options`).toEqual(optionsKeys);
			expect(Object.keys(dictionary.actions).sort(), `${locale} actions`).toEqual(actionKeys);
		}
	});

	test('every non-English locale contributes translations and Traditional Chinese is independent', () => {
		const catalogs = createLocaleCatalogs();
		const english = catalogs['en-US'];
		if (!english) throw new Error('English locale catalog is missing');
		for (const locale of SUPPORTED_SPECTRA_LANGUAGES.filter((language) => language !== 'en-US')) {
			const dictionary = catalogs[locale];
			if (!dictionary) throw new Error(`${locale} locale catalog is missing`);
			for (const section of ['popup', 'options', 'actions'] as const) {
				const translated = Object.keys(english[section]).some(
					(key) => dictionary[section][key] !== english[section][key],
				);
				expect(translated, `${locale} ${section} must not be an all-English fallback`).toBe(true);
			}
		}
		expect(catalogs['zh-TW']).not.toEqual(catalogs['zh-CN']);
		expect(catalogs['zh-TW']?.popup.settingsTitle).toBe('設定');
		expect(catalogs['zh-TW']?.options.modal_save).toBe('儲存');
	});

	test('stores non-English locale assets as lossless English deltas', () => {
		const catalogs = createLocaleCatalogs();
		const assets = createLocaleAssetCatalogs();
		const english = catalogs['en-US'];
		if (!english) throw new Error('English locale catalog is missing');
		expect(assets['en-US']).toEqual(english);
		for (const locale of SUPPORTED_SPECTRA_LANGUAGES.filter((language) => language !== 'en-US')) {
			const asset = assets[locale];
			const complete = catalogs[locale];
			if (!asset || !complete) throw new Error(`${locale} locale catalog is missing`);
			for (const section of ['popup', 'options', 'actions'] as const) {
				const keys = Object.keys(english[section]);
				const encoded = asset[section];
				const delta = Array.isArray(encoded)
					? Object.fromEntries(keys.map((key, index) => [key, encoded[index]]))
					: Object.fromEntries(Object.entries(encoded).map(([index, value]) => [
						keys[Number(index)],
						value,
					]));
				expect({ ...english[section], ...delta }, `${locale} ${section}`).toEqual(
					complete[section],
				);
			}
		}
		expect(Array.isArray(assets['zh-CN']?.popup)).toBe(true);
		expect(Array.isArray(assets['ja-JP']?.options)).toBe(false);
	});

	test('keeps the requested locale readable when its asset falls back to English', async () => {
		const assets = createLocaleAssetCatalogs();
		const english = createLocaleCatalogs()['en-US'];
		const englishAsset = assets['en-US'];
		if (!english || !englishAsset) throw new Error('English locale catalog is missing');
		const originalChrome = globalThis.chrome;
		const originalFetch = globalThis.fetch;
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: { runtime: { getURL: (path: string) => `https://spectra.invalid/${path}` } },
		});
		globalThis.fetch = (async (input: string | URL | Request) => (
			String(input).endsWith('/en-US.json.gz')
				? new Response(gzipSync(JSON.stringify(englishAsset), { level: 9, mtime: 0 }))
				: new Response('Not found', { status: 404 })
		)) as typeof fetch;
		try {
			await loadLocaleCatalog('fr-FR');
			expect(getPopupDictionary('fr-FR').settingsTitle).toBe(english.popup.settingsTitle);
			expect(getOptionsDictionary('fr-FR').modal_save).toBe(english.options.modal_save);
			expect(getLoadedActionName('gain_up', 'fr-FR')).toBe(english.actions.gain_up);
		} finally {
			globalThis.fetch = originalFetch;
			if (originalChrome === undefined) Reflect.deleteProperty(globalThis, 'chrome');
			else {
				Object.defineProperty(globalThis, 'chrome', {
					configurable: true,
					value: originalChrome,
				});
			}
		}
	});

	test('validates, expands, and hydrates generated locale assets at runtime', async () => {
		const assets = createLocaleAssetCatalogs();
		const complete = createLocaleCatalogs();
		const originalChrome = globalThis.chrome;
		const originalFetch = globalThis.fetch;
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: { runtime: { getURL: (path: string) => `https://spectra.invalid/${path}` } },
		});
		globalThis.fetch = (async (input: string | URL | Request) => {
			const language = /\/([^/]+)\.json\.gz$/u.exec(String(input))?.[1];
			const asset = language ? assets[language] : undefined;
			return asset
				? new Response(gzipSync(JSON.stringify(asset), { level: 9, mtime: 0 }))
				: new Response('Not found', { status: 404 });
		}) as typeof fetch;
		try {
			for (const locale of SUPPORTED_SPECTRA_LANGUAGES) {
				await loadLocaleCatalog(locale);
				expect(getPopupDictionary(locale).settingsTitle, `${locale} popup`).toBe(
					complete[locale]?.popup.settingsTitle,
				);
				expect(getOptionsDictionary(locale).modal_save, `${locale} options`).toBe(
					complete[locale]?.options.modal_save,
				);
				expect(getLoadedActionName('gain_up', locale), `${locale} actions`).toBe(
					complete[locale]?.actions.gain_up,
				);
			}
		} finally {
			globalThis.fetch = originalFetch;
			if (originalChrome === undefined) Reflect.deleteProperty(globalThis, 'chrome');
			else {
				Object.defineProperty(globalThis, 'chrome', {
					configurable: true,
					value: originalChrome,
				});
			}
		}
	});

	test('resolves only the current Content OSD strings with an English fallback', () => {
		for (const locale of SUPPORTED_SPECTRA_LANGUAGES) {
			expect(getContentOSDMessages(locale).muted.length, locale).toBeGreaterThan(0);
		}
		expect(getContentOSDMessages('unsupported')).toMatchObject({ muted: 'MUTE' });
		expect(getContentOSDMessages('zh-CN')).toMatchObject({ muted: '静音' });
		expect(getContentOSDMessages('zh-TW').corsAutoAdded).toContain('已自動新增');
	});

	test('keeps locale tables out of the content bundle and sends only current strings', () => {
		const settingsManager = readFileSync(resolve(import.meta.dir, '../src/content/core/settings-manager.ts'), 'utf8');
		expect(settingsManager).toContain('spectra.content.settings.get');
		expect(settingsManager).toContain('osdMessages');
		expect(settingsManager).toContain("import type { ContentOSDMessages } from '../../shared/i18n/content-osd'");
		expect(settingsManager).not.toContain('getContentOSDMessages');
		expect(settingsManager).not.toContain('constants/i18n');
	});

	test('offers every supported locale in both extension UIs', () => {
		for (const [file, selectId] of [
			['../public/popup.html', 'set-lang'],
			['../public/options.html', 'lang-select'],
		] as const) {
			const html = readFileSync(resolve(import.meta.dir, file), 'utf8');
			const select = new RegExp(`<select[^>]+id=["']${selectId}["'][^>]*>([\\s\\S]*?)<\\/select>`, 'u').exec(html)?.[1];
			expect(select, file).toBeDefined();
			const values = [...(select ?? '').matchAll(/<option\s+value=["']([^"']+)["']/gu)]
				.map((match) => match[1]);
			expect(values, file).toEqual([...SUPPORTED_SPECTRA_LANGUAGES]);
		}
	});

	test('updates the document language when either extension UI changes locale', () => {
		for (const file of ['../src/options/i18n.ts', '../src/popup/views/i18n-apply.ts']) {
			const source = readFileSync(resolve(import.meta.dir, file), 'utf8');
			expect(source, file).toContain('document.documentElement.lang =');
		}
	});

	test('implements keyboard navigation for registry tabs', () => {
		expect(resolveRegistryNavigationKey('restricted', 'ArrowRight')).toBe('safe');
		expect(resolveRegistryNavigationKey('safe', 'ArrowLeft')).toBe('restricted');
		expect(resolveRegistryNavigationKey('safe', 'Home')).toBe('restricted');
		expect(resolveRegistryNavigationKey('restricted', 'End')).toBe('safe');
		expect(resolveRegistryNavigationKey('restricted', 'Enter')).toBeNull();
	});
});

describe('extension-page DOM and idle contracts', () => {
	test('keeps the one-release theme adapter read-only and background-owned', () => {
		const theme = readFileSync(resolve(import.meta.dir, '../src/options/theme.ts'), 'utf8');
		expect(theme).toContain("scope: 'legacy-theme'");
		expect(theme).toContain('readLegacyThemeCandidateForOneRelease');
		expect(theme).not.toContain('chrome.storage');
		expect(theme).not.toContain('spectraSettingsMeta');
		expect(theme).not.toContain('localStorage.setItem');
		expect(theme).not.toContain('spectra-theme-v2-migrated');
	});

	test('exposes stateful controls and registry tabs to assistive technology', () => {
		const popup = readFileSync(resolve(import.meta.dir, '../public/popup.html'), 'utf8');
		expect(popup).toContain('role="tablist"');
		expect(popup).toContain('role="tabpanel"');
		expect(popup).toContain('aria-selected="true"');
		expect(popup).toContain('aria-pressed="false"');

		for (const path of [
			'../src/popup/card/media-events.ts',
			'../src/popup/card/render.ts',
			'../src/popup/side-panel/index.ts',
			'../src/popup/side-panel/video-controls.ts',
			'../src/popup/views/registry-ui.ts',
		]) {
			const source = readFileSync(resolve(import.meta.dir, path), 'utf8');
			expect(source, path).toMatch(/aria-(?:pressed|selected)/u);
		}
	});

	test('uses one focus-trap contract for preset and remote dialogs with live status', () => {
		const preset = readFileSync(resolve(import.meta.dir, '../src/popup/views/presets-ui.ts'), 'utf8');
		const remote = readFileSync(resolve(import.meta.dir, '../src/remote/modal-renderer.ts'), 'utf8');
		const options = readFileSync(resolve(import.meta.dir, '../src/options/modal.ts'), 'utf8');
		for (const [path, source] of [['preset', preset], ['remote', remote]] as const) {
			expect(source, path).toContain('handleDialogKeydown');
			expect(source, path).toContain("setAttribute('role', 'dialog')");
			expect(source, path).toContain("setAttribute('aria-modal', 'true')");
		}
		expect(preset).toContain("setAttribute('role', 'status')");
		expect(remote).toContain("setAttribute('role', 'status')");
		expect(preset).toContain('previouslyFocused?.focus()');
		expect(options).toContain("event.key === 'Escape'");
		expect(options).toContain("event.key !== 'Tab'");
		expect(options).toContain('restoreFocus?.focus()');
	});

	test('defines every CSS variable, keeps keyframes unique, and removes capture prediction', () => {
		for (const file of ['../public/popup.css', '../public/options.css']) {
			const css = readFileSync(resolve(import.meta.dir, file), 'utf8');
			const definitions = new Set([...css.matchAll(/--([A-Za-z0-9_-]+)\s*:/gu)].map((match) => match[1]));
			const uses = [...css.matchAll(/var\(--([A-Za-z0-9_-]+)/gu)].map((match) => match[1]);
			expect(uses.filter((name) => !definitions.has(name)), file).toEqual([]);
			const keyframes = [...css.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/gu)].map((match) => match[1]);
			expect(new Set(keyframes).size, file).toBe(keyframes.length);
		}
		const visualizer = readFileSync(resolve(import.meta.dir, '../src/popup/visualizer/loop.ts'), 'utf8');
		expect(visualizer).not.toMatch(/predictedCapture|CAPTURE_INIT_DELAY/iu);
	});

	test('gives every popup range control an accessible name', () => {
		const html = readFileSync(resolve(import.meta.dir, '../public/popup.html'), 'utf8');
		const rangeInputs = html.match(/<input\b(?=[^>]*\btype=["']range["'])[^>]*>/giu) ?? [];
		expect(rangeInputs.length).toBeGreaterThan(0);
		for (const input of rangeInputs) {
			expect(input).toMatch(/\baria-(?:label|labelledby)=["'][^"']+["']/iu);
		}
	});

	test('renders dynamic UI without HTML string sinks', () => {
		const files = [
			'../src/popup/views/i18n-apply.ts',
			'../src/popup/views/registry-ui.ts',
			'../src/popup/views/presets-ui.ts',
			'../src/popup/card/media-events.ts',
			'../src/popup/card/render.ts',
			'../src/options/site-editor.ts',
			'../src/options/slots-editor.ts',
			'../src/remote/modal-renderer.ts',
		];
		for (const file of files) {
			const source = readFileSync(resolve(import.meta.dir, file), 'utf8');
			expect(source, file).not.toMatch(/\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML/iu);
		}
	});

	test('uses one-shot site-native execution and no recurring remote UI polling', () => {
		const siteNative = readFileSync(resolve(import.meta.dir, '../src/background/main-runtime-manager.ts'), 'utf8');
		const remoteBindings = readFileSync(resolve(import.meta.dir, '../src/remote/ui-bindings.ts'), 'utf8');
		const remoteModal = readFileSync(resolve(import.meta.dir, '../src/remote/modal-renderer.ts'), 'utf8');
		expect(siteNative).toContain("world: 'MAIN'");
		expect(siteNative).not.toContain('addEventListener(');
		expect(`${siteNative}\n${remoteBindings}\n${remoteModal}`).not.toContain('setInterval(');
		expect(remoteBindings).toContain('spectra.remote.session.changed');
		expect(remoteModal).toContain('spectra.remote.session.closed');
	});

	test('keeps video-only Popup acknowledgements independent from active media', () => {
		const mediaControls = readFileSync(resolve(import.meta.dir, '../src/popup/card/media-events.ts'), 'utf8');
		const videoControls = readFileSync(resolve(import.meta.dir, '../src/popup/side-panel/video-controls.ts'), 'utf8');
		expect(mediaControls).toContain("mutation.field === 'pip'");
		expect(mediaControls).toContain('state.controlSnapshot?.activeVideo ?? null');
		expect(videoControls).toContain('activeMedia: currentSnapshot.activeMedia');
		expect(videoControls).not.toContain('activeMedia: ack.target ?? currentSnapshot.activeMedia');
	});
});

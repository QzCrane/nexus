import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { formatKeyCombo, parseParams } from '../src/options/formatters';
import { EDITABLE_HOTKEY_ACTIONS, LEGACY_UNSUPPORTED_ACTIONS } from '../src/options/supported-hotkey-actions';
import {
	clearLocaleCatalogCache,
	getActionName as getLoadedActionName,
	getOptionsDictionary,
	getPopupDictionary,
	SUPPORTED_SPECTRA_LANGUAGES,
} from '../src/shared/i18n/catalog';
import { loadOptionsLocaleCatalog } from '../src/shared/i18n/options-catalog';
import { loadPopupLocaleCatalog } from '../src/shared/i18n/popup-catalog';
import {
	createLocaleAssetCatalogs,
	createLocaleCatalogs,
	createLocaleSurfaceAssetCatalogs,
} from '../scripts/i18n-assets';
import { getContentOSDMessages } from '../src/shared/i18n/content-osd';
import { withAlpha } from '../src/popup/visualizer/draw-eq-curve';
import { CONTROL_VALUE_LIMITS } from '@nexus/contracts';

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
		expect(parseParams('volume_set', '')).toBeUndefined();
		expect(parseParams('volume_set', '   ')).toBeUndefined();
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

	test('rejects built-in chords through the shared contract and revives reassigned bindings', () => {
		const modal = readFileSync(resolve(import.meta.dir, '../src/options/modal.ts'), 'utf8');
		const siteEditor = readFileSync(resolve(import.meta.dir, '../src/options/site-editor.ts'), 'utf8');
		const optionsHtml = readFileSync(resolve(import.meta.dir, '../public/options.html'), 'utf8');
		const contentFacade = readFileSync(
			resolve(import.meta.dir, '../../../packages/contracts/src/spectra.content-runtime.ts'),
			'utf8',
		);

		expect(modal).toContain('isSpectraDefaultHotkeyKeyCombo');
		expect(modal).toMatch(
			/function handleKeyRecord[\s\S]*renderReservedHotkeyWarning\(\);[\s\S]*updateSaveAvailability\(\);/u,
		);
		expect(modal).toContain('if (renderReservedHotkeyWarning()) return;');
		expect(modal).toContain("t('modal_reserved_default_hotkey')");
		expect(modal).toContain('currentBinding.enabled = true;');
		expect(modal).toContain('delete currentBinding.disabledReason;');
		expect(optionsHtml).toContain('id="reserved-hotkey-warning"');
		expect(optionsHtml).toContain('role="alert"');
		expect(siteEditor).toContain("t('legacy_disabled_one')");
		expect(siteEditor).toContain("tf('legacy_disabled_many'");
		expect(siteEditor).not.toContain('legacy_pitch_');
		expect(contentFacade).toContain('isSpectraDefaultHotkeyKeyCombo');
	});

	test('derives Chrome command rows from the manifest-backed browser registry', () => {
		const source = readFileSync(
			resolve(import.meta.dir, '../src/options/slots-editor.ts'),
			'utf8',
		);
		expect(source).toContain('chrome.runtime.getManifest().commands');
		expect(source).not.toContain('await chrome.commands.getAll()');
		expect(source).toContain("names.filter((name) => !name.startsWith('slot_'))");
		expect(source).toContain("names.filter((name) => name.startsWith('slot_'))");
		expect(source).not.toContain('PRESET_COMMANDS');
		expect(source).not.toContain('SLOT_COMMANDS');
	});

	test('isolates mutable slot edits from the shared settings snapshot cache', () => {
		const source = readFileSync(
			resolve(import.meta.dir, '../src/options/slots-editor.ts'),
			'utf8',
		);
		expect(source).toContain('disabledLegacyBindings: [...(source.disabledLegacyBindings ?? [])]');
		expect(source.match(/settings = cloneHotkeySettings\(snapshot\.hotkeySettings\);/gu))
			.toHaveLength(1);
		expect(source).toContain('for (const [command, pending] of pendingSlotMutations.entries())');
		expect(source).toContain('settings.slots[command] = pending.value;');
		expect(source).not.toContain('settings = snapshot.hotkeySettings;');
	});
});

describe('popup visualizer color contract', () => {
	test('applies alpha to canonical hex and rgb theme colors', () => {
		expect(withAlpha('#2563eb', 0.25)).toBe('rgba(37, 99, 235, 0.250)');
		expect(withAlpha('rgb(37, 99, 235)', 0.5)).toBe('rgba(37, 99, 235, 0.500)');
		expect(withAlpha('#12345678', 0.5)).toBe('rgba(18, 52, 86, 0.235)');
	});
});

describe('options translations', () => {
	test('localizes reserved chords and describes every disabled shortcut truthfully', () => {
		const catalogs = createLocaleCatalogs();
		for (const locale of ['en-US', 'zh-CN', 'zh-TW', 'ja-JP'] as const) {
			const options = catalogs[locale]?.options;
			expect(options?.modal_reserved_default_hotkey.trim(), locale).not.toBe('');
			expect(options?.legacy_disabled_one.trim(), locale).not.toBe('');
			expect(options?.legacy_disabled_many.trim(), locale).not.toBe('');
		}
		expect(catalogs['en-US']?.options.legacy_disabled_one).not.toMatch(/Pitch/iu);
		expect(catalogs['en-US']?.options.legacy_pitch_one).toBeUndefined();
	});

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
			for (const [section, values] of Object.entries(dictionary)) {
				for (const [key, value] of Object.entries(values)) {
					expect(typeof value, `${locale}.${section}.${key}`).toBe('string');
				expect(value.trim(), `${locale}.${section}.${key}`).not.toBe('');
				expect(value.trim().toLowerCase(), `${locale}.${section}.${key}`).not.toBe('undefined');
				}
			}
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
		clearLocaleCatalogCache();
		const assets = createLocaleSurfaceAssetCatalogs();
		const english = createLocaleCatalogs()['en-US'];
		if (!english) throw new Error('English locale catalog is missing');
		const originalChrome = globalThis.chrome;
		const originalFetch = globalThis.fetch;
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: { runtime: { getURL: (path: string) => `https://spectra.invalid/${path}` } },
		});
		globalThis.fetch = (async (input: string | URL | Request) => {
			const match = /\/(popup|options|actions)\/en-US\.json\.gz$/u.exec(String(input));
			const surface = match?.[1] as keyof typeof assets | undefined;
			const asset = surface ? assets[surface]['en-US'] : undefined;
			return asset
				? new Response(gzipSync(JSON.stringify(asset), { level: 9, mtime: 0 }))
				: new Response('Not found', { status: 404 });
		}) as typeof fetch;
		try {
			await loadOptionsLocaleCatalog('fr-FR');
			await loadPopupLocaleCatalog('fr-FR');
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
		clearLocaleCatalogCache();
		const assets = createLocaleSurfaceAssetCatalogs();
		const complete = createLocaleCatalogs();
		const originalChrome = globalThis.chrome;
		const originalFetch = globalThis.fetch;
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: { runtime: { getURL: (path: string) => `https://spectra.invalid/${path}` } },
		});
		globalThis.fetch = (async (input: string | URL | Request) => {
			const match = /\/(popup|options|actions)\/([^/]+)\.json\.gz$/u.exec(String(input));
			const surface = match?.[1] as keyof typeof assets | undefined;
			const language = match?.[2];
			const asset = surface && language ? assets[surface][language] : undefined;
			return asset
				? new Response(gzipSync(JSON.stringify(asset), { level: 9, mtime: 0 }))
				: new Response('Not found', { status: 404 });
		}) as typeof fetch;
		try {
			for (const locale of SUPPORTED_SPECTRA_LANGUAGES) {
				await Promise.all([
					loadOptionsLocaleCatalog(locale),
					loadPopupLocaleCatalog(locale),
				]);
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

});

describe('extension-page DOM and idle contracts', () => {
	test('uses only the background settings snapshot as the Options theme owner', () => {
		const theme = readFileSync(resolve(import.meta.dir, '../src/options/theme.ts'), 'utf8');
		expect(theme).not.toContain("scope: 'legacy-theme'");
		expect(theme).not.toContain('localStorage');
		expect(theme).toContain('getOptionsSettingsSnapshot');
		expect(theme).toContain("from '../shared/options-settings-client'");
		expect(theme).not.toContain("from '../shared/settings-client'");
		expect(theme).not.toContain('chrome.storage');
		expect(theme).not.toContain('spectraSettingsMeta');
	});

	test('keeps site routes on an independent registry wire without changing full Settings v2', () => {
		const popup = readFileSync(resolve(import.meta.dir, '../public/popup.html'), 'utf8');
		expect(popup).toContain('id="registry-group"');
		expect(popup).toContain('id="registry-list"');
		expect(popup).toContain('id="registry-new-route"');
		expect(popup).toContain('data-i18n="grpAdvanced"');
		expect(popup).toContain('aria-pressed="false"');
		const settings = readFileSync(resolve(import.meta.dir, '../src/popup/views/settings.ts'), 'utf8');
		const routeUI = readFileSync(resolve(import.meta.dir, '../src/popup/views/media-route-ui.ts'), 'utf8');
		const popupIndex = readFileSync(resolve(import.meta.dir, '../src/popup/index.ts'), 'utf8');
		const hotkeyTargetClient = readFileSync(
			resolve(import.meta.dir, '../src/shared/hotkey-target-client.ts'),
			'utf8',
		);
		expect(settings).not.toContain('getRegistrySnapshot');
		expect(settings).not.toContain('registryEntries');
		expect(settings).toContain('initMediaRouteUI(state.dict)');
		expect(routeUI).toContain('getRegistrySnapshot');
		expect(routeUI).toContain('addRegistryDomain');
		expect(routeUI).toContain('removeRegistryDomain');
		expect(routeUI).not.toContain("scope: 'media-route'");
		expect(routeUI).toContain('subscribeSettingsSnapshots');
		expect(popupIndex).not.toContain('registryEntries');
		expect(hotkeyTargetClient).not.toContain('spectra.registry.');
		expect(hotkeyTargetClient).toContain('spectra.hotkey-target.get');
		expect(hotkeyTargetClient).toContain('spectra.hotkey-target.set');
		const sidePanel = readFileSync(resolve(import.meta.dir, '../src/popup/side-panel/index.ts'), 'utf8');
		const cardRegistry = readFileSync(resolve(import.meta.dir, '../src/popup/side-panel/registry.ts'), 'utf8');
		const presets = readFileSync(resolve(import.meta.dir, '../src/popup/views/presets-ui.ts'), 'utf8');
		const remote = readFileSync(resolve(import.meta.dir, '../src/remote/ui-bindings.ts'), 'utf8');
		expect(sidePanel).not.toContain('updateCardConfig');
		expect(sidePanel).not.toContain('isSidePanelOpen');
		expect(cardRegistry).not.toContain('config: AudioConfig;');
		expect(cardRegistry).not.toContain('getRegisteredConfig');
		expect(presets).not.toContain('getDefaultPreset');
		expect(remote).not.toContain('isRemoteConnected');

		for (const path of [
			'../src/popup/card/media-events.ts',
			'../src/popup/card/render.ts',
			'../src/popup/side-panel/index.ts',
			'../src/popup/side-panel/video-controls.ts',
		]) {
			const source = readFileSync(resolve(import.meta.dir, path), 'utf8');
			expect(source, path).toMatch(/aria-(?:pressed|selected)/u);
		}
	});

	test('uses one focus-trap contract for preset and remote dialogs with live status', () => {
		const preset = readFileSync(resolve(import.meta.dir, '../src/popup/views/presets-ui.ts'), 'utf8');
		const popupToast = readFileSync(resolve(import.meta.dir, '../src/popup/toast.ts'), 'utf8');
		const remote = readFileSync(resolve(import.meta.dir, '../src/remote/modal-renderer.ts'), 'utf8');
		const options = readFileSync(resolve(import.meta.dir, '../src/options/modal.ts'), 'utf8');
		for (const [path, source] of [['preset', preset], ['remote', remote]] as const) {
			expect(source, path).toContain('handleDialogKeydown');
			expect(source, path).toContain("setAttribute('role', 'dialog')");
			expect(source, path).toContain("setAttribute('aria-modal', 'true')");
		}
		expect(popupToast).toContain("tone === 'error' ? 'alert' : 'status'");
		expect(popupToast).toContain("tone === 'error' ? 'assertive' : 'polite'");
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
		expect(visualizer).toContain('visible: true');
		expect(visualizer).not.toContain('visible: !intersectionObserver');
		expect(visualizer).toContain("window.addEventListener('blur', releaseSubscriptions)");
		expect(visualizer).toContain('spectra-visualizer:$' + '{subscriberId}');
	});

	test('gives every popup range control an accessible name', () => {
		const html = readFileSync(resolve(import.meta.dir, '../public/popup.html'), 'utf8');
		const rangeInputs = html.match(/<input\b(?=[^>]*\btype=["']range["'])[^>]*>/giu) ?? [];
		expect(rangeInputs.length).toBeGreaterThan(0);
		for (const input of rangeInputs) {
			expect(input).toMatch(/\baria-(?:label|labelledby)=["'][^"']+["']/iu);
		}
	});

	test('keeps side-panel speed bounds aligned with the shared control range owner', () => {
		const speedControls = readFileSync(resolve(import.meta.dir, '../src/popup/side-panel/speed-controls.ts'), 'utf8');
		const popup = readFileSync(resolve(import.meta.dir, '../public/popup.html'), 'utf8');

		expect(CONTROL_VALUE_LIMITS.speed).toEqual({ min: 0.1, max: 16 });
		expect(speedControls).toContain('CONTROL_VALUE_LIMITS.speed.min');
		expect(speedControls).toContain('CONTROL_VALUE_LIMITS.speed.max');
		expect(popup).toMatch(/class="sp-label-side">0\.1x<\/span>/u);
		expect(popup).toMatch(/class="[^"]*sp-speed-slider[^"]*"[\s\S]*?min="0\.1"[\s\S]*?max="16"/u);
		expect(popup).toMatch(/class="sp-speed-input"[^>]*\bmin="0\.1"[^>]*\bmax="16"/u);
	});

	test('renders dynamic UI without HTML string sinks', () => {
		const files = [
			'../src/popup/views/i18n-apply.ts',
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

	test('injects the selected locale before preset first render', () => {
		const settings = readFileSync(resolve(import.meta.dir, '../src/popup/views/settings.ts'), 'utf8');
		const presets = readFileSync(resolve(import.meta.dir, '../src/popup/views/presets-ui.ts'), 'utf8');
		const normalizedPresets = presets.replaceAll('\r\n', '\n');

		expect(settings).not.toContain('initRegistryUI');
		expect(settings).not.toContain('getRegistrySnapshot');
		expect(settings).toContain('initPresetsUI(state.dict)');
		expect(settings).toContain("} from './presets-ui'");
		expect(settings).not.toContain('disposePresetsUI?.(');
		expect(normalizedPresets).toContain('export function initPresetsUI(dict: I18NDict):');
		expect(presets).toContain('const refreshRevision = ++latestRefreshRevision');
		expect(presets).not.toContain('currentDict: I18NDict | null');
	});

	test('keeps video-only Popup acknowledgements independent from active media', () => {
		const mediaControls = readFileSync(resolve(import.meta.dir, '../src/popup/card/media-events.ts'), 'utf8');
		const videoControls = readFileSync(resolve(import.meta.dir, '../src/popup/side-panel/video-controls.ts'), 'utf8');
		// rule: SCTRL-005/014/025 — the click handler stores the target context
		// once and dispatches the single-parameter toggle; the helper re-resolves
		// the target from the captured snapshot so video-only ACKs never inherit
		// the active-media identity.
		expect(mediaControls).toContain('pipToggleByTab.set(tabId, { documentId: snapshot.documentId, target })');
		expect(mediaControls).toContain('togglePictureInPicture(tabId)');
		expect(mediaControls).toContain('const target = snapshot?.activeVideo');
		expect(mediaControls).not.toContain("mutation.field === 'pip'");
		expect(videoControls).toContain('activeMedia: currentSnapshot.activeMedia');
		expect(videoControls).not.toContain('activeMedia: ack.target ?? currentSnapshot.activeMedia');
	});

	test('keeps v1 UI_SYNC outside the Popup state projection', () => {
		const messaging = readFileSync(resolve(import.meta.dir, '../src/popup/card/messaging.ts'), 'utf8');
		expect(messaging).not.toContain('legacy-message-adapter');
		expect(messaging).not.toContain('UI_SYNC');
	});

	test('requires a live card target before applying a preset and bounds background bootstrap', () => {
		const presets = readFileSync(resolve(import.meta.dir, '../src/popup/views/presets-ui.ts'), 'utf8');
		const popup = readFileSync(resolve(import.meta.dir, '../src/popup/index.ts'), 'utf8');
		const boundedBootstrap = readFileSync(
			resolve(import.meta.dir, '../src/popup/bounded-card-bootstrap.ts'),
			'utf8',
		);
		const card = readFileSync(resolve(import.meta.dir, '../src/popup/card/init.ts'), 'utf8');
		expect(presets).toContain('applyBtn.disabled = !canApply');
		expect(presets).toContain('await target.apply(config)');
		expect(popup).toContain('runBoundedCardBootstrap(backgroundTabs, CARD_SNAPSHOT_CONCURRENCY');
		const snapshot = readFileSync(resolve(import.meta.dir, '../src/popup/card/snapshot.ts'), 'utf8');
		expect(snapshot).toContain('CARD_SNAPSHOT_CONCURRENCY = 4');
		expect(boundedBootstrap).toContain(
			'const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), items.length);',
		);
		expect(boundedBootstrap).toContain('await Promise.all(Array.from({ length: workerCount }, () => worker()));');
		expect(card).toContain('params.isBackground');
		expect(snapshot).toContain('passive ? Promise.resolve(null)');
	});

	test('keeps Popup PiP single-click, native-only, and lifecycle-bound', () => {
		const popup = readFileSync(resolve(import.meta.dir, '../src/popup/card/media-events.ts'), 'utf8');
		const bridge = readFileSync(
			resolve(import.meta.dir, '../src/content/input/trusted-activation-bridge.ts'),
			'utf8',
		);
		const nativeExecutor = readFileSync(
			resolve(import.meta.dir, '../src/content/logic/native-media-executor.ts'),
			'utf8',
		);
		const protocol = readFileSync(
			resolve(import.meta.dir, '../../../packages/contracts/src/spectra.protocol.ts'),
			'utf8',
		);
		const pipHandlerStart = popup.indexOf('if (ui.btnPip)');
		const pipHandlerEnd = popup.indexOf('const submitSpeed', pipHandlerStart);
		expect(pipHandlerStart).toBeGreaterThanOrEqual(0);
		expect(pipHandlerEnd).toBeGreaterThan(pipHandlerStart);
		const pipHandler = popup.slice(pipHandlerStart, pipHandlerEnd);
		const pipDispatchStart = popup.indexOf('async function dispatchPictureInPicture(');
		const pipDispatchEnd = popup.indexOf('function asControlUiFailure(', pipDispatchStart);
		expect(pipDispatchStart).toBeGreaterThanOrEqual(0);
		expect(pipDispatchEnd).toBeGreaterThan(pipDispatchStart);
		const pipDispatch = popup.slice(pipDispatchStart, pipDispatchEnd);
		expect(pipDispatch.match(/chrome\.scripting\.executeScript/gu)?.length).toBe(1);
		expect(pipDispatch).toContain("world: 'ISOLATED'");
		expect(pipDispatch).toContain('SPECTRA_TRUSTED_PIP_REQUEST_ATTRIBUTE');
		expect(pipDispatch).toContain('documentId: currentDocumentId');
		expect(pipDispatch).toContain('target: currentTarget');
		expect(pipDispatch).toContain('return new Promise<SpectraTrustedPipOutcome | null>');
		expect(pipDispatch).toContain('new MutationObserver(readOutcome)');
		expect(pipDispatch).not.toContain('while (performance.now() < deadline)');
		expect(pipHandler).not.toContain('chrome.tabs.update');
		expect(bridge).toContain('navigator.userActivation.isActive');
		// rule: SCTRL-014/025 — the ISOLATED bridge invokes the canonical
		// control entry with no positional context; the document/target context
		// was already bound at click time and resolved inside the executor.
		expect(bridge).toContain("submitTrustedActivationControl('pip')");
		expect(bridge).toContain('dispatchOutcome');
		expect(nativeExecutor).toContain('element.disablePictureInPicture = false');
		expect(nativeExecutor).toContain('element.disablePictureInPicture = true');
		expect(protocol).not.toContain('spectra.content.activation.prompt');
	});

	test('keeps card tooltips defined and routes site identity through Chromium favicon service', () => {
		const domInit = readFileSync(resolve(import.meta.dir, '../src/popup/card/dom-init.ts'), 'utf8');
		const domUtils = readFileSync(resolve(import.meta.dir, '../src/popup/utils/dom.ts'), 'utf8');
		const events = readFileSync(resolve(import.meta.dir, '../src/popup/card/events.ts'), 'utf8');
		const i18n = readFileSync(resolve(import.meta.dir, '../src/popup/views/i18n-apply.ts'), 'utf8');
		const remote = readFileSync(resolve(import.meta.dir, '../src/remote/ui-bindings.ts'), 'utf8');
		const manifest = readFileSync(resolve(import.meta.dir, '../public/manifest.json'), 'utf8');
		expect(domInit).toContain("setButtonLabel(ui.btnReset, dict.resetTooltip, 'Reset')");
		expect(domInit).toContain("setButtonLabel(ui.btnSave, dict.saveTooltip, 'Save')");
		expect(domInit).toContain('setButtonLabel(ui.btnSaveGlobal');
		expect(domUtils).toContain("chrome.runtime.getURL('_favicon/')");
		expect(domUtils).not.toContain('if (!faviconUrl) return fallback');
		expect(JSON.parse(manifest).permissions).toContain('favicon');
		expect(JSON.parse(manifest).permissions).toContain('activeTab');
		expect(JSON.parse(manifest).permissions).not.toContain('_favicon');
		expect(i18n).toContain("setInteractiveLabel(btnPause, dict.btnPause, 'Pause/Play')");
		expect(remote).toContain("button.setAttribute('aria-label', label)");
		expect(events).toContain('await update.flush()');
		expect(events).toContain("ControlOperationAck<'audio-reset'>");
		expect(events).toContain('state.stableConfig = mergeAudioConfig(acknowledged');
		expect(events).toContain('speed: 1');
	});

	test('keeps fullscreen handoff and top-layer feedback lifecycle-bound', () => {
		const manifest = JSON.parse(readFileSync(
			resolve(import.meta.dir, '../public/manifest.json'),
			'utf8',
		)) as { content_scripts?: Array<{ js?: string[]; world?: string }> };
		const mediaControls = readFileSync(resolve(import.meta.dir, '../src/popup/card/media-events.ts'), 'utf8');
		const shortcuts = readFileSync(resolve(import.meta.dir, '../src/background/shortcuts.ts'), 'utf8');
		const hotkeys = readFileSync(resolve(import.meta.dir, '../src/content/input/hotkey-listener.ts'), 'utf8');
		const osd = readFileSync(resolve(import.meta.dir, '../src/content/ui/osd.ts'), 'utf8');
		const toast = readFileSync(resolve(import.meta.dir, '../src/content/ui/toast.ts'), 'utf8');
		const contentRuntime = readFileSync(
			resolve(import.meta.dir, '../src/content/core/index.ts'),
			'utf8',
		);
		const contentRuntimeLifecycle = readFileSync(
			resolve(import.meta.dir, '../src/content/core/content-runtime-lifecycle.ts'),
			'utf8',
		);
		const feedbackSurface = readFileSync(
			resolve(import.meta.dir, '../src/content/ui/feedback-surface.ts'),
			'utf8',
		);
		const audioDelegate = readFileSync(
			resolve(import.meta.dir, '../src/content/logic/audio-runtime-control-delegate.ts'),
			'utf8',
		);
		const operations = readFileSync(
			resolve(import.meta.dir, '../src/content/logic/control-operation-executor.ts'),
			'utf8',
		);
		const pageMediaBridge = readFileSync(
			resolve(import.meta.dir, '../src/content/injector/page-media-bridge.ts'),
			'utf8',
		);
		const handoff = readFileSync(resolve(import.meta.dir, '../src/content/core/fullscreen-audio-handoff.ts'), 'utf8');
		// rule: MAIN-world fullscreen and page-media bridges are registered in
	// the manifest at document_start so Chrome injects them before any page
	// script can call requestFullscreen or create a player controller. This is the only
	// path that does not race with service-worker wake-up or page CSP.
	// main-runtime-manager.ts remains the owner of the `world: 'MAIN'`
	// re-injection literal used by warm-update and on-demand paths; the bridge
	// modules' version guard makes a second injection a no-op, so the two paths
	// coexist safely.
	expect(manifest.content_scripts).toContainEqual(expect.objectContaining({
		js: ['content-fullscreen-bridge.js'],
		world: 'MAIN',
	}));
	expect(manifest.content_scripts).toContainEqual(expect.objectContaining({
		js: ['content-page-media-bridge.js'],
		world: 'MAIN',
	}));
	expect(manifest.content_scripts).toContainEqual(expect.objectContaining({
		js: ['content-bootstrap.js'],
		world: 'ISOLATED',
	}));
		const mainRuntime = readFileSync(
			resolve(import.meta.dir, '../src/background/main-runtime-manager.ts'),
			'utf8',
		);
		expect(mainRuntime).toContain("'content-fullscreen-bridge.js'");
		expect(mainRuntime).toContain("'content-page-media-bridge.js'");
		expect(mainRuntime).toContain('export async function injectMainBridges');
		expect(mainRuntime).toContain('export async function injectMainBootstrap');
		expect(mainRuntime).toContain("world: 'MAIN'");
		expect(handoff).toContain('captureManager.suspendForContinuation(');
		expect(handoff).toContain('await currentSuspension');
		expect(handoff).toContain('policyExecutor.applyState({ modeIntent: true })');
		expect(mediaControls).toContain('setHotkeyTarget(clearing ? null : tabId)');
		expect(shortcuts).toContain("type: 'spectra.hotkey.target.feedback'");
		expect(shortcuts).toContain('initialFrame.documentId');
		expect(shortcuts).toContain('currentFrame?.documentId !== ready.documentId');
		expect(shortcuts).toContain(
			'resolveSpectraHotkeyActualFeedback(action, acknowledgement)',
		);
		expect(shortcuts).not.toContain('function shortcutActualFeedback');
		expect(shortcuts).not.toContain('getControlViewSnapshot');
		expect(shortcuts).not.toContain('getAudioSession');
		expect(shortcuts).toContain('const route = await resolveShortcutTargetFromActive(');
		expect(shortcuts).toContain('await executeShortcutRoute(');
		expect(hotkeys).toContain("variant: 'alternate-target'");
		expect(hotkeys).toContain('feedbackState.appliedConfig');
		expect(hotkeys).toContain('commitHotkeyActualFeedback(');
		expect(hotkeys).toMatch(
			/!admitsHotkeyActualOSDGesture\([\s\S]{0,180}!isHotkeyGestureReleased\(message\.payload\.gesture\)/u,
		);
		expect(hotkeys).toContain('claimHotkeyActualOSDGesture(message.payload.gesture)');
		expect(hotkeys).toContain(
			'resolveSpectraHotkeyActualFeedback(binding.action, result)',
		);
		expect(hotkeys).toContain("feedbackOwner === 'listener-label'");
		expect(hotkeys).not.toContain("feedbackOwner === 'listener-label' || feedbackOwner === 'actual-osd'");
		expect(osd).toContain('createFeedbackSurface(');
		expect(feedbackSurface).toContain("host.popover = 'manual'");
		expect(feedbackSurface).toContain("document.addEventListener('fullscreenchange'");
		expect(feedbackSurface).toContain("document.removeEventListener('fullscreenchange'");
		expect(feedbackSurface).toContain("host.matches(':popover-open')");
		expect(feedbackSurface).toContain('host.showPopover()');
		expect(feedbackSurface).toContain('feedbackHosts.clear()');
		expect(contentRuntime).toContain('disposeOSD();');
		expect(contentRuntime).toContain('disposeToast();');
		expect(contentRuntime).toContain('disposeFeedbackSurfaces();');
		const runtimeDispose = contentRuntime.slice(
			contentRuntime.indexOf('dispose(handoff = false)'),
			contentRuntime.indexOf('function isCurrentRuntime('),
		);
		expect(runtimeDispose.indexOf('disposeFeedbackUI();')).toBeGreaterThanOrEqual(0);
		expect(runtimeDispose.indexOf('disposeFeedbackUI();')).toBeLessThan(
			runtimeDispose.indexOf('registry.dispose();'),
		);
		expect(contentRuntimeLifecycle.indexOf('disposal.context?.dispose();')).toBeLessThan(
			contentRuntimeLifecycle.indexOf('disposal.disposeSynchronous();'),
		);
		expect(contentRuntimeLifecycle.indexOf('disposal.disposeSynchronous();')).toBeLessThan(
			contentRuntimeLifecycle.indexOf('await disposal.release?.();'),
		);
		expect(contentRuntimeLifecycle.indexOf('await disposal.release?.();')).toBeLessThan(
			contentRuntimeLifecycle.indexOf('disposal.finalize();'),
		);
		expect(contentRuntime).toContain('contentRuntime.registry.track(disposeFeedbackUI)');
		expect(osd).toContain('if (state.disposed) return;');
		expect(toast).toContain('if (s.disposed || !document.documentElement) return;');
		expect(osd).toContain('const OSD_HIDE_DELAY_MS = 2_000');
		expect(osd).toContain("phase: 'active'");
		expect(osd).toContain("state.hotkey.phase = 'settled'");
		expect(osd).not.toContain('export function showOSD(');
		expect(osd).not.toContain('export function showSpeedOSD(');
		expect(osd).toContain('UI_COLORS.CAPTURE');
		expect(osd).toContain('UI_COLORS.NATIVE');
		expect(osd).not.toContain('#3b82f6');
		expect(osd).not.toContain('#8b5cf6');
		expect(osd).not.toContain('payload.capture');
		expect(osd).not.toContain('transition:width');
		expect(osd).toContain("variant?: 'alternate-target'");
		expect(audioDelegate).not.toContain("source !== 'hotkey'");
		expect(audioDelegate).not.toContain("intent.source === 'hotkey'");
		expect(operations).toContain("if (intent.source === 'hotkey') {");
		expect(operations).toContain("return ack(intent, 'observe', { shown: true }, {}, null)");
		expect(pageMediaBridge).toContain('collectControllerCandidates');
		expect(pageMediaBridge).toContain('controllerAssociation');
		expect(pageMediaBridge).toContain("boundMethod(controller, 'getVolume')");
		expect(pageMediaBridge).toContain("boundMethod(controller, 'setVolume')");
		expect(pageMediaBridge).toContain("boundMethod(controller, 'isMuted')");
		expect(pageMediaBridge).toContain("boundMethod(controller, 'getPlaybackRate')");
		expect(pageMediaBridge).toContain("boundMethod(controller, 'setPlaybackRate')");
		expect(pageMediaBridge).toContain('capability.write(before)');
		expect(pageMediaBridge).not.toMatch(/youtube|hostname|location\.host|setInterval|MutationObserver/iu);
		expect(pageMediaBridge).not.toMatch(/HTMLMediaElement\.prototype|Object\.defineProperty\s*\(\s*HTMLMediaElement/iu);
	});
});

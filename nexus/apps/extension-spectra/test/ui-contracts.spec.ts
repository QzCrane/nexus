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

	test('exposes stateful controls and one media route list to assistive technology', () => {
		const popup = readFileSync(resolve(import.meta.dir, '../public/popup.html'), 'utf8');
		expect(popup).toContain('<ul id="registry-list" class="registry-list"');
		expect(popup).toContain('id="registry-new-route"');
		expect(popup).not.toContain('id="tab-restricted"');
		expect(popup).not.toContain('id="tab-safe"');
		expect(popup).toContain('aria-pressed="false"');
		const registry = readFileSync(resolve(import.meta.dir, '../src/popup/views/registry-ui.ts'), 'utf8');
		expect(registry).toContain('changes.mediaRouteRegistry');
		// The UI relies on the storage-layer normalization contract: every entry
		// arrives with a site:* fingerprint (normalizeRegistryEntries rewrites
		// legacy media:v1:* records on read), so the UI labels source via the
		// DomainEntry.source field rather than re-deriving it from the fingerprint
		// prefix. Verifying the storage-side normalization is the responsibility of
		// registry-v2.spec.ts.
		expect(registry).toContain('entry.source === \'auto\'');

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
		const pipHandler = popup.slice(
			popup.indexOf('if (ui.btnPip)'),
			popup.indexOf('// rule: speed controls'),
		);
		expect(popup).toContain('chrome.scripting.executeScript');
		expect(popup).toContain("world: 'ISOLATED'");
		expect(popup).toContain('SPECTRA_TRUSTED_PIP_REQUEST_ATTRIBUTE');
		expect(popup).toContain('documentId: currentDocumentId');
		expect(popup).toContain('target: currentTarget');
		expect(popup).toContain('while (performance.now() < deadline)');
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
		expect(JSON.parse(manifest).permissions).not.toContain('_favicon');
		expect(i18n).toContain("setInteractiveLabel(btnPause, dict.btnPause, 'Pause/Play')");
		expect(remote).toContain("button.setAttribute('aria-label', label)");
		expect(events).toContain('await update.flush()');
		expect(events).toContain("ControlOperationAck<'audio-reset'>");
		expect(events).toContain('state.stableConfig = mergeAudioConfig(acknowledged');
		expect(events).toContain('speed: 1');
	});

	test('keeps fullscreen handoff and alternate-target feedback lifecycle-bound', () => {
		const manifest = JSON.parse(readFileSync(
			resolve(import.meta.dir, '../public/manifest.json'),
			'utf8',
		)) as { content_scripts?: Array<{ js?: string[]; world?: string }> };
		const mediaControls = readFileSync(resolve(import.meta.dir, '../src/popup/card/media-events.ts'), 'utf8');
		const shortcuts = readFileSync(resolve(import.meta.dir, '../src/background/shortcuts.ts'), 'utf8');
		const hotkeys = readFileSync(resolve(import.meta.dir, '../src/content/input/hotkey-listener.ts'), 'utf8');
		const toast = readFileSync(resolve(import.meta.dir, '../src/content/ui/toast.ts'), 'utf8');
		const osd = readFileSync(resolve(import.meta.dir, '../src/content/ui/osd.ts'), 'utf8');
		const audioDelegate = readFileSync(
			resolve(import.meta.dir, '../src/content/logic/audio-runtime-control-delegate.ts'),
			'utf8',
		);
		const operations = readFileSync(
			resolve(import.meta.dir, '../src/content/logic/control-operation-executor.ts'),
			'utf8',
		);
		const playbackBridge = readFileSync(
			resolve(import.meta.dir, '../src/content/injector/playback-rate-bridge.ts'),
			'utf8',
		);
		const handoff = readFileSync(resolve(import.meta.dir, '../src/content/core/fullscreen-audio-handoff.ts'), 'utf8');
		// rule: MAIN-world fullscreen and playback-rate bridges are registered in
	// the manifest at document_start so Chrome injects them before any page
	// script can call requestFullscreen or set playbackRate. This is the only
	// path that does not race with service-worker wake-up or page CSP.
	// main-runtime-manager.ts remains the owner of the `world: 'MAIN'`
	// re-injection literal used by warm-update and on-demand paths; the bridge
	// modules' V1 guard makes a second injection a no-op, so the two paths
	// coexist safely.
	expect(manifest.content_scripts).toContainEqual(expect.objectContaining({
		js: ['content-fullscreen-bridge.js'],
		world: 'MAIN',
	}));
	expect(manifest.content_scripts).toContainEqual(expect.objectContaining({
		js: ['content-playback-rate-bridge.js'],
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
		expect(mainRuntime).toContain("'content-playback-rate-bridge.js'");
		expect(mainRuntime).toContain('export async function injectMainBridges');
		expect(mainRuntime).toContain('export async function injectMainBootstrap');
		expect(mainRuntime).toContain("world: 'MAIN'");
		expect(handoff).toContain("captureManager.request(");
		expect(handoff).toContain('await currentSuspension');
		expect(handoff).toContain('policyExecutor.applyState({ modeIntent: true })');
		expect(mediaControls).toContain('setHotkeyTarget(clearing ? null : tabId)');
		expect(shortcuts).toContain("type: 'spectra.hotkey.target.feedback'");
		expect(shortcuts).toContain('initialFrame.documentId');
		expect(shortcuts).toContain('currentFrame?.documentId !== ready.documentId');
		expect(shortcuts).toContain('readShortcutActualFeedback(action, tabId)');
		expect(hotkeys).toContain("variant: 'alternate-target'");
		expect(hotkeys).toContain('showHotkeyActualOSD(message.payload.feedback');
		expect(hotkeys).toContain("feedbackOwner === 'listener-label'");
		expect(hotkeys).not.toContain("feedbackOwner === 'listener-label' || feedbackOwner === 'actual-osd'");
		expect(toast).not.toContain('.t.alternate');
		expect(toast).not.toContain("classList.toggle('alternate'");
		expect(toast).toContain("setTimeout(() => t.classList.add('hide'), 1_800)");
		expect(osd).toContain('const OSD_HIDE_DELAY_MS = 2_000');
		expect(osd).toContain('export function hideOSD()');
		expect(osd).toContain("variant?: 'alternate-target'");
		expect(audioDelegate).toContain("source !== 'hotkey'");
		expect(audioDelegate).toContain("intent.source === 'hotkey'");
		expect(operations).toContain("if (intent.source === 'hotkey') {");
		expect(operations).toContain("return ack(intent, 'observe', { shown: true }, {}, null)");
		expect(playbackBridge).toContain("element.closest('.xgplayer, xg-video-container')");
		expect(playbackBridge).toContain('selected.click()');
		expect(playbackBridge).toContain("'xg-playbackrate li'");
		expect(playbackBridge).toContain('document.querySelectorAll<HTMLElement>(RATE_CONTROL_SELECTOR)');
		expect(playbackBridge).toContain('new MutationObserver');
		expect(playbackBridge).toContain('synchronizeAttachedPlayerController');
		expect(playbackBridge).toContain("'setPlaybackRate'");
		// rule: SCTRL-003 — playbackRate writes must route through the
		// executor-owned Reflect.set path; direct assignment is forbidden so
		// page-side reassertions cannot bypass the architecture owner.
		expect(playbackBridge).toContain("Reflect.set(element, 'playbackRate', request.speed)");
		expect(playbackBridge).not.toMatch(/element\.playbackRate\s*=\s*request\.speed/);
	});
});

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	audioSessionMatchesIdentity,
	audioSessionMatchesControlDocument,
	DEFAULT_AUDIO_CONFIG,
	resolveAudioVolumeState,
} from '@nexus/contracts';
import { COLORS } from '../src/popup/constants';
import { actualVolumeColor, createRenderFn, gestureVolumeColor, setCardMaskVisible } from '../src/popup/card/render';
import { createVolumeView } from '../src/popup/card/volume-view';
import { mergeAudioConfig } from '../src/popup/card/types';
import { setupCardMessaging } from '../src/popup/card/messaging';

describe('Popup single effective-volume control', () => {
	test('projects the complete mask state through repeated runnable and unavailable node reuse', () => {
		const attributes = new Map<string, string>();
		const controlAttributes = new Map<string, string>();
		const classes = new Set<string>();
		const ui = {
			mask: { hidden: false, tabIndex: 0,
				classList: { toggle: (name: string, force: boolean) => { if (force) classes.add(name); else classes.delete(name); } },
				setAttribute: (key: string, value: string) => attributes.set(key, value),
				toggleAttribute: (key: string, force: boolean) => { if (force) attributes.set(key, ''); else attributes.delete(key); },
			},
			card: { querySelector: () => ({
				setAttribute: (key: string, value: string) => controlAttributes.set(key, value),
				toggleAttribute: (key: string, force: boolean) => { if (force) controlAttributes.set(key, ''); else controlAttributes.delete(key); },
			}) },
		};
		for (const availability of ['runnable', 'frozen', 'runnable', 'discarded', 'runnable', 'frozen', 'discarded', 'runnable']) {
			const visible = availability !== 'runnable';
			setCardMaskVisible(ui as never, visible);
			expect({ hidden: ui.mask.hidden, hiddenClass: classes.has('hidden'), ariaHidden: attributes.get('aria-hidden'),
				inert: attributes.has('inert'), tabIndex: ui.mask.tabIndex,
				controlsInert: controlAttributes.has('inert'), controlsHidden: controlAttributes.get('aria-hidden') })
				.toEqual({ hidden: !visible, hiddenClass: !visible, ariaHidden: String(!visible), inert: !visible,
					tabIndex: visible ? 0 : -1, controlsInert: visible, controlsHidden: String(visible) });
		}
	});
	test('does not observe unavailable tabs or read their cached document state', () => {
		const dispose = setupCardMessaging({ tabId: 55, documentId: 'retired-document', observe: false,
			get state() { throw new Error('Unavailable tab state must remain unread'); },
			render: () => { throw new Error('Unavailable tabs must not hydrate controls'); },
		});
		expect(() => dispose()).not.toThrow();
	});
	test('exposes exactly one 0-800 slider and no implementation-level Boost control', () => {
		const html = readFileSync(resolve(import.meta.dir, '../public/popup.html'), 'utf8');
		expect(html.match(/class="vol-slider"/gu)).toHaveLength(1);
		expect(html).toContain('class="vol-slider"');
		expect(html.includes("class=\"vol-slider\"") && html.includes("min=\"0\"") && html.includes("max=\"800\"")).toBe(true);
		expect(html).not.toContain('boost-slider');
		expect(html).not.toContain('Audio boost');
	});

	test('projects the one value to native volume and hidden Boost without changing the product value', () => {
		const native = mergeAudioConfig(DEFAULT_AUDIO_CONFIG, { volume: 65 });
		expect(native).toMatchObject({ volume: 65, volumeBase: 65, boost: 1 });

		const enhanced = mergeAudioConfig(native, { volume: 350 });
		expect(enhanced).toMatchObject({ volume: 350, volumeBase: 100, boost: 3.5 });
	});

	test('derives color only from acknowledged capture state above the native ceiling', () => {
		expect(actualVolumeColor(false, 350, 'bypass', 'active')).toBe(COLORS.NATIVE);
		expect(actualVolumeColor(false, 350, 'capture', 'starting')).toBe(COLORS.NATIVE);
		expect(actualVolumeColor(false, 80, 'capture', 'active')).toBe(COLORS.NATIVE);
		expect(actualVolumeColor(false, 350, 'capture', 'active')).toBe(COLORS.CAPTURE);
		expect(actualVolumeColor(true, 350, 'capture', 'active')).toBe(COLORS.MUTED);
		expect(actualVolumeColor(false, 0, 'capture', 'active')).toBe(COLORS.MUTED);
	});

	test('gestureVolumeColor uses the same tone as the settled frame', () => {
		// Violet needs both facts: the value is above the native ceiling and the
		// acknowledged route is Capture. At the ceiling the split is Boost 1, so
		// the leaving gesture turns blue immediately instead of holding violet
		// until the processor releases. Both paths read the same decision, so the
		// badge and the slider cannot disagree at the boundary.
		expect(gestureVolumeColor(false, 350, 'capture', 'active')).toBe(COLORS.CAPTURE);
		expect(gestureVolumeColor(false, 101, 'capture', 'active')).toBe(COLORS.CAPTURE);
		expect(gestureVolumeColor(false, 100, 'capture', 'active')).toBe(COLORS.NATIVE);
		expect(gestureVolumeColor(false, 50, 'capture', 'active')).toBe(COLORS.NATIVE);
		expect(gestureVolumeColor(false, 80, 'capture', 'active')).toBe(actualVolumeColor(false, 80, 'capture', 'active'));

		// Page-native sites carry the amplified part themselves: 100 -> 350 is
		// one continuous blue, whether or not the page ever acknowledged >100.
		const pageNativeSnapshot = {
			tabId: 1, documentId: 'doc1', origin: 'https://video.example', generation: 1, revision: 1,
			activeMedia: null, activeVideo: null,
			fields: { volumeBase: { phase: 'applied' as const, strategy: 'page-native' as const, actual: 110, revision: 1, controlled: true, lastError: null } },
		};
		expect(gestureVolumeColor(false, 110, 'bypass', 'idle', undefined, pageNativeSnapshot)).toBe(COLORS.NATIVE);
		expect(gestureVolumeColor(false, 350, 'bypass', 'idle', undefined, pageNativeSnapshot)).toBe(COLORS.NATIVE);

		// Dom-native sites: the element's own volume stops at 1.0, but the MAIN
		// bridge's output gain amplifies the same graph in place, so the crossing
		// is still a page-side write. Violet is reserved for an acknowledged
		// Capture, never for the threshold itself.
		const domNativeSnapshot = {
			tabId: 1, documentId: 'doc1', origin: 'https://dom.example', generation: 1, revision: 1,
			activeMedia: null, activeVideo: null,
			fields: { volumeBase: { phase: 'applied' as const, strategy: 'dom-native' as const, actual: 100, revision: 1, controlled: true, lastError: null } },
		};
		expect(gestureVolumeColor(false, 101, 'bypass', 'idle', undefined, domNativeSnapshot)).toBe(COLORS.NATIVE);
		expect(gestureVolumeColor(false, 350, 'bypass', 'idle', undefined, domNativeSnapshot)).toBe(COLORS.NATIVE);

		// Unhijacked / bypass sites without any acknowledgement: remain native blue
		expect(gestureVolumeColor(false, 110, 'bypass', 'idle')).toBe(COLORS.NATIVE);

		// Silence / muted
		expect(gestureVolumeColor(true, 350, 'capture', 'active')).toBe(COLORS.MUTED);
		expect(gestureVolumeColor(false, 0, 'capture', 'active')).toBe(COLORS.MUTED);
	});

	test('only an acknowledged Capture Boost owner predicts violet in the gesture frame', () => {
		// The one prediction the palette allows. It replays a fact the document
		// already proved (`boost.strategy`), which is also the fact the shortcut
		// pill reads, so the two surfaces cross on the same frame.
		const captureOwned = {
			tabId: 1, documentId: 'doc1', origin: 'https://live.example', generation: 1, revision: 1,
			activeMedia: null, activeVideo: null,
			fields: {
				volumeBase: { phase: 'applied' as const, strategy: 'dom-native' as const, actual: 100,
					revision: 1, controlled: true, lastError: null },
				boost: { phase: 'applied' as const, strategy: 'capture' as const, actual: 1.1,
					revision: 1, controlled: true, lastError: null },
			},
		};
		expect(gestureVolumeColor(false, 110, 'bypass', 'idle', undefined, captureOwned))
			.toBe(COLORS.CAPTURE);
		expect(gestureVolumeColor(false, 350, 'bypass', 'idle', undefined, captureOwned))
			.toBe(COLORS.CAPTURE);
		// Below the ceiling nothing is being boosted, so nothing is violet.
		expect(gestureVolumeColor(false, 100, 'bypass', 'idle', undefined, captureOwned))
			.toBe(COLORS.NATIVE);

		// An acknowledged in-page Boost graph covers the amplification itself.
		const graph = { ...captureOwned, fields: { ...captureOwned.fields,
			boost: { ...captureOwned.fields.boost, strategy: 'media-webaudio' as const } } };
		expect(gestureVolumeColor(false, 110, 'bypass', 'idle', undefined, graph))
			.toBe(COLORS.NATIVE);

		// A page that acknowledged the amplified value through its own writer owns
		// the scale outright.
		const amplified = { ...captureOwned, fields: { volumeBase: {
			...captureOwned.fields.volumeBase, strategy: 'page-native' as const, actual: 140,
		} } };
		expect(gestureVolumeColor(false, 110, 'bypass', 'idle', undefined, amplified))
			.toBe(COLORS.NATIVE);
	});

	test('uses one volume-state truth table and fails closed on stale document identity', () => {
		expect(resolveAudioVolumeState({
			volume: 80, muted: false, actualMode: 'capture', phase: 'active',
		})).toBe('native');
		expect(resolveAudioVolumeState({
			volume: 350, muted: false, actualMode: 'bypass', phase: 'active',
		})).toBe('native');
		expect(resolveAudioVolumeState({
			volume: 350, muted: false, actualMode: 'capture', phase: 'error',
		})).toBe('native');
		expect(resolveAudioVolumeState({
			volume: 0, muted: false, actualMode: 'capture', phase: 'active',
		})).toBe('silent');

		const identity = {
			tabId: 17, documentId: 'document-current', origin: 'https://media.example', generation: 9,
		};
		expect(audioSessionMatchesIdentity(identity, identity)).toBe(true);
		expect(audioSessionMatchesIdentity(
			{ ...identity, documentId: 'document-stale' },
			identity,
		)).toBe(false);
		expect(audioSessionMatchesIdentity(
			{ ...identity, origin: 'https://stale.example' },
			identity,
		)).toBe(false);
		expect(audioSessionMatchesIdentity(
			{ ...identity, generation: 8 },
			identity,
		)).toBe(false);
		expect(audioSessionMatchesControlDocument(
			{ ...identity, generation: 8 },
			identity,
		)).toBe(true);
	});

	test('renderCard leaves the action badge to the Background projection', () => {
		const calls: Array<{ type: string; payload: unknown }> = [];
		(globalThis as unknown as { chrome: unknown }).chrome = {
			action: {
				setBadgeText: (payload: unknown) => { calls.push({ type: 'text', payload }); },
				setBadgeBackgroundColor: (payload: unknown) => { calls.push({ type: 'bg', payload }); },
				setBadgeTextColor: (payload: unknown) => { calls.push({ type: 'color', payload }); },
			},
		};

		const syncStatus = { hidden: true, dataset: { i18n: 'controlSyncing' }, textContent: 'Syncing' };
		const dummyUi = {
			card: { classList: { toggle: () => {} }, dataset: {}, querySelector: (selector: string) => selector === '.control-sync-status' ? syncStatus : null },
			val: { setAttribute: () => {}, textContent: '', style: {} },
			mask: { classList: { toggle: () => {} }, setAttribute: () => {}, toggleAttribute: () => {} },
			mute: { classList: { toggle: () => {} }, setAttribute: () => {}, replaceChildren: () => {}, style: {} },
			slider: { value: '100', setProperty: () => {}, style: { setProperty: () => {} } },
			fill: { style: {} },
			enable: { checked: true },
		};

		const dummyState = {
			config: { enabled: true, muted: false, volume: 150, volumeBase: 100, boost: 1.5, eqValues: [] },
			actualMode: 'capture' as const,
			phase: 'active' as const,
			controlSnapshotKnown: true,
			controlSyncExpired: false,
			lifecycleSnapshotKnown: true,
		};

		const volumeView = createVolumeView(dummyUi as never);
		const render = createRenderFn({
			tabId: 42,
			ui: dummyUi as never,
			state: dummyState as never,
			volumeView,
			getVizEnabled: () => false,
			getGlobalSettings: () => ({}) as never,
			getDictionary: () => ({ controlSyncing: 'Syncing', controlSyncUnavailable: 'Unable to confirm current controls' }) as never,
		});

		(globalThis as unknown as { document: unknown }).document = {
			createElement: () => ({ className: "", textContent: "", style: {} }),
		};
		render();
		expect(syncStatus.hidden).toBe(true);
		// A snapshot can contain volume without current playing. Exhausting that
		// field's recovery must stay visible even though the snapshot is known.
		dummyState.controlSyncExpired = true;
		render();
		expect(syncStatus.hidden).toBe(false);
		expect(syncStatus.textContent).toBe('Unable to confirm current controls');
		dummyState.controlSyncExpired = false;
		render();
		expect(syncStatus.hidden).toBe(true);

		// The card owns its own pixels; the Action badge has exactly one writer.
		// A Popup-side write carried the card's *own* mute flag, which is how a
		// stale render could repaint M over a freshly acknowledged unmute.
		expect(calls).toEqual([]);
	});
});

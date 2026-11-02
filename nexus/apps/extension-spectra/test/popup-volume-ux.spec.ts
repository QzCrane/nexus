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
import { actualVolumeColor, createRenderFn, gestureVolumeColor } from '../src/popup/card/render';
import { createVolumeView } from '../src/popup/card/volume-view';
import { mergeAudioConfig } from '../src/popup/card/types';

describe('Popup single effective-volume control', () => {
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

	test('derives color only from acknowledged capture state, never from volume threshold', () => {
		expect(actualVolumeColor(false, 350, 'bypass', 'active')).toBe(COLORS.NATIVE);
		expect(actualVolumeColor(false, 350, 'capture', 'starting')).toBe(COLORS.NATIVE);
		expect(actualVolumeColor(false, 80, 'capture', 'active')).toBe(COLORS.CAPTURE);
		expect(actualVolumeColor(false, 350, 'capture', 'active')).toBe(COLORS.CAPTURE);
		expect(actualVolumeColor(true, 350, 'capture', 'active')).toBe(COLORS.MUTED);
		expect(actualVolumeColor(false, 0, 'capture', 'active')).toBe(COLORS.MUTED);
	});

	test('gestureVolumeColor uses the same tone as the settled frame', () => {
		// An acknowledged active Capture owns the tone at every volume: the badge
		// and the slider must not repaint at the 100 boundary, because the route
		// did not change there. The gesture path used to disagree with the settled
		// path below 100, which is exactly the desync this asserts away.
		expect(gestureVolumeColor(false, 350, 'capture', 'active')).toBe(COLORS.CAPTURE);
		expect(gestureVolumeColor(false, 101, 'capture', 'active')).toBe(COLORS.CAPTURE);
		expect(gestureVolumeColor(false, 100, 'capture', 'active')).toBe(COLORS.CAPTURE);
		expect(gestureVolumeColor(false, 50, 'capture', 'active')).toBe(COLORS.CAPTURE);
		expect(gestureVolumeColor(false, 80, 'capture', 'active')).toBe(actualVolumeColor(false, 80, 'capture', 'active'));

		// Page-native sites (never hijack): volume > 100 strictly remains native blue
		const pageNativeSnapshot = {
			tabId: 1, documentId: 'doc1', origin: 'https://video.example', generation: 1, revision: 1,
			activeMedia: null, activeVideo: null,
			fields: { volumeBase: { phase: 'applied' as const, strategy: 'page-native' as const, actual: 110, revision: 1, controlled: true, lastError: null } },
		};
		expect(gestureVolumeColor(false, 110, 'bypass', 'idle', undefined, pageNativeSnapshot)).toBe(COLORS.NATIVE);
		expect(gestureVolumeColor(false, 350, 'bypass', 'idle', undefined, pageNativeSnapshot)).toBe(COLORS.NATIVE);

		// Dom-native sites: volume > 100 cannot be done natively, escalates to capture
		const domNativeSnapshot = {
			tabId: 1, documentId: 'doc1', origin: 'https://dom.example', generation: 1, revision: 1,
			activeMedia: null, activeVideo: null,
			fields: { volumeBase: { phase: 'applied' as const, strategy: 'dom-native' as const, actual: 100, revision: 1, controlled: true, lastError: null } },
		};
		expect(gestureVolumeColor(false, 101, 'bypass', 'idle', undefined, domNativeSnapshot)).toBe(COLORS.CAPTURE);

		// Unhijacked / bypass sites without explicit dom-native capture escalation: remain native blue
		expect(gestureVolumeColor(false, 110, 'bypass', 'idle')).toBe(COLORS.NATIVE);

		// Silence / muted
		expect(gestureVolumeColor(true, 350, 'capture', 'active')).toBe(COLORS.MUTED);
		expect(gestureVolumeColor(false, 0, 'capture', 'active')).toBe(COLORS.MUTED);
	});

	test('uses one volume-state truth table and fails closed on stale document identity', () => {
		expect(resolveAudioVolumeState({
			volume: 80, muted: false, actualMode: 'capture', phase: 'active',
		})).toBe('capture');
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

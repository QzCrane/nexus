import { describe, expect, test } from 'bun:test';
import { CapabilityPlanner, type CapabilityPlannerContext } from '@nexus/audio-engine';

const complete = { write: true, readback: true, coverage: 'full' } as const;
const active = { write: true, readback: true, coverage: 'active-target' } as const;
const safeMedia = (fullCoverage: boolean) => ({
	eligibility: 'proven' as const,
	fullCoverage,
	actualReadback: true,
});
const captureReady = {
	available: true,
	authorized: true,
	activationAvailable: true,
	actualReadback: true,
} as const;

function context(changes: Partial<CapabilityPlannerContext> = {}): CapabilityPlannerContext {
	return {
		explicitIntent: true,
		requiredCoverage: 'active-target',
		siteNative: {},
		domNative: {},
		chromeNative: {},
		extensionState: {},
		extensionCss: {},
		extensionOverlay: {},
		mediaWebAudio: { eligibility: 'unknown', fullCoverage: false, actualReadback: false },
		capture: { available: false, authorized: false, activationAvailable: false, actualReadback: false },
		activeProcessor: 'none',
		...changes,
	};
}

describe('per-field capability planner', () => {
	test('observes without activating a processing path when no explicit intent exists', () => {
		const planner = new CapabilityPlanner();
		expect(planner.plan('volumeBase', context({ explicitIntent: false }))).toMatchObject({
			strategy: 'observe',
			reason: 'observe-only',
		});
	});

	test('prefers a complete standard DOM writer before paying MAIN adapter cost', () => {
		const planner = new CapabilityPlanner();
		expect(planner.plan('speed', context({
			siteNative: { speed: complete },
			domNative: { speed: active },
			mediaWebAudio: safeMedia(true),
			capture: captureReady,
		}))).toMatchObject({ strategy: 'dom-native', coverage: 'active-target' });
	});

	test('uses the declared per-capability order instead of one global strategy order', () => {
		const planner = new CapabilityPlanner();
		expect(planner.plan('preservePitch', context({
			siteNative: { preservePitch: complete },
			domNative: { preservePitch: active },
		})).strategy).toBe('dom-native');
		expect(planner.plan('rotation', context({
			siteNative: { rotation: complete },
			extensionCss: { rotation: active },
		})).strategy).toBe('extension-css');
	});

	test('uses safe Media WebAudio for DSP and Capture only when safe coverage is unavailable', () => {
		const planner = new CapabilityPlanner();
		expect(planner.plan('pan', context({
			requiredCoverage: 'full',
			mediaWebAudio: safeMedia(true),
			capture: captureReady,
		})).strategy).toBe('media-webaudio');
		expect(planner.plan('pan', context({
			requiredCoverage: 'full',
			mediaWebAudio: safeMedia(false),
			capture: captureReady,
		}))).toMatchObject({ strategy: 'capture', coverage: 'opaque' });
	});

	test('does not use irreversible media binding as a CORS probe or start Capture without every gate', () => {
		const planner = new CapabilityPlanner();
		expect(planner.plan('eqValues', context({
			mediaWebAudio: { eligibility: 'unknown', fullCoverage: true, actualReadback: true },
			capture: captureReady,
		})).strategy).toBe('unsupported');
		expect(planner.plan('eqValues', context({
			requiredCoverage: 'full',
			mediaWebAudio: { eligibility: 'unknown', fullCoverage: true, actualReadback: true },
			capture: captureReady,
		}))).toMatchObject({ strategy: 'capture', coverage: 'opaque' });
		expect(planner.plan('eqValues', context({
			mediaWebAudio: safeMedia(false),
			capture: { ...captureReady, activationAvailable: false },
			requiredCoverage: 'full',
		})).strategy).toBe('unsupported');
		expect(planner.plan('eqValues', context({
			mediaWebAudio: safeMedia(false),
			capture: { ...captureReady, actualReadback: false },
			requiredCoverage: 'full',
		})).strategy).toBe('unsupported');
	});

	test('never widens a target-level volume, mute, or DSP request to whole-tab Capture', () => {
		const planner = new CapabilityPlanner();
		for (const capability of ['volumeBase', 'mediaMuted', 'boost', 'pan'] as const) {
			expect(planner.plan(capability, context({
				mediaWebAudio: safeMedia(true),
				capture: captureReady,
			}))).toMatchObject({
				strategy: 'unsupported',
			});
		}
	});

	test('never represents whole-tab Capture as page-native volume or media mute', () => {
		const planner = new CapabilityPlanner();
		for (const capability of ['volumeBase', 'mediaMuted'] as const) {
			expect(planner.plan(capability, context({
				requiredCoverage: 'full',
				capture: captureReady,
			}))).toMatchObject({ strategy: 'unsupported' });
		}
	});

	test('never routes speed, PiP, or fullscreen through WebAudio or Capture', () => {
		const planner = new CapabilityPlanner();
		const unavailable = context({
			mediaWebAudio: safeMedia(true),
			capture: captureReady,
		});
		expect(planner.plan('speed', unavailable).strategy).toBe('unsupported');
		expect(planner.plan('pip', unavailable).strategy).toBe('unsupported');
		expect(planner.plan('fullscreen', unavailable).strategy).toBe('unsupported');
	});

	test('uses Chrome native state for tab mute and rejects native writers without readback', () => {
		const planner = new CapabilityPlanner();
		expect(planner.plan('tabMuted', context({
			domNative: { tabMuted: complete },
			chromeNative: { tabMuted: complete },
		})).strategy).toBe('chrome-native');
		expect(planner.plan('volumeBase', context({
			domNative: { volumeBase: { ...active, readback: false } },
		})).strategy).toBe('unsupported');
	});

	test('uses only the declared controlled CSS, overlay, and state owners', () => {
		const planner = new CapabilityPlanner();
		expect(planner.plan('rotation', context({
			extensionCss: { rotation: active },
		})).strategy).toBe('extension-css');
		expect(planner.plan('dimEnabled', context({
			extensionOverlay: { dimEnabled: active },
		})).strategy).toBe('extension-overlay');
		expect(planner.plan('abLoop', context({
			extensionState: { abLoop: active },
		})).strategy).toBe('extension-state');
		expect(planner.plan('rotation', context({
			siteNative: { rotation: complete },
			extensionCss: { rotation: active },
		})).strategy).toBe('extension-css');
	});

	test('falls through after a proven native capability failure but never crosses a browser boundary', () => {
		const planner = new CapabilityPlanner();
		const candidates = context({
			siteNative: { speed: complete },
			domNative: { speed: active },
		});
		expect(planner.plan('speed', candidates, [{
			strategy: 'dom-native',
			failure: 'readback-mismatch',
		}])).toMatchObject({ strategy: 'site-native', reason: 'site-api-complete' });
		expect(planner.plan('speed', candidates, [{
			strategy: 'dom-native',
			failure: 'user-activation-required',
		}])).toMatchObject({
			strategy: 'unsupported',
			reason: 'boundary-blocked',
			terminalFailure: 'user-activation-required',
		});
	});

	test('plans momentary algorithms without pretending they are persistent snapshot fields', () => {
		const planner = new CapabilityPlanner();
		expect(planner.plan('screenshot', context({
			domNative: { screenshot: active },
			chromeNative: { screenshot: complete },
		})).strategy).toBe('chrome-native');
		expect(planner.plan('marker-add', context({
			extensionState: { 'marker-add': active },
		})).strategy).toBe('extension-state');
		expect(planner.plan('open-popup', context({
			chromeNative: { 'open-popup': complete },
		})).strategy).toBe('chrome-native');
		expect(planner.plan('show-info', context()).strategy).toBe('observe');
	});

	test('keeps frame-step on the implemented acknowledged DOM algorithm', () => {
		const planner = new CapabilityPlanner();
		const candidates = context({
			siteNative: { 'frame-step': active },
			domNative: { 'frame-step': active },
		});
		expect(planner.plan('frame-step', candidates)).toMatchObject({
			strategy: 'dom-native',
			reason: 'dom-api-complete',
		});
	});
});

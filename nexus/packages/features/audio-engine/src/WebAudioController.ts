// goal: own one page-lifetime MediaElementAudioSource graph for proven-safe media

import {
	audioConfigToProcessorConfig,
	type AudioConfig,
} from '@nexus/contracts';
import {
	AudioGraphRouter,
	type AudioGraphSnapshot,
} from './AudioGraphRouter.js';

export interface MediaSourceEligibilityEvidence {
	kind: 'preload-cors';
	resourceUrl: string;
}

export type MediaSourceEligibilityReason =
	| 'same-origin'
	| 'origin-owned-data'
	| 'origin-owned-blob'
	| 'explicit-preload-cors'
	| 'resource-unselected'
	| 'source-object-unproven'
	| 'cross-origin-unproven'
	| 'invalid-resource-url';

export interface MediaSourceEligibility {
	eligible: boolean;
	reason: MediaSourceEligibilityReason;
	resourceUrl: string;
}

export interface MediaSourceCoverageAssessment {
	eligibility: 'proven' | 'unknown' | 'unsafe';
	fullCoverage: boolean;
	total: number;
	eligible: number;
	failures: MediaSourceEligibility[];
}

interface MediaAudioRuntime {
	version: 3;
	context: AudioContext;
	router: AudioGraphRouter;
	sources: WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>;
	elements: Set<HTMLMediaElement>;
}

interface RuntimeScope extends Window {
	__SPECTRA_MEDIA_AUDIO_RUNTIME_V3__?: MediaAudioRuntime;
}

function pageOrigin(): string | null {
	try {
		const origin = globalThis.location?.origin;
		return origin && origin !== 'null' ? origin : null;
	} catch {
		return null;
	}
}

function resourceUrl(element: HTMLMediaElement): string {
	return element.currentSrc || element.src || '';
}

export function assessMediaSourceEligibility(
	element: HTMLMediaElement,
	evidence?: MediaSourceEligibilityEvidence,
): MediaSourceEligibility {
	const raw = resourceUrl(element);
	// srcObject owns playback even when an old src URL remains on the element.
	// URL/CORS evidence cannot prove the object-backed source safe to bind.
	if (element.srcObject != null) {
		return { eligible: false, reason: 'source-object-unproven', resourceUrl: raw };
	}
	if (!raw) return { eligible: false, reason: 'resource-unselected', resourceUrl: raw };
	if (evidence?.resourceUrl === raw) {
		return { eligible: true, reason: 'explicit-preload-cors', resourceUrl: raw };
	}
	if (raw.startsWith('data:')) {
		return { eligible: true, reason: 'origin-owned-data', resourceUrl: raw };
	}
	try {
		const base = globalThis.document?.baseURI || globalThis.location?.href;
		const url = new URL(raw, base);
		const origin = pageOrigin();
		if (url.protocol === 'blob:' && origin && url.origin === origin) {
			return { eligible: true, reason: 'origin-owned-blob', resourceUrl: url.href };
		}
		if (origin && url.origin === origin) {
			return { eligible: true, reason: 'same-origin', resourceUrl: url.href };
		}
		return { eligible: false, reason: 'cross-origin-unproven', resourceUrl: url.href };
	} catch {
		return { eligible: false, reason: 'invalid-resource-url', resourceUrl: raw };
	}
}

export function assessMediaSourceCoverage(
	elements: readonly HTMLMediaElement[],
	evidenceFor: (element: HTMLMediaElement) => MediaSourceEligibilityEvidence | undefined = () => undefined,
): MediaSourceCoverageAssessment {
	const assessments = elements.map((element) => assessMediaSourceEligibility(element, evidenceFor(element)));
	const failures = assessments.filter((assessment) => !assessment.eligible);
	const unsafe = failures.some((failure) => failure.reason !== 'resource-unselected');
	return {
		eligibility: elements.length === 0 || (!unsafe && failures.length > 0)
			? 'unknown'
			: unsafe ? 'unsafe' : 'proven',
		fullCoverage: elements.length > 0 && failures.length === 0,
		total: elements.length,
		eligible: assessments.length - failures.length,
		failures,
	};
}

export class WebAudioController {
	private runtime: MediaAudioRuntime | null = null;
	private readonly ownedSources = new Set<HTMLMediaElement>();
	private readonly bindingFailures = new WeakMap<HTMLMediaElement, string>();
	private visualizerRequested = false;
	private visualizerDisposer: (() => void) | null = null;

	private synchronizeVisualizer(): boolean {
		const active = this.visualizerRequested
			&& this.runtime !== null
			&& this.runtime.context.state !== 'closed'
			&& this.runtime.elements.size > 0;
		if (active && !this.visualizerDisposer) {
			this.visualizerDisposer = this.runtime?.router.subscribeVisualizer() ?? null;
		}
		if (!active && this.visualizerDisposer) {
			this.visualizerDisposer();
			this.visualizerDisposer = null;
		}
		return this.visualizerDisposer !== null;
	}

	async initialize(attemptResume = false): Promise<boolean> {
		const scope = window as RuntimeScope;
		const existing = scope.__SPECTRA_MEDIA_AUDIO_RUNTIME_V3__;
		if (existing?.version === 3 && existing.context.state !== 'closed') {
			this.runtime = existing;
			if (attemptResume && existing.context.state === 'suspended') {
				try { await existing.context.resume(); } catch { return false; }
			}
			this.synchronizeVisualizer();
			return existing.context.state === 'running';
		}
		try {
			const Constructor = window.AudioContext
				|| (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
			const context = new Constructor();
			const runtime: MediaAudioRuntime = {
				version: 3,
				context,
				router: new AudioGraphRouter(context),
				sources: new WeakMap(),
				elements: new Set(),
			};
			scope.__SPECTRA_MEDIA_AUDIO_RUNTIME_V3__ = runtime;
			this.runtime = runtime;
			if (attemptResume && context.state === 'suspended') await context.resume();
			this.synchronizeVisualizer();
			return context.state === 'running';
		} catch {
			return false;
		}
	}

	async bypass(): Promise<void> {
		if (!this.runtime || this.runtime.context.state === 'closed') return;
		await this.runtime.router.bypass();
	}

	isReady(): boolean {
		return this.runtime !== null && this.runtime.context.state !== 'closed';
	}

	ensureAttached(
		element: HTMLMediaElement,
		evidence?: MediaSourceEligibilityEvidence,
	): boolean {
		const runtime = this.runtime;
		if (!runtime || runtime.context.state === 'closed') return false;
		const eligibility = assessMediaSourceEligibility(element, evidence);
		if (!eligibility.eligible) return false;
		const existing = runtime.sources.get(element);
		if (existing) {
			if (!runtime.elements.has(element)) runtime.router.connectSource(existing);
			runtime.elements.add(element);
			this.ownedSources.add(element);
			this.bindingFailures.delete(element);
			this.synchronizeVisualizer();
			return true;
		}
		try {
			const source = runtime.context.createMediaElementSource(element);
			runtime.sources.set(element, source);
			runtime.elements.add(element);
			this.ownedSources.add(element);
			runtime.router.connectSource(source);
			this.bindingFailures.delete(element);
			this.synchronizeVisualizer();
			return true;
		} catch {
			this.bindingFailures.set(element, eligibility.resourceUrl);
			return false;
		}
	}

	detachNode(element: HTMLMediaElement): void {
		if (!this.ownedSources.delete(element)) return;
		if (!this.runtime?.elements.delete(element)) return;
		const source = this.runtime.sources.get(element);
		if (source) this.runtime.router.disconnectSource(source);
		this.synchronizeVisualizer();
	}

	hasKnownBindingFailure(element: HTMLMediaElement): boolean {
		return this.bindingFailures.get(element) === resourceUrl(element);
	}

	canAttachAll(
		elements: readonly HTMLMediaElement[],
		evidenceFor: (element: HTMLMediaElement) => MediaSourceEligibilityEvidence | undefined = () => undefined,
	): boolean {
		return assessMediaSourceCoverage(elements, evidenceFor).fullCoverage
			&& elements.every((element) => !this.hasKnownBindingFailure(element));
	}

	hasCompleteCoverage(
		elements: readonly HTMLMediaElement[],
		evidenceFor: (element: HTMLMediaElement) => MediaSourceEligibilityEvidence | undefined = () => undefined,
	): boolean {
		const runtime = this.runtime;
		return !!runtime
			&& runtime.context.state !== 'closed'
			&& assessMediaSourceCoverage(elements, evidenceFor).fullCoverage
			&& elements.every((element) => !this.hasKnownBindingFailure(element)
				&& runtime.sources.has(element)
				&& runtime.elements.has(element));
	}

	applyConfig(config: AudioConfig): Promise<AudioGraphSnapshot> {
		if (!this.runtime || this.runtime.elements.size === 0) {
			return Promise.reject(new Error('No proven media source is attached'));
		}
		return this.runtime.router.apply(audioConfigToProcessorConfig(config), { requireRunning: true });
	}

	getActualSnapshot(): AudioGraphSnapshot | null {
		return this.runtime?.router.getSnapshot() ?? null;
	}

	getVisualizerData(): Uint8Array | null {
		if (!this.synchronizeVisualizer()) return null;
		return this.runtime?.router.getVisualizerData() ?? null;
	}

	setVisualizerSubscribed(subscribed: boolean): boolean {
		this.visualizerRequested = subscribed;
		return this.synchronizeVisualizer();
	}

	dispose(): void {
		this.visualizerRequested = false;
		this.synchronizeVisualizer();
		for (const element of [...this.ownedSources]) this.detachNode(element);
	}
}

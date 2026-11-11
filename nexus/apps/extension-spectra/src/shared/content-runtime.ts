// goal: shared, side-effect-free content-runtime capability and bootstrap state helpers

import type { ContentRuntimeSourceOwnership, ContentRuntimeStatus, SpectraRequestType } from '@nexus/contracts';

export interface ContentBootstrapState {
	bootstrapRevision: string;
	runtimeRevision: string | null;
	ready: boolean;
	/**
	 * Monotonic media-report revision shared between the bootstrap and the
	 * runtime. Both content worlds mutate the same isolated-world state object,
	 * so the background's per-document ordering gate stays correct across the
	 * handoff instead of dropping the first runtime report after bootstrap
	 * reports (or vice versa).
	 */
	mediaReportRevision?: number;
	/** Shared across the bootstrap and full-runtime bundles for pause recency. */
	mediaPausedAt?: number | null;
	/**
	 * Document-lifetime latch: Chrome granted this document's `activeTab`
	 * invocation (action Popup, manifest command, or a Capture session that
	 * only could have started after one). The document-start hotkey gate reads
	 * it synchronously to keep Alt+Up on the content path. A stopped Capture
	 * session does not revoke the grant, so this never resets inside the
	 * document.
	 */
	extensionInvoked?: boolean;
	/** Never reset when the full runtime is replaced inside the same document. */
	mediaOwnerEpoch?: number;
	/**
	 * The full runtime has registered media in this document and is the
	 * observation owner. Until that is true the bootstrap keeps observing:
	 * injection alone is not proof that a runtime can see the page's player,
	 * and a ready runtime that never registered one must not silence the only
	 * observer that actually receives native volume events.
	 */
	runtimeObservesMedia?: boolean;
	disposeRuntime?: () => Promise<void>;
	getOwnedSources?: () => ContentRuntimeSourceOwnership[];
	getMediaIntent?: () => NonNullable<ContentRuntimeStatus['mediaIntentState']>;
	dispose(): void;
}

interface ContentBootstrapWindow extends Window {
	__SPECTRA_CONTENT_BOOTSTRAP__?: ContentBootstrapState;
}

const runtimeRequiredTypes: ReadonlySet<SpectraRequestType> = new Set([
	'spectra.audio.runtime.configure',
	'spectra.audio.visualizer.demand.set',
	'spectra.audio.visualizer.get',
	'spectra.control.intent.execute',
	'spectra.control.operation.execute',
	'spectra.control.actual.read',
	'spectra.control.page.scale.probe',
	'spectra.hotkey.trigger',
	'spectra.media.play.toggle',
	'spectra.media.pip.toggle',
	'spectra.media.speed.set',
	'spectra.video.rotate',
	'spectra.video.mirror.toggle',
	'spectra.video.screenshot',
	'spectra.video.fullscreen.toggle',
	'spectra.video.crop.toggle',
	'spectra.video.seek',
	'spectra.video.filter.set',
	'spectra.video.filter.reset',
	'spectra.video.dim.toggle',
	'spectra.video.ab.a.set',
	'spectra.video.ab.b.set',
	'spectra.video.ab.clear',
	'spectra.video.marker.add',
	'spectra.video.marker.remove',
	'spectra.video.marker.jump',
]);

export function requiresContentRuntime(type: SpectraRequestType): boolean {
	return runtimeRequiredTypes.has(type);
}

export function getContentBootstrapState(): ContentBootstrapState | undefined {
	if (typeof window === 'undefined') return undefined;
	return (window as ContentBootstrapWindow).__SPECTRA_CONTENT_BOOTSTRAP__;
}

/** One document clock for full-registry and passive-bootstrap ownership. */
export function claimMediaObservationEpoch(fallback = 0): number {
	const state = getContentBootstrapState();
	if (!state) return fallback;
	const epoch = (state.mediaOwnerEpoch ?? 0) + 1;
	state.mediaOwnerEpoch = epoch;
	return epoch;
}

export function setContentBootstrapState(state: ContentBootstrapState | undefined): void {
	const host = window as ContentBootstrapWindow;
	if (state) host.__SPECTRA_CONTENT_BOOTSTRAP__ = state;
	else delete host.__SPECTRA_CONTENT_BOOTSTRAP__;
}

export function setContentRuntimeReady(runtimeRevision: string | null): void {
	const state = getContentBootstrapState();
	if (!state) return;
	state.runtimeRevision = runtimeRevision;
	state.ready = runtimeRevision !== null;
}

/** Latch the document's invocation grant for the document-start hotkey gate. */
export function markContentExtensionInvoked(): void {
	const state = getContentBootstrapState();
	if (state) state.extensionInvoked = true;
}

/**
 * Alt+Up only needs the manifest command when the document has never been
 * invoked *and* the press would leave the native range. An invoked document
 * keeps its `activeTab` grant until navigation, even after Capture stops, so
 * 100 -> 110 stays on the content path.
 */
export function needsManifestVolumeCommand(
	extensionInvoked: boolean,
	mediaVolume: number | null,
): boolean {
	return !extensionInvoked && mediaVolume !== null && mediaVolume >= 0.999;
}

export function setContentRuntimeObservesMedia(observing: boolean): void {
	const state = getContentBootstrapState();
	if (!state) return;
	if (observing) state.runtimeObservesMedia = true;
	else delete state.runtimeObservesMedia;
}

export function setContentRuntimeDisposer(disposer: (() => Promise<void>) | null): void {
	const state = getContentBootstrapState();
	if (!state) return;
	if (disposer) state.disposeRuntime = disposer;
	else delete state.disposeRuntime;
}

export function setContentRuntimeOwnershipProvider(
	provider: (() => ContentRuntimeSourceOwnership[]) | null,
	mediaIntentProvider?: () => NonNullable<ContentRuntimeStatus['mediaIntentState']>,
): () => void {
	const state = getContentBootstrapState();
	if (!state) return () => undefined;
	if (provider) state.getOwnedSources = provider;
	else delete state.getOwnedSources;
	if (mediaIntentProvider) state.getMediaIntent = mediaIntentProvider;
	return () => {
		if (state.getOwnedSources === provider) delete state.getOwnedSources;
		if (state.getMediaIntent === mediaIntentProvider) delete state.getMediaIntent;
	};
}

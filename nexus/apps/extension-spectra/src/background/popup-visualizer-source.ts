// goal: one document-scoped Popup visualizer observation lease over the control snapshot

import type { ControlSnapshot } from '@nexus/contracts';
import {
	assertInvocationTargetCurrent,
	popupInvocation,
	sameExtensionDocument,
} from './extension-invocation';
import {
	awaitDocumentInitialization,
	ensureContentRuntime,
	releaseContentRuntimeLease,
} from './runtime-loader';
import { sendBackgroundTabRequestOnce } from './background-rpc';

export interface PopupVisualizerSourceLease {
	tabId: number;
	documentId: string;
	generation: number;
	runtimeRevision: string;
	capability: string;
	subscriberId: string;
	actualMode: 'bypass' | 'webaudio' | 'capture' | null;
}

export interface PopupVisualizerSourceAcquisition {
	lease: PopupVisualizerSourceLease;
	active: boolean;
	errorMessage: string | null;
}

export interface PopupVisualizerSource {
	acquire(tabId: number, subscriberId: string): Promise<PopupVisualizerSourceAcquisition>;
	release(lease: PopupVisualizerSourceLease): Promise<boolean>;
	abandon(lease: PopupVisualizerSourceLease): void;
}

// The control coordinator stays the only revision writer: this owner borrows its
// per-tab serialization and current-document snapshot instead of re-deriving them.
export interface PopupVisualizerSourceDeps {
	runExclusive<T>(tabId: number, operation: () => Promise<T>): Promise<T>;
	getOrCreateSnapshot(tabId: number): Promise<ControlSnapshot>;
}

export function createPopupVisualizerSource(
	deps: PopupVisualizerSourceDeps,
): PopupVisualizerSource {
	// post: a visible Popup retains one document-scoped observation subscription.
	// It may use a safe page analyser or an existing DSP processor, but never grants
	// Capture admission. A bypass ACK is a settled inactive subscription, not failure.
	async function acquire(
		tabId: number,
		subscriberId: string,
	): Promise<PopupVisualizerSourceAcquisition> {
		const invocation = await popupInvocation(tabId);
		if (!sameExtensionDocument(invocation.foreground, invocation.target)) {
			throw new Error('Visualizer observation requires the current foreground Popup tab');
		}
		await awaitDocumentInitialization(tabId, invocation.target.documentId);
		return deps.runExclusive(tabId, async () => {
			await assertInvocationTargetCurrent(tabId, invocation);
			const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
			if (tabs[0]?.id !== tabId) {
				throw new Error('Visualizer observation target is no longer foreground');
			}
			const snapshot = await deps.getOrCreateSnapshot(tabId);
			const capability = `visualizer:${crypto.randomUUID()}`;
			let runtime: Awaited<ReturnType<typeof ensureContentRuntime>> | null = null;
			try {
				runtime = await ensureContentRuntime(
					tabId,
					snapshot.documentId,
					'visualizer',
					capability,
				);
				if (runtime.documentId !== snapshot.documentId) {
					throw new Error('Visualizer runtime lease belongs to a stale document');
				}
				const pendingLease: PopupVisualizerSourceLease = {
					tabId,
					documentId: snapshot.documentId,
					generation: snapshot.generation,
					runtimeRevision: runtime.runtimeRevision,
					capability,
					subscriberId,
					actualMode: null,
				};
				try {
					const response = await sendBackgroundTabRequestOnce(
						tabId,
						'spectra.audio.visualizer.demand.set',
						{ subscriberId, enabled: true },
						{ documentId: snapshot.documentId, generation: snapshot.generation },
					);
					if (!response.ok) {
						return {
							lease: pendingLease,
							active: false,
							errorMessage: `${response.error.code}: ${response.error.message}`,
						};
					}
					if ((response.data.actualMode !== 'webaudio'
						&& response.data.actualMode !== 'capture')
						|| response.data.phase !== 'active') {
						if (response.data.actualMode === 'bypass' && response.data.phase === 'idle') {
							return {
								lease: { ...pendingLease, generation: response.data.generation, actualMode: 'bypass' },
								active: false,
								errorMessage: null,
							};
						}
						return {
							lease: pendingLease,
							active: false,
							errorMessage: response.data.lastError?.message
								?? 'Visualizer demand did not acknowledge an active analyser source',
						};
					}
					return {
						lease: {
							...pendingLease,
							generation: response.data.generation,
							actualMode: response.data.actualMode,
						},
						active: true,
						errorMessage: null,
					};
				} catch (error) {
					// Once the runtime lease exists, delivery becomes an ambiguous commit:
					// Content may have installed the subscriber even when its ACK is lost.
					// Return the pending owner so Background can retry an idempotent release.
					return {
						lease: pendingLease,
						active: false,
						errorMessage: error instanceof Error ? error.message : String(error),
					};
				}
			} catch (error) {
				if (runtime) {
					releaseContentRuntimeLease(tabId, runtime.documentId, 'visualizer', capability);
				}
				throw error;
			}
		});
	}

	// post: returns false only when the current document still needs a retry; stale
	// documents are already retired by the browser navigation fence.
	function release(lease: PopupVisualizerSourceLease): Promise<boolean> {
		return deps.runExclusive(lease.tabId, async () => {
			let frame: { documentId?: string } | null | undefined;
			try {
				frame = await chrome.webNavigation.getFrame({
					tabId: lease.tabId,
					frameId: 0,
				});
			} catch {
				// A transient browser-query failure is not proof that the document was
				// replaced. Retain the owner so the bounded reconciler can try again.
				return false;
			}
			if (!frame) return false;
			if (frame?.documentId !== lease.documentId) {
				releaseContentRuntimeLease(
					lease.tabId,
					lease.documentId,
					'visualizer',
					lease.capability,
				);
				return true;
			}
			try {
				const response = await sendBackgroundTabRequestOnce(
					lease.tabId,
					'spectra.audio.visualizer.demand.set',
					{ subscriberId: lease.subscriberId, enabled: false },
					{ documentId: lease.documentId, generation: lease.generation },
				);
				if (!response.ok) return false;
				if (response.data.actualMode === 'capture' && response.data.phase === 'error') return false;
				releaseContentRuntimeLease(
					lease.tabId,
					lease.documentId,
					'visualizer',
					lease.capability,
				);
				return true;
			} catch {
				return false;
			}
		});
	}

	function abandon(lease: PopupVisualizerSourceLease): void {
		releaseContentRuntimeLease(
			lease.tabId,
			lease.documentId,
			'visualizer',
			lease.capability,
		);
	}

	return { acquire, release, abandon };
}

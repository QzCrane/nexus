// goal: detects SPA route changes to refresh site-specific configs
// note: monkeypatching History API for pushState/replaceState

import { isExtensionContextValid } from '../context-guard';
import { createEventListener, createCleanupManager } from '../../utils/timing';
import type { PolicyExecutor } from '../../logic/policy-executor';
// note: site cache management is now handled by the bridge instance itself during re-matching

interface NavigationObserverDeps {
	policyExecutor: PolicyExecutor;
	onNavigate: () => void;
}

export function getDocumentRouteIdentity(location: Pick<Location, 'origin' | 'pathname' | 'search' | 'hash'>): string {
	return `${location.origin}${location.pathname}${location.search}${location.hash}`;
}

export const SPECTRA_SAME_DOCUMENT_NAVIGATION_EVENT = 'spectra:same-document-navigation';

export function createNavigationObserver(deps: NavigationObserverDeps): () => void {
	const { policyExecutor, onNavigate } = deps;
	const cleanup = createCleanupManager();
	let lastRoute = getDocumentRouteIdentity(window.location);

	const handleNav = () => {
		if (!isExtensionContextValid()) return;
		const currentRoute = getDocumentRouteIdentity(window.location);
		if (currentRoute === lastRoute) return;

		// Invalidate the previous document generation immediately. Delaying this
		// behind a debounce would leave a window in which an ACK from the previous
		// query/hash route could still be accepted.
		lastRoute = currentRoute;
		policyExecutor.probeCors();
		onNavigate();
	};

	cleanup.add(createEventListener(window, 'popstate', handleNav));
	cleanup.add(createEventListener(window, 'hashchange', handleNav));
	cleanup.add(createEventListener(window, SPECTRA_SAME_DOCUMENT_NAVIGATION_EVENT, handleNav));

	const origPush = history.pushState;
	const origReplace = history.replaceState;
	history.pushState = function (...args) { origPush.apply(this, args); handleNav(); };
	history.replaceState = function (...args) { origReplace.apply(this, args); handleNav(); };

	cleanup.add(() => {
		history.pushState = origPush;
		history.replaceState = origReplace;
	});

	return cleanup.dispose;
}

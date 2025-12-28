/**
 * Content Script - SPA Navigation Observer
 * 
 * Responsibilities:
 * - Listen for SPA route changes (popstate, pushState, replaceState)
 * - Reset CORS state and re-probe on URL change
 * 
 * Cost: Low (Event-driven, no polling)
 */

import { isExtensionContextValid } from '../context-guard';
import type { PolicyExecutor } from '../policy-executor';

interface NavigationObserverDeps {
	policyExecutor: PolicyExecutor;
	onNavigate: () => void;  // Navigation callback
}

/**
 * Create SPA Navigation Observer
 * 
 * @returns Cleanup function
 */
export function createNavigationObserver(deps: NavigationObserverDeps): () => void {
	const { policyExecutor, onNavigate } = deps;

	let lastPathname = window.location.pathname;
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	// Debounce navigation events
	const handleNavigation = () => {
		if (!isExtensionContextValid()) return;

		const currentPathname = window.location.pathname;

		// Only handle path changes (ignore hash/query)
		if (currentPathname === lastPathname) return;

		lastPathname = currentPathname;

		// Debounce: Process once per 300ms
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			if (!isExtensionContextValid()) return;

			// Trigger CORS re-probe
			policyExecutor.probeCors();
			onNavigate();
		}, 300);
	};

	// Listen for popstate (Back/Forward)
	window.addEventListener('popstate', handleNavigation);

	// Intercept history.pushState - Async to avoid blocking
	const originalPushState = history.pushState;
	history.pushState = function (...args) {
		originalPushState.apply(this, args);
		setTimeout(handleNavigation, 0);  // Async to avoid blocking
	};

	// Intercept history.replaceState - Async to avoid blocking
	const originalReplaceState = history.replaceState;
	history.replaceState = function (...args) {
		originalReplaceState.apply(this, args);
		setTimeout(handleNavigation, 0);  // Async to avoid blocking
	};

	// Return cleanup function
	return () => {
		if (debounceTimer) clearTimeout(debounceTimer);
		window.removeEventListener('popstate', handleNavigation);
		history.pushState = originalPushState;
		history.replaceState = originalReplaceState;
	};
}

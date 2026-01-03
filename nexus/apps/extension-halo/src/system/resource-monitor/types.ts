// goal: Resource Monitor type definitions - ultra-precise CPU consumption taxonomy
// inv: Every resource consumer must be categorized by mechanism, frequency, and impact

export type ImpactLevel = 'critical' | 'high' | 'medium' | 'low' | 'idle';

// Precise CPU consumption mechanism taxonomy
export type ConsumptionMechanism =
	| 'interval_fast'     // setInterval < 1s (high CPU)
	| 'interval_slow'     // setInterval >= 1s (medium CPU)
	| 'raf_active'        // requestAnimationFrame in loop (high CPU when active)
	| 'raf_idle'          // requestAnimationFrame at rest
	| 'event_listener'    // DOM/Chrome event listeners (idle until triggered)
	| 'storage_listener'  // chrome.storage.onChanged (idle until triggered)
	| 'message_listener'  // chrome.runtime.onMessage (idle until triggered)
	| 'mutation_observer' // MutationObserver (depends on DOM changes)
	| 'service_worker'    // Background service worker (event-driven)
	| 'content_script'    // Injected content script
	| 'userscript';       // User-defined script

export type ResourceType =
	| 'cpu'       // CPU cycles
	| 'memory'    // Memory allocation
	| 'network'   // Network requests
	| 'battery'   // Battery drain
	| 'injection' // DOM injection
	| 'render';   // Paint/Layout

export interface ResourceImpact {
	level: ImpactLevel;
	types: ResourceType[];
	mechanism: ConsumptionMechanism;
	descriptionKey: string;

	// Precise metrics
	frequency?: string;        // e.g., "1s", "16ms", "on-demand"
	activeOnly?: boolean;      // true if only consumes when active
	canDisable?: boolean;      // true if user can disable
	estimatedCpuMs?: number;   // estimated CPU ms per second when active
}

export interface MonitoredService {
	id: string;
	name: string;
	icon: string;
	active: boolean;
	toolType: 'script' | 'service' | 'userscript' | 'system';
	impact: ResourceImpact;
	source: 'builtin' | 'user';
}

// CPU impact score (0-100) for sorting
export function calculateImpactScore(impact: ResourceImpact, isActive: boolean): number {
	if (!isActive && impact.activeOnly) return 0;

	const levelScore: Record<ImpactLevel, number> = {
		critical: 100,
		high: 75,
		medium: 50,
		low: 25,
		idle: 5
	};

	const mechanismMultiplier: Record<ConsumptionMechanism, number> = {
		interval_fast: 1.5,
		raf_active: 1.4,
		interval_slow: 1.0,
		mutation_observer: 0.9,
		raf_idle: 0.3,
		event_listener: 0.2,
		storage_listener: 0.15,
		message_listener: 0.1,
		content_script: 0.5,
		userscript: 0.6,
		service_worker: 0.1
	};

	return Math.round(levelScore[impact.level] * mechanismMultiplier[impact.mechanism]);
}

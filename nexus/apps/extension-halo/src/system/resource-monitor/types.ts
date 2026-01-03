// goal: Resource Monitor types - precise CPU consumption taxonomy
// inv: Only record REAL consumption mechanisms and frequencies, no estimates

export type ImpactLevel = 'high' | 'medium' | 'low' | 'idle';

// Precise CPU consumption mechanism taxonomy (11 types)
export type ConsumptionMechanism =
	| 'interval_fast'     // setInterval < 1s
	| 'interval_slow'     // setInterval >= 1s
	| 'raf_active'        // requestAnimationFrame in loop
	| 'raf_idle'          // requestAnimationFrame at rest
	| 'event_listener'    // DOM/Chrome event listeners
	| 'storage_listener'  // chrome.storage.onChanged
	| 'message_listener'  // chrome.runtime.onMessage
	| 'mutation_observer' // MutationObserver
	| 'service_worker'    // Background service worker
	| 'content_script'    // Injected content script
	| 'userscript';       // User-defined script

export type ResourceType = 'cpu' | 'memory' | 'network' | 'injection' | 'render';

export interface ResourceImpact {
	level: ImpactLevel;
	mechanism: ConsumptionMechanism;
	types: ResourceType[];
	descriptionKey: string;
	frequency: string;        // Real trigger frequency: "16ms", "1s", "on-copy", "page-load"
	activeOnly: boolean;      // True if only consumes when panel is open
	canDisable?: boolean;
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

// Impact level to display properties
export const LEVEL_CONFIG: Record<ImpactLevel, { color: string; bg: string; label: string }> = {
	high: { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)', label: 'HIGH' },
	medium: { color: '#eab308', bg: 'rgba(234, 179, 8, 0.12)', label: 'MED' },
	low: { color: '#22c55e', bg: 'rgba(34, 197, 94, 0.1)', label: 'LOW' },
	idle: { color: 'var(--halo-text-muted)', bg: 'var(--halo-bg-tertiary)', label: 'IDLE' }
};

// Mechanism icons for UI
export const MECHANISM_ICONS: Record<ConsumptionMechanism, string> = {
	interval_fast: '⏱️',
	interval_slow: '🕐',
	raf_active: '🎬',
	raf_idle: '💤',
	event_listener: '👂',
	storage_listener: '💾',
	message_listener: '📨',
	mutation_observer: '👁️',
	service_worker: '⚙️',
	content_script: '📜',
	userscript: '🔧'
};

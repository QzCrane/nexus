// goal: Resource Monitor types - full SSOT with source annotations + i18n
// inv: Every background consumer has exact source file:line annotation

export type ImpactLevel = 'high' | 'medium' | 'low' | 'idle';

export type ConsumptionMechanism =
	| 'interval_fast'     // setInterval < 1s (10ms, 100ms, etc.)
	| 'interval_slow'     // setInterval >= 1s (1000ms, 2000ms, etc.)
	| 'raf_active'        // requestAnimationFrame in active loop
	| 'raf_idle'          // requestAnimationFrame at rest
	| 'event_listener'    // DOM/Chrome event listeners (on-demand)
	| 'storage_listener'  // chrome.storage.onChanged listener
	| 'message_listener'  // chrome.runtime.onMessage listener
	| 'wheel_listener'    // window wheel event listener
	| 'copy_listener'     // document copy event listener
	| 'mutation_observer' // MutationObserver
	| 'service_worker'    // Background service worker lifecycle
	| 'content_script'    // Injected content script
	| 'userscript';       // User-defined script

// Detailed background profile with source annotation
export interface BackgroundProfile {
	mechanism: ConsumptionMechanism;
	frequency: string;           // Real frequency: "10ms", "1s", "200ms", "on-change", etc.
	activeOnly: boolean;         // Only consumes when panel is open
	level: ImpactLevel;
	descriptionKey: string;      // i18n key for description
	sourceFile: string;          // Source file path (relative to src/)
	sourceLine: number;          // Line number in source file
	sourceDetail?: string;       // Code detail (optional)
}

// System-level background consumers (entry files)
export interface SystemConsumer {
	id: string;
	name: string;                // Display name (i18n key)
	icon: string;
	profiles: BackgroundProfile[];
}

export interface MonitoredService {
	id: string;
	name: string;
	icon: string;
	active: boolean;
	category: 'tool' | 'system' | 'script' | 'core';
	profiles: BackgroundProfile[];
}

// Level config with i18n keys
export const LEVEL_CONFIG: Record<ImpactLevel, { color: string; bg: string; labelKey: string }> = {
	high: { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)', labelKey: 'impact.level.high' },
	medium: { color: '#eab308', bg: 'rgba(234, 179, 8, 0.12)', labelKey: 'impact.level.medium' },
	low: { color: '#22c55e', bg: 'rgba(34, 197, 94, 0.1)', labelKey: 'impact.level.low' },
	idle: { color: 'var(--halo-text-muted)', bg: 'var(--halo-bg-tertiary)', labelKey: 'impact.level.idle' }
};

// Mechanism icons (fast/slow use same icon since distinction is in frequency)
export const MECHANISM_ICONS: Record<ConsumptionMechanism, string> = {
	interval_fast: '⏱️', interval_slow: '⏱️',  // unified timer icon
	raf_active: '🎬', raf_idle: '🎬',           // unified animation icon
	event_listener: '👂', storage_listener: '💾', message_listener: '📨',
	wheel_listener: '🖱️', copy_listener: '📋',
	mutation_observer: '👁️', service_worker: '⚙️', content_script: '📜', userscript: '🔧'
};

// =========================================================
// SYSTEM CORE CONSUMERS (entry files - always running)
// These are the Halo system-level background consumers
// =========================================================
export const SYSTEM_CORE_CONSUMERS: SystemConsumer[] = [
	{
		id: 'core:background',
		name: 'system.background',
		icon: '⚙️',
		profiles: [
			{
				mechanism: 'message_listener',
				frequency: 'on-message',
				activeOnly: false,
				level: 'idle',
				descriptionKey: 'impact.message_handler',
				sourceFile: 'entry/background.ts',
				sourceLine: 149,
				sourceDetail: 'chrome.runtime.onMessage.addListener'
			},
			{
				mechanism: 'storage_listener',
				frequency: 'on-change',
				activeOnly: false,
				level: 'idle',
				descriptionKey: 'impact.storage_sync',
				sourceFile: 'entry/background.ts',
				sourceLine: 165,
				sourceDetail: 'chrome.storage.onChanged.addListener'
			}
		]
	},
	{
		id: 'core:content',
		name: 'system.content',
		icon: '📄',
		profiles: [
			{
				mechanism: 'copy_listener',
				frequency: 'on-copy',
				activeOnly: false,
				level: 'idle',
				descriptionKey: 'impact.copy_listener',
				sourceFile: 'entry/content.ts',
				sourceLine: 39,
				sourceDetail: "document.addEventListener('copy', onCopy)"
			},
			{
				mechanism: 'storage_listener',
				frequency: 'on-change',
				activeOnly: false,
				level: 'idle',
				descriptionKey: 'impact.storage_sync',
				sourceFile: 'entry/content.ts',
				sourceLine: 56,
				sourceDetail: 'chrome.storage.onChanged.addListener'
			},
			{
				mechanism: 'message_listener',
				frequency: 'on-message',
				activeOnly: false,
				level: 'idle',
				descriptionKey: 'impact.message_handler',
				sourceFile: 'entry/content.ts',
				sourceLine: 64,
				sourceDetail: 'chrome.runtime.onMessage.addListener'
			}
		]
	},
	{
		id: 'core:sidepanel',
		name: 'system.sidepanel',
		icon: '📱',
		profiles: [
			{
				mechanism: 'wheel_listener',
				frequency: 'on-scroll',
				activeOnly: true,
				level: 'low',
				descriptionKey: 'impact.wheel_listener',
				sourceFile: 'entry/sidepanel-init.ts',
				sourceLine: 110,
				sourceDetail: "window.addEventListener('wheel', onWheel)"
			},
			{
				mechanism: 'storage_listener',
				frequency: 'on-change',
				activeOnly: true,
				level: 'idle',
				descriptionKey: 'impact.storage_sync',
				sourceFile: 'entry/sidepanel-init.ts',
				sourceLine: 121,
				sourceDetail: 'chrome.storage.onChanged.addListener'
			}
		]
	}
];

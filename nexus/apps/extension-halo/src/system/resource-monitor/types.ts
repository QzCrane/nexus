// goal: Resource Monitor types - runtime-consumption profiles with source annotations + i18n
// inv: Every listed profile resolves to its live source owner; no historical or inferred owner rows.

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

export interface BackgroundProfile {
	mechanism: ConsumptionMechanism;
	frequency: string;
	activeOnly: boolean;
	level: ImpactLevel;
	descriptionKey: string;
	sourceFile: string;
	sourceLine: number;
	sourceDetail?: string;
}

export interface SystemConsumer {
	id: string;
	name: string;
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

export const LEVEL_CONFIG: Record<ImpactLevel, { color: string; bg: string; labelKey: string }> = {
	high: { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)', labelKey: 'impact.level.high' },
	medium: { color: '#eab308', bg: 'rgba(234, 179, 8, 0.12)', labelKey: 'impact.level.medium' },
	low: { color: '#22c55e', bg: 'rgba(34, 197, 94, 0.1)', labelKey: 'impact.level.low' },
	idle: { color: 'var(--halo-text-muted)', bg: 'var(--halo-bg-tertiary)', labelKey: 'impact.level.idle' },
};

export const MECHANISM_ICONS: Record<ConsumptionMechanism, string> = {
	interval_fast: '⏱️', interval_slow: '🕐',
	raf_active: '🎬', raf_idle: '💤',
	event_listener: '👂', storage_listener: '💾', message_listener: '📨',
	wheel_listener: '🖱️', copy_listener: '📋',
	mutation_observer: '👁️', service_worker: '⚙️', content_script: '📜', userscript: '🔧',
};

// Infrastructure listeners that exist independently of one tool panel. Plugin
// manifests own each plugin's primary resource-impact profile; this table owns
// shared browser/runtime surfaces. One-shot initialization work is intentionally
// excluded from this long-lived-listener ledger.
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
				sourceLine: 202,
				sourceDetail: 'chrome.runtime.onMessage.addListener',
			},
		],
	},
	{
		id: 'core:content-router',
		name: 'system.content',
		icon: '📄',
		profiles: [
			{
				mechanism: 'message_listener',
				frequency: 'on-message',
				activeOnly: false,
				level: 'idle',
				descriptionKey: 'impact.message_handler',
				sourceFile: 'entry/content.ts',
				sourceLine: 22,
				sourceDetail: 'chrome.runtime.onMessage.addListener',
			},
		],
	},
	{
		id: 'core:frame-tools',
		name: 'system.content',
		icon: '📐',
		profiles: [
			{
				mechanism: 'message_listener',
				frequency: 'on-message',
				activeOnly: false,
				level: 'idle',
				descriptionKey: 'impact.message_handler',
				sourceFile: 'entry/content-frame-tools.ts',
				sourceLine: 64,
				sourceDetail: 'minimal all-frame lazy chrome.runtime.onMessage bootstrap',
			},
		],
	},
	{
		id: 'core:userscripts-engine',
		name: 'tools.userscripts.name',
		icon: '📜',
		profiles: [
			{
				mechanism: 'message_listener',
				frequency: 'on-message',
				activeOnly: false,
				level: 'idle',
				descriptionKey: 'impact.message_handler',
				sourceFile: 'system/userscripts/engine.ts',
				sourceLine: 65,
				sourceDetail: 'manual sync and run-count message router',
			},
		],
	},
	{
		id: 'core:saat-service',
		name: 'system.background',
		icon: '🧩',
		profiles: [
			{
				mechanism: 'storage_listener',
				frequency: 'on-change',
				activeOnly: false,
				level: 'idle',
				descriptionKey: 'impact.storage_sync',
				sourceFile: 'kernel/services/saat-service.ts',
				sourceLine: 319,
				sourceDetail: 'Tool Prefs authority listener for SaaT enablement',
			},
		],
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
				sourceFile: 'entry/sidepanel-scroll.ts',
				sourceLine: 213,
				sourceDetail: "window.addEventListener('wheel', onWheel)",
			},
			{
				mechanism: 'storage_listener',
				frequency: 'on-change',
				activeOnly: true,
				level: 'idle',
				descriptionKey: 'impact.storage_sync',
				sourceFile: 'entry/sidepanel-scroll.ts',
				sourceLine: 231,
				sourceDetail: 'SidePanel smooth-scroll settings listener',
			},
			{
				mechanism: 'storage_listener',
				frequency: 'on-change',
				activeOnly: true,
				level: 'idle',
				descriptionKey: 'impact.storage_sync',
				sourceFile: 'components/sidepanel/ActiveServicesContext.tsx',
				sourceLine: 228,
				sourceDetail: 'single SidePanel runtime-status storage authority',
			},
			{
				mechanism: 'message_listener',
				frequency: 'on-message',
				activeOnly: true,
				level: 'idle',
				descriptionKey: 'impact.message_handler',
				sourceFile: 'components/sidepanel/use-sidepanel-state.ts',
				sourceLine: 97,
				sourceDetail: 'HALO_ACTIVATE_TOOL side-panel router',
			},
		],
	},
];

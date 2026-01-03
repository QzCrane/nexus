// goal: Resource Monitor types - consume from generated registry SSOT
// inv: All background profiles come from manifest.json via BACKGROUND_PROFILES_MAP

// Re-export types from generated registry
export type { BackgroundProfile } from '../../kernel/registry/_generated';

export type ImpactLevel = 'high' | 'medium' | 'low' | 'idle';
export type ConsumptionMechanism =
	| 'interval_fast' | 'interval_slow'
	| 'raf_active' | 'raf_idle'
	| 'event_listener' | 'storage_listener' | 'message_listener'
	| 'mutation_observer' | 'service_worker' | 'content_script' | 'userscript';

export interface MonitoredService {
	id: string;
	name: string;
	icon: string;
	active: boolean;
	mechanism: ConsumptionMechanism;
	frequency: string;
	level: ImpactLevel;
	descriptionKey: string;
	activeOnly: boolean;
}

// Level display config
export const LEVEL_CONFIG: Record<ImpactLevel, { color: string; bg: string; label: string }> = {
	high: { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)', label: 'HIGH' },
	medium: { color: '#eab308', bg: 'rgba(234, 179, 8, 0.12)', label: 'MED' },
	low: { color: '#22c55e', bg: 'rgba(34, 197, 94, 0.1)', label: 'LOW' },
	idle: { color: 'var(--halo-text-muted)', bg: 'var(--halo-bg-tertiary)', label: 'IDLE' }
};

// Mechanism icons
export const MECHANISM_ICONS: Record<ConsumptionMechanism, string> = {
	interval_fast: '⏱️', interval_slow: '🕐',
	raf_active: '🎬', raf_idle: '💤',
	event_listener: '👂', storage_listener: '💾', message_listener: '📨',
	mutation_observer: '👁️', service_worker: '⚙️', content_script: '📜', userscript: '🔧'
};

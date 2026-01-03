// goal: Resource Monitor analysis engine - ultra-precise CPU consumption detection
// inv: Every background consumer must be identified by exact mechanism

import { ToolMeta } from '../../kernel';
import type { ResourceImpact, ConsumptionMechanism, ImpactLevel } from './types';

// Known tool-specific impact profiles (hardcoded SSOT)
const TOOL_IMPACT_PROFILES: Record<string, Partial<ResourceImpact>> = {
	'smooth-scroll': {
		level: 'medium',
		mechanism: 'raf_active',
		types: ['cpu', 'render'],
		descriptionKey: 'impact.raf_scroll',
		frequency: '16ms',
		activeOnly: true,
		estimatedCpuMs: 8
	},
	'clipboard': {
		level: 'idle',
		mechanism: 'event_listener',
		types: ['memory'],
		descriptionKey: 'impact.copy_listener',
		frequency: 'on-copy',
		activeOnly: false,
		estimatedCpuMs: 0
	},
	'userscripts': {
		level: 'low',
		mechanism: 'storage_listener',
		types: ['cpu', 'injection'],
		descriptionKey: 'impact.userscripts_registry',
		frequency: 'on-change',
		activeOnly: false,
		estimatedCpuMs: 1
	},
	'totp': {
		level: 'medium',
		mechanism: 'interval_slow',
		types: ['cpu'],
		descriptionKey: 'impact.interval_1s',
		frequency: '1s',
		activeOnly: true,
		estimatedCpuMs: 5
	},
	'timestamp': {
		level: 'low',
		mechanism: 'interval_slow',
		types: ['cpu'],
		descriptionKey: 'impact.interval_1s',
		frequency: '1s',
		activeOnly: true,
		estimatedCpuMs: 1
	},
	'timer': {
		level: 'low',
		mechanism: 'interval_slow',
		types: ['cpu'],
		descriptionKey: 'impact.timer_running',
		frequency: 'dynamic',
		activeOnly: true,
		estimatedCpuMs: 1
	},
	'pomodoro': {
		level: 'low',
		mechanism: 'interval_slow',
		types: ['cpu'],
		descriptionKey: 'impact.timer_running',
		frequency: 'dynamic',
		activeOnly: true,
		estimatedCpuMs: 1
	},
	'text-to-speech': {
		level: 'low',
		mechanism: 'interval_slow',
		types: ['cpu'],
		descriptionKey: 'impact.progress_update',
		frequency: 'during-playback',
		activeOnly: true,
		estimatedCpuMs: 2
	},
	'tab-group': {
		// Now event-driven after optimization!
		level: 'idle',
		mechanism: 'event_listener',
		types: ['memory'],
		descriptionKey: 'impact.tab_events',
		frequency: 'on-change',
		activeOnly: true,
		estimatedCpuMs: 0
	},
	'resource-monitor': {
		level: 'idle',
		mechanism: 'storage_listener',
		types: ['cpu'],
		descriptionKey: 'impact.self_monitoring',
		frequency: 'on-demand',
		activeOnly: true,
		estimatedCpuMs: 0
	}
};

// Permission-based impact analysis
function analyzeByPermissions(meta: ToolMeta): Partial<ResourceImpact> {
	// Network interceptors (high cost)
	if (meta.permissions?.includes('webRequest') ||
		meta.permissions?.includes('declarativeNetRequest')) {
		return {
			level: 'high',
			mechanism: 'event_listener',
			types: ['network', 'cpu'],
			descriptionKey: 'impact.network_interceptor',
			estimatedCpuMs: 10
		};
	}

	// WebNavigation (medium cost)
	if (meta.permissions?.includes('webNavigation')) {
		return {
			level: 'medium',
			mechanism: 'event_listener',
			types: ['cpu'],
			descriptionKey: 'impact.navigation_listener',
			estimatedCpuMs: 3
		};
	}

	return {};
}

// Script type analysis
function analyzeScriptType(meta: ToolMeta): ResourceImpact {
	if (meta.toolType === 'script') {
		const runAt = meta.scriptRunAt || 'document_idle';

		if (runAt === 'document_start') {
			return {
				level: 'medium',
				mechanism: 'content_script',
				types: ['cpu', 'injection'],
				descriptionKey: 'impact.injection_start',
				frequency: 'page-load',
				activeOnly: false,
				estimatedCpuMs: 5
			};
		}

		return {
			level: 'low',
			mechanism: 'content_script',
			types: ['injection'],
			descriptionKey: 'impact.injection_idle',
			frequency: 'page-load',
			activeOnly: false,
			estimatedCpuMs: 2
		};
	}

	// Default background service
	return {
		level: 'low',
		mechanism: 'service_worker',
		types: ['memory'],
		descriptionKey: 'impact.background_idle',
		frequency: 'on-demand',
		activeOnly: false,
		estimatedCpuMs: 0
	};
}

// Main analysis function - produces precise impact profile
export function analyzeImpact(meta: ToolMeta): ResourceImpact {
	// 1. Check for known tool-specific profile (highest priority)
	const knownProfile = TOOL_IMPACT_PROFILES[meta.id];
	if (knownProfile && knownProfile.level && knownProfile.mechanism) {
		return {
			level: knownProfile.level as ImpactLevel,
			mechanism: knownProfile.mechanism as ConsumptionMechanism,
			types: knownProfile.types || ['cpu'],
			descriptionKey: knownProfile.descriptionKey || 'impact.unknown',
			frequency: knownProfile.frequency,
			activeOnly: knownProfile.activeOnly,
			estimatedCpuMs: knownProfile.estimatedCpuMs,
			canDisable: true
		};
	}

	// 2. Permission-based analysis
	const permImpact = analyzeByPermissions(meta);
	if (permImpact.level) {
		return {
			...analyzeScriptType(meta),
			...permImpact,
			canDisable: true
		};
	}

	// 3. Script type fallback
	return {
		...analyzeScriptType(meta),
		canDisable: true
	};
}

// Analyze userscript specifically
export function analyzeUserScript(script: {
	type: 'javascript' | 'css';
	runAt: string;
	code: string;
}): ResourceImpact {
	// CSS injection is very low impact
	if (script.type === 'css') {
		return {
			level: 'low',
			mechanism: 'userscript',
			types: ['injection'],
			descriptionKey: 'impact.css_injection',
			frequency: 'page-load',
			activeOnly: false,
			estimatedCpuMs: 0,
			canDisable: true
		};
	}

	// Detect interval patterns in code
	const hasInterval = /setInterval\s*\(/.test(script.code);
	const hasRAF = /requestAnimationFrame\s*\(/.test(script.code);
	const hasMutation = /MutationObserver/.test(script.code);

	if (hasInterval) {
		return {
			level: 'medium',
			mechanism: 'interval_slow',
			types: ['cpu', 'injection'],
			descriptionKey: 'impact.userscript_interval',
			frequency: 'periodic',
			activeOnly: false,
			estimatedCpuMs: 5,
			canDisable: true
		};
	}

	if (hasRAF) {
		return {
			level: 'high',
			mechanism: 'raf_active',
			types: ['cpu', 'render'],
			descriptionKey: 'impact.userscript_raf',
			frequency: '16ms',
			activeOnly: true,
			estimatedCpuMs: 10,
			canDisable: true
		};
	}

	if (hasMutation) {
		return {
			level: 'medium',
			mechanism: 'mutation_observer',
			types: ['cpu'],
			descriptionKey: 'impact.userscript_observer',
			frequency: 'dom-change',
			activeOnly: false,
			estimatedCpuMs: 3,
			canDisable: true
		};
	}

	// Default: one-time execution
	return {
		level: 'low',
		mechanism: 'userscript',
		types: ['injection'],
		descriptionKey: 'impact.userscript_onetime',
		frequency: 'page-load',
		activeOnly: false,
		estimatedCpuMs: 1,
		canDisable: true
	};
}

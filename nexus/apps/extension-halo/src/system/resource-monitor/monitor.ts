// goal: Resource Monitor analysis engine - precise CPU consumption detection
// inv: Only record REAL mechanisms and frequencies, no CPU ms estimates

import { ToolMeta } from '../../kernel';
import type { ResourceImpact, ConsumptionMechanism, ImpactLevel } from './types';

// Known tool-specific impact profiles (SSOT - Real data only)
const TOOL_IMPACT_PROFILES: Record<string, ResourceImpact> = {
	'smooth-scroll': {
		level: 'medium',
		mechanism: 'raf_active',
		types: ['cpu', 'render'],
		descriptionKey: 'impact.raf_scroll',
		frequency: '16ms',
		activeOnly: true
	},
	'clipboard': {
		level: 'idle',
		mechanism: 'event_listener',
		types: ['memory'],
		descriptionKey: 'impact.copy_listener',
		frequency: 'on-copy',
		activeOnly: false
	},
	'userscripts': {
		level: 'low',
		mechanism: 'storage_listener',
		types: ['cpu', 'injection'],
		descriptionKey: 'impact.userscripts_registry',
		frequency: 'on-change',
		activeOnly: false
	},
	'totp': {
		level: 'medium',
		mechanism: 'interval_slow',
		types: ['cpu'],
		descriptionKey: 'impact.interval_1s',
		frequency: '1s',
		activeOnly: true
	},
	'timestamp': {
		level: 'low',
		mechanism: 'interval_slow',
		types: ['cpu'],
		descriptionKey: 'impact.interval_1s',
		frequency: '1s',
		activeOnly: true
	},
	'timer': {
		level: 'low',
		mechanism: 'interval_slow',
		types: ['cpu'],
		descriptionKey: 'impact.timer_running',
		frequency: '1s',
		activeOnly: true
	},
	'pomodoro': {
		level: 'low',
		mechanism: 'interval_slow',
		types: ['cpu'],
		descriptionKey: 'impact.timer_running',
		frequency: '1s',
		activeOnly: true
	},
	'text-to-speech': {
		level: 'low',
		mechanism: 'interval_slow',
		types: ['cpu'],
		descriptionKey: 'impact.progress_update',
		frequency: 'playback',
		activeOnly: true
	},
	'tab-group': {
		level: 'idle',
		mechanism: 'event_listener',
		types: ['memory'],
		descriptionKey: 'impact.tab_events',
		frequency: 'on-event',
		activeOnly: true
	},
	'resource-monitor': {
		level: 'idle',
		mechanism: 'storage_listener',
		types: ['cpu'],
		descriptionKey: 'impact.self_monitoring',
		frequency: 'on-view',
		activeOnly: true
	}
};

// Permission-based impact analysis
function analyzeByPermissions(meta: ToolMeta): Partial<ResourceImpact> | null {
	if (meta.permissions?.includes('webRequest') ||
		meta.permissions?.includes('declarativeNetRequest')) {
		return {
			level: 'high',
			mechanism: 'event_listener',
			types: ['network', 'cpu'],
			descriptionKey: 'impact.network_interceptor',
			frequency: 'per-request'
		};
	}
	if (meta.permissions?.includes('webNavigation')) {
		return {
			level: 'medium',
			mechanism: 'event_listener',
			types: ['cpu'],
			descriptionKey: 'impact.navigation_listener',
			frequency: 'on-navigate'
		};
	}
	return null;
}

// Script type analysis
function analyzeScriptType(meta: ToolMeta): ResourceImpact {
	if (meta.toolType === 'script') {
		const runAt = meta.scriptRunAt || 'document_idle';
		return {
			level: runAt === 'document_start' ? 'medium' : 'low',
			mechanism: 'content_script',
			types: ['cpu', 'injection'],
			descriptionKey: runAt === 'document_start' ? 'impact.injection_start' : 'impact.injection_idle',
			frequency: 'page-load',
			activeOnly: false
		};
	}
	// Default background service
	return {
		level: 'low',
		mechanism: 'service_worker',
		types: ['memory'],
		descriptionKey: 'impact.background_idle',
		frequency: 'on-demand',
		activeOnly: false
	};
}

// Main analysis function
export function analyzeImpact(meta: ToolMeta): ResourceImpact {
	// 1. Known tool profile (highest priority)
	const known = TOOL_IMPACT_PROFILES[meta.id];
	if (known) return { ...known, canDisable: true };

	// 2. Permission-based analysis
	const permImpact = analyzeByPermissions(meta);
	if (permImpact) {
		return { ...analyzeScriptType(meta), ...permImpact, canDisable: true };
	}

	// 3. Script type fallback
	return { ...analyzeScriptType(meta), canDisable: true };
}

// Analyze userscript code patterns
export function analyzeUserScript(script: {
	type: 'javascript' | 'css';
	runAt: string;
	code: string;
}): ResourceImpact {
	if (script.type === 'css') {
		return {
			level: 'low',
			mechanism: 'userscript',
			types: ['injection'],
			descriptionKey: 'impact.css_injection',
			frequency: 'page-load',
			activeOnly: false,
			canDisable: true
		};
	}

	// Detect patterns in code
	const hasInterval = /setInterval\s*\(/.test(script.code);
	const hasRAF = /requestAnimationFrame\s*\(/.test(script.code);
	const hasMutation = /MutationObserver/.test(script.code);

	if (hasRAF) {
		return {
			level: 'high',
			mechanism: 'raf_active',
			types: ['cpu', 'render'],
			descriptionKey: 'impact.userscript_raf',
			frequency: '16ms',
			activeOnly: false,
			canDisable: true
		};
	}
	if (hasInterval) {
		return {
			level: 'medium',
			mechanism: 'interval_slow',
			types: ['cpu'],
			descriptionKey: 'impact.userscript_interval',
			frequency: 'periodic',
			activeOnly: false,
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
			canDisable: true
		};
	}

	// One-time execution
	return {
		level: 'low',
		mechanism: 'userscript',
		types: ['injection'],
		descriptionKey: 'impact.userscript_onetime',
		frequency: 'page-load',
		activeOnly: false,
		canDisable: true
	};
}

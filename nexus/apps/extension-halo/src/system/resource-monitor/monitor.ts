import { ToolMeta } from '../../kernel';
import { ResourceImpact } from './types';

export function analyzeImpact(meta: ToolMeta): ResourceImpact {
	// 1. Content Scripts (User or SaaT)
	if (meta.toolType === 'script') {
		// Injections are generally 'medium' impact due to DOM interaction
		if (meta.scriptRunAt === 'document_start') {
			return {
				level: 'medium',
				types: ['injection', 'cpu'],
				descriptionKey: 'impact.injection_start'
			};
		}
		return {
			level: 'low',
			types: ['injection'],
			descriptionKey: 'impact.injection_idle'
		};
	}

	// 2. Specific Tool Analysis based on Permissions & Features

	// Network Interceptors (High cost)
	if (meta.permissions?.includes('webRequest') ||
		meta.permissions?.includes('declarativeNetRequest') ||
		meta.permissions?.includes('webNavigation')) {
		return {
			level: 'high',
			types: ['network', 'cpu'],
			descriptionKey: 'impact.network_listener'
		};
	}

	// Tabs/Window Monitors (Medium cost)
	if (meta.permissions?.includes('tabs') || meta.permissions?.includes('windows')) {
		// Only if they have background listeners (assumed for active tools)
		return {
			level: 'medium',
			types: ['memory'],
			descriptionKey: 'impact.tab_listener'
		};
	}

	// Known Specific Tools
	if (meta.id === 'smooth-scroll') {
		return {
			level: 'medium',
			types: ['cpu', 'injection'],
			descriptionKey: 'impact.render_intensive'
		};
	}

	if (meta.id === 'resource-monitor') {
		return {
			level: 'low',
			types: ['cpu'],
			descriptionKey: 'impact.self_monitoring'
		};
	}

	// 3. Default Background Service (Low cost, mostly idle)
	return {
		level: 'low',
		types: ['memory'],
		descriptionKey: 'impact.background_idle'
	};
}

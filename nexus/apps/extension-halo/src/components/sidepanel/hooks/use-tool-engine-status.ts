import { useEngineStatus } from '../EngineStatusProvider';

/**
 * World-Class Optimization: 
 * Consumers now subscribe to a centralized context instead of adding redundant storage listeners.
 */
export function useToolEngineStatus(toolId: string): boolean {
	const status = useEngineStatus();

	switch (toolId) {
		case 'smooth-scroll': return status.smoothScroll;
		case 'userscripts': return status.userscripts;
		case 'clipboard': return status.clipboard;
		default: return false;
	}
}

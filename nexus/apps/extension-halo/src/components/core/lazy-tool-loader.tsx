// goal: Lazy tool loader with preload and loading states
// eff: Dynamic import + hover preload + skeleton fallback
// inv: Panel mapping and preload import authority are generated from one registry source.

import type React from 'react';
import { Suspense, useCallback, useEffect, useRef } from 'react';
import { Card } from '@nexus/ui-kit';
import type { HaloSettings, ToolId } from '../../kernel';
import {
	generatedToolLoaders,
	generatedToolPanels,
	type LoadableToolId,
} from '../_generated-tool-loader';

const PRELOAD_DELAY = 150; // ms before preload on hover

// Preload cache to avoid duplicate preloads
const preloadedTools = new Set<string>();
const preloadInFlight = new Map<string, PromiseLike<unknown>>();
const reportedPreloadFailures = new Set<string>();

function reportPreloadFailure(toolId: string, error: unknown): void {
	if (reportedPreloadFailures.has(toolId)) return;
	reportedPreloadFailures.add(toolId);
	console.warn(`[HALO:Preload] Failed to preload ${toolId}`, error);
}

function trackPreloadThenable(
	toolId: string,
	thenable: PromiseLike<unknown>,
): void {
	if (preloadInFlight.has(toolId)) return;
	preloadInFlight.set(toolId, thenable);
	void Promise.resolve(thenable).then(
		() => {
			if (preloadInFlight.get(toolId) !== thenable) return;
			preloadInFlight.delete(toolId);
			reportedPreloadFailures.delete(toolId);
			preloadedTools.add(toolId);
		},
		(error: unknown) => {
			if (preloadInFlight.get(toolId) !== thenable) return;
			preloadInFlight.delete(toolId);
			reportPreloadFailure(toolId, error);
		},
	);
}

function startLazyPreload(toolId: LoadableToolId): void {
	if (preloadedTools.has(toolId) || preloadInFlight.has(toolId)) return;
	try {
		trackPreloadThenable(toolId, generatedToolLoaders[toolId]());
	} catch (error: unknown) {
		reportPreloadFailure(toolId, error);
	}
}

// Skeleton loading component
const LoadingSkeleton: React.FC = () => (
	<Card variant="default" padding="md">
		<div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center', padding: '24px' }}>
			<div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--halo-bg-tertiary)', animation: 'var(--halo-motion-animation, pulse 1.5s infinite)' }} />
			<div style={{ width: '120px', height: '12px', borderRadius: '6px', background: 'var(--halo-bg-tertiary)', animation: 'var(--halo-motion-animation, pulse 1.5s infinite)' }} />
			<div style={{ width: '180px', height: '10px', borderRadius: '5px', background: 'var(--halo-bg-tertiary)', animation: 'var(--halo-motion-animation, pulse 1.5s infinite)', opacity: 0.6 }} />
		</div>
		<style>{`
			@keyframes pulse {
				0%, 100% { opacity: 1; }
				50% { opacity: 0.5; }
			}
		`}</style>
	</Card>
);

interface LazyToolRendererProps {
	toolId: ToolId | null;
	fallback?: React.ReactNode;
	onSettingsChange?: (settings: HaloSettings) => void;
}

import { ToolErrorBoundary } from './ToolErrorBoundary';

function isLoadableToolId(toolId: string): toolId is LoadableToolId {
	return Object.hasOwn(generatedToolPanels, toolId);
}

export const LazyToolRenderer: React.FC<LazyToolRendererProps> = ({
	toolId,
	fallback,
	onSettingsChange,
}) => {
	if (!toolId || !isLoadableToolId(toolId)) {
		return fallback ? fallback : null;
	}

	if (toolId === 'settings') {
		if (!onSettingsChange) return fallback ? fallback : null;
		const SettingsPanel = generatedToolPanels.settings;
		return (
			<ToolErrorBoundary toolId={toolId}>
				<Suspense fallback={<LoadingSkeleton />}>
					<SettingsPanel onSettingsChange={onSettingsChange} />
				</Suspense>
			</ToolErrorBoundary>
		);
	}

	const Panel = generatedToolPanels[toolId];
	return (
		<ToolErrorBoundary toolId={toolId}>
			<Suspense fallback={<LoadingSkeleton />}>
				<Panel />
			</Suspense>
		</ToolErrorBoundary>
	);
};

// Preload hook for hover behavior
export const useToolPreload = () => {
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const preload = useCallback((toolId: ToolId) => {
		if (preloadedTools.has(toolId) || !isLoadableToolId(toolId)) return;
		timerRef.current = setTimeout(() => {
			startLazyPreload(toolId);
		}, PRELOAD_DELAY);
	}, []);

	const cancelPreload = useCallback(() => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
	}, []);

	useEffect(() => () => cancelPreload(), [cancelPreload]);
	return { preload, cancelPreload };
};

export const getLoadableToolIds = (): LoadableToolId[] =>
	Object.keys(generatedToolPanels).filter(isLoadableToolId);

/**
 * Batch preload top N tools on browser idle
 * @param toolIds Tools to preload, sorted by priority (e.g., by usage count)
 * @param count Number of tools to preload (default: 5)
 */
export function preloadToolsOnIdle(toolIds: ToolId[], count = 5): void {
	const toPreload = toolIds
		.filter((id): id is LoadableToolId =>
			!preloadedTools.has(id) && isLoadableToolId(id)
		)
		.slice(0, count);

	if (toPreload.length === 0) return;

	const scheduleIdle = typeof requestIdleCallback !== 'undefined'
		? requestIdleCallback
		: (cb: () => void) => setTimeout(cb, 200);

	scheduleIdle(() => {
		toPreload.forEach((toolId, index) => {
			setTimeout(() => {
				startLazyPreload(toolId);
			}, index * 50);
		});
	});
}

/** Hook for idle preloading - call once at app init. */
export function useIdlePreload(priorityToolIds: ToolId[], count = 5) {
	useEffect(() => {
		const timer = setTimeout(() => {
			preloadToolsOnIdle(priorityToolIds, count);
		}, 1000);
		return () => clearTimeout(timer);
	}, [priorityToolIds, count]);
}

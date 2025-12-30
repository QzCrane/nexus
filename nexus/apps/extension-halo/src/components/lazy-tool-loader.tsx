// goal: Lazy tool loader with preload and loading states
// eff: Dynamic import + hover preload + skeleton fallback

import React, { Suspense, lazy, useState, useCallback, useEffect, useRef } from 'react';
import { Card } from '@nexus/ui-kit';
import type { ToolId } from '../kernel/types';

// Lazy panel imports (code splitting)
const toolPanels = {
	'qrcode': lazy(() => import('../tools/qrcode/panel').then((m) => ({ default: m.QRCodePanel }))),
	'screenshot': lazy(() => import('../tools/screenshot/panel').then((m) => ({ default: m.ScreenshotPanel }))),
	'base64': lazy(() => import('../tools/base64/panel').then((m) => ({ default: m.Base64Panel }))),
	'json-formatter': lazy(() => import('../tools/json-formatter/panel').then((m) => ({ default: m.JSONFormatterPanel }))),
	'color-picker': lazy(() => import('../tools/color-picker/panel').then((m) => ({ default: m.ColorPickerPanel }))),
	'hash': lazy(() => import('../tools/hash/panel').then((m) => ({ default: m.HashPanel }))),
	'regex': lazy(() => import('../tools/regex/panel').then((m) => ({ default: m.RegexPanel }))),
	'ruler': lazy(() => import('../tools/ruler/panel').then((m) => ({ default: m.RulerPanel }))),
	'outline': lazy(() => import('../tools/outline/panel').then((m) => ({ default: m.OutlinePanel }))),
	'clipboard': lazy(() => import('../tools/clipboard/panel').then((m) => ({ default: m.ClipboardPanel }))),
	'smooth-scroll': lazy(() => import('../tools/smooth-scroll/panel').then((m) => ({ default: m.SmoothScrollPanel }))),
	'tabs': lazy(() => import('../tools/tabs/panel').then((m) => ({ default: m.TabsPanel }))),
	'settings': lazy(() => import('../tools/settings/panel').then((m) => ({ default: m.SettingsPanel }))),
	'pdf': lazy(() => import('../tools/pdf/panel').then((m) => ({ default: m.PDFPanel }))),
	'module-store': lazy(() => import('../tools/module-store/panel').then((m) => ({ default: m.ModuleStorePanel }))),
} as const;

type LoadableTool = keyof typeof toolPanels;
const PRELOAD_DELAY = 150; // ms before preload on hover

// Preload cache to avoid duplicate preloads
const preloadedTools = new Set<string>();

// Skeleton loading component
const LoadingSkeleton: React.FC = () => (
	<Card variant="default" padding="md">
		<div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center', padding: '24px' }}>
			<div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--halo-bg-tertiary)', animation: 'pulse 1.5s infinite' }} />
			<div style={{ width: '120px', height: '12px', borderRadius: '6px', background: 'var(--halo-bg-tertiary)', animation: 'pulse 1.5s infinite' }} />
			<div style={{ width: '180px', height: '10px', borderRadius: '5px', background: 'var(--halo-bg-tertiary)', animation: 'pulse 1.5s infinite', opacity: 0.6 }} />
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
}

export const LazyToolRenderer: React.FC<LazyToolRendererProps> = ({ toolId, fallback }) => {
	if (!toolId || !(toolId in toolPanels)) {
		return fallback ? <>{fallback}</> : null;
	}

	const Panel = toolPanels[toolId as LoadableTool];
	return (
		<Suspense fallback={<LoadingSkeleton />}>
			<Panel />
		</Suspense>
	);
};

// Preload hook for hover behavior
export const useToolPreload = () => {
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const preload = useCallback((toolId: ToolId) => {
		if (preloadedTools.has(toolId) || !(toolId in toolPanels)) return;

		timerRef.current = setTimeout(async () => {
			// Trigger lazy load by re-importing the module
			try {
				switch (toolId) {
					case 'pdf': await import('../tools/pdf/panel'); break;
					case 'qrcode': await import('../tools/qrcode/panel'); break;
					case 'screenshot': await import('../tools/screenshot/panel'); break;
					case 'base64': await import('../tools/base64/panel'); break;
					case 'json-formatter': await import('../tools/json-formatter/panel'); break;
					case 'color-picker': await import('../tools/color-picker/panel'); break;
					case 'hash': await import('../tools/hash/panel'); break;
					case 'regex': await import('../tools/regex/panel'); break;
					case 'settings': await import('../tools/settings/panel'); break;
				}
				preloadedTools.add(toolId);
			} catch { /* ignore preload failures */ }
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

// Get available tool IDs
export const getLoadableToolIds = (): ToolId[] => Object.keys(toolPanels) as ToolId[];

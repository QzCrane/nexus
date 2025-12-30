// goal: Tool panel wrapper with lazy loading
// eff: Centralized Suspense + tool rendering logic

import React, { Suspense, lazy } from 'react';
import { Card } from '@nexus/ui-kit';
import type { ToolId } from '../kernel/types';
import type { HaloSettings } from '../kernel/settings';

// Lazy-loaded tool panels (code splitting)
const QRCodePanel = lazy(() => import('../tools/qrcode').then((m) => ({ default: m.QRCodePanel })));
const ColorPickerPanel = lazy(() => import('../tools/color-picker').then((m) => ({ default: m.ColorPickerPanel })));
const JSONFormatterPanel = lazy(() => import('../tools/json-formatter').then((m) => ({ default: m.JSONFormatterPanel })));
const RulerPanel = lazy(() => import('../tools/ruler').then((m) => ({ default: m.RulerPanel })));
const OutlinePanel = lazy(() => import('../tools/outline').then((m) => ({ default: m.OutlinePanel })));
const SettingsPanel = lazy(() => import('../tools/settings').then((m) => ({ default: m.SettingsPanel })));
const ClipboardPanel = lazy(() => import('../tools/clipboard').then((m) => ({ default: m.ClipboardPanel })));
const SmoothScrollPanel = lazy(() => import('../tools/smooth-scroll').then((m) => ({ default: m.SmoothScrollPanel })));
const RegexPanel = lazy(() => import('../tools/regex').then((m) => ({ default: m.RegexPanel })));
const Base64Panel = lazy(() => import('../tools/base64').then((m) => ({ default: m.Base64Panel })));
const HashPanel = lazy(() => import('../tools/hash').then((m) => ({ default: m.HashPanel })));
const UUIDPanel = lazy(() => import('../tools/uuid').then((m) => ({ default: m.UUIDPanel })));
const TimestampPanel = lazy(() => import('../tools/timestamp').then((m) => ({ default: m.TimestampPanel })));
const URLPanel = lazy(() => import('../tools/url').then((m) => ({ default: m.URLPanel })));
const TabsPanel = lazy(() => import('../tools/tabs').then((m) => ({ default: m.TabsPanel })));
const ScreenshotPanel = lazy(() => import('../tools/screenshot').then((m) => ({ default: m.ScreenshotPanel })));
const PDFPanel = lazy(() => import('../tools/pdf').then((m) => ({ default: m.PDFPanel })));
const ModuleStorePanel = lazy(() => import('../tools/module-store').then((m) => ({ default: m.ModuleStorePanel })));

// Tool mapping for rendering
const TOOL_PANELS: Record<string, React.LazyExoticComponent<React.FC<{ onSettingsChange?: (s: HaloSettings) => void }>>> = {
	'qrcode': QRCodePanel,
	'color-picker': ColorPickerPanel,
	'json-formatter': JSONFormatterPanel,
	'ruler': RulerPanel,
	'outline': OutlinePanel,
	'clipboard': ClipboardPanel,
	'smooth-scroll': SmoothScrollPanel,
	'tabs': TabsPanel,
	'screenshot': ScreenshotPanel,
	'pdf': PDFPanel,
	'module-store': ModuleStorePanel,
	'regex': RegexPanel,
	'base64': Base64Panel,
	'hash': HashPanel,
	'uuid': UUIDPanel,
	'timestamp': TimestampPanel,
	'url': URLPanel,
	'settings': SettingsPanel,
};

const styles = {
	placeholder: {
		display: 'flex', flexDirection: 'column' as const, alignItems: 'center',
		justifyContent: 'center', minHeight: '200px', textAlign: 'center' as const,
	},
};

interface ToolPanelRendererProps {
	activeTool: ToolId | null;
	onSettingsChange: (s: HaloSettings) => void;
	selectToolText: string;
}

export const ToolPanelRenderer: React.FC<ToolPanelRendererProps> = ({ activeTool, onSettingsChange, selectToolText }) => {
	const Panel = activeTool ? TOOL_PANELS[activeTool] : null;

	return (
		<Suspense fallback={
			<Card variant="default" padding="md">
				<div style={styles.placeholder}>
					<span style={{ fontSize: '24px' }}>⏳</span>
					<p style={{ color: 'var(--halo-text-muted)', fontSize: '12px' }}>Loading...</p>
				</div>
			</Card>
		}>
			{Panel ? (
				activeTool === 'settings' ? (
					<SettingsPanel onSettingsChange={onSettingsChange} />
				) : (
					<Panel />
				)
			) : (
				<Card variant="default" padding="md">
					<div style={styles.placeholder}>
						<span style={{ fontSize: '48px', opacity: 0.3 }}>👆</span>
						<p style={{ color: 'var(--halo-text-secondary)', fontSize: '13px' }}>
							{selectToolText}
						</p>
					</div>
				</Card>
			)}
		</Suspense>
	);
};

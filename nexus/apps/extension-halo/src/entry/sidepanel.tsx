// goal: HALO SidePanel main entry
// tradeoff: modular tool loading for maintainability

import React, { useState, useCallback, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Card } from '@nexus/ui-kit';
import { createLogger } from '@nexus/kernel';
import type { ToolId } from '../kernel/types';
import { STORAGE_PREFIX } from '../kernel/types';
import type { HaloSettings } from '../kernel/settings';
import { loadSettings, getThemeColors, applyTheme } from '../kernel/theme';

// Tool panels
import { QRCodePanel } from '../tools/qrcode';
import { ColorPickerPanel } from '../tools/color-picker';
import { JSONFormatterPanel } from '../tools/json-formatter';
import { RulerPanel } from '../tools/ruler';
import { OutlinePanel } from '../tools/outline';
import { SettingsPanel } from '../tools/settings';

const logger = createLogger('SidePanel', 'HALO');

// Tool metadata for rendering
const TOOLS: { id: ToolId; icon: string; label: string; ready: boolean }[] = [
	{ id: 'qrcode', icon: '🔲', label: 'QR', ready: true },
	{ id: 'color-picker', icon: '🎨', label: 'Color', ready: true },
	{ id: 'ruler', icon: '📐', label: 'Ruler', ready: true },
	{ id: 'json-formatter', icon: '{}', label: 'JSON', ready: true },
	{ id: 'outline', icon: '📋', label: 'Outline', ready: true },
	{ id: 'clipboard', icon: '📎', label: 'Clip', ready: false },
];

const SidePanel: React.FC = () => {
	const [activeTool, setActiveTool] = useState<ToolId | null>(null);
	const [settings, setSettings] = useState<HaloSettings | null>(null);
	const [loading, setLoading] = useState(true);
	const [showLabels, setShowLabels] = useState(true);

	useEffect(() => {
		// Initialize theme and load settings
		const init = async () => {
			const s = await loadSettings();
			setSettings(s);
			setShowLabels(s.showToolLabels);
			
			// Apply theme
			const colors = getThemeColors(s.theme, s.accentColor);
			applyTheme(colors);
			
			// Load last active tool
			const storage = await chrome.storage.sync.get([`${STORAGE_PREFIX.CORE}active_tool`]);
			const saved = storage[`${STORAGE_PREFIX.CORE}active_tool`] as ToolId | null;
			if (saved) setActiveTool(saved);
			
			setLoading(false);
		};
		init();

		// Listen for external tool activation (from context menu)
		const listener = (message: { type: string; toolId?: ToolId }): boolean | undefined => {
			if (message.type === 'HALO_ACTIVATE_TOOL' && message.toolId) {
				setActiveTool(message.toolId);
			}
			return undefined;
		};
		chrome.runtime.onMessage.addListener(listener);
		return () => chrome.runtime.onMessage.removeListener(listener);
	}, []);

	const handleToolSelect = useCallback(async (toolId: ToolId) => {
		setActiveTool(toolId);
		await chrome.storage.sync.set({ [`${STORAGE_PREFIX.CORE}active_tool`]: toolId });
		logger.info('Tool activated:', toolId);
	}, []);

	const handleSettingsChange = useCallback((updated: HaloSettings) => {
		setSettings(updated);
		setShowLabels(updated.showToolLabels);
	}, []);

	const handleOpenSettings = useCallback(() => {
		setActiveTool('settings');
	}, []);

	if (loading) {
		return (
			<div style={styles.container}>
				<div style={styles.loading}>
					<span style={{ fontSize: '24px' }}>🌟</span>
					<span>Loading...</span>
				</div>
			</div>
		);
	}

	const accentColor = settings?.accentColor || '#7c3aed';

	return (
		<div style={styles.container}>
			{/* Header */}
			<header style={styles.header}>
				<div style={styles.headerLeft}>
					<span style={{ fontSize: '20px' }}>🌟</span>
					<h1 style={styles.title}>HALO</h1>
				</div>
				<button
					style={styles.settingsBtn}
					onClick={handleOpenSettings}
					title="Settings"
				>
					⚙️
				</button>
			</header>

			{/* Tool Bar */}
			<div style={styles.toolbar}>
				{TOOLS.map((tool) => (
					<button
						key={tool.id}
						onClick={() => tool.ready && handleToolSelect(tool.id)}
						disabled={!tool.ready}
						style={{
							...styles.toolBtn,
							background: activeTool === tool.id 
								? `${accentColor}20` 
								: 'var(--halo-bg-tertiary, #2a2a2a)',
							borderColor: activeTool === tool.id 
								? accentColor 
								: 'var(--halo-border, #444)',
							opacity: tool.ready ? 1 : 0.4,
							cursor: tool.ready ? 'pointer' : 'not-allowed',
						}}
						title={tool.ready ? tool.label : `${tool.label} (Coming Soon)`}
					>
						<span style={{ fontSize: '16px' }}>{tool.icon}</span>
						{showLabels && (
							<span style={{ 
								fontSize: '9px', 
								color: 'var(--halo-text-muted, #888)' 
							}}>
								{tool.label}
							</span>
						)}
					</button>
				))}
			</div>

			{/* Main Content */}
			<div style={styles.content}>
				{activeTool === 'qrcode' ? (
					<QRCodePanel />
				) : activeTool === 'color-picker' ? (
					<ColorPickerPanel />
				) : activeTool === 'ruler' ? (
					<RulerPanel />
				) : activeTool === 'json-formatter' ? (
					<JSONFormatterPanel />
				) : activeTool === 'outline' ? (
					<OutlinePanel />
				) : activeTool === 'settings' ? (
					<SettingsPanel onSettingsChange={handleSettingsChange} />
				) : activeTool ? (
					<Card variant="default" padding="md">
						<div style={styles.placeholder}>
							<span style={{ fontSize: '48px', opacity: 0.3 }}>🚧</span>
							<p style={{ color: 'var(--halo-text-secondary)', fontSize: '13px' }}>
								<strong>{TOOLS.find(t => t.id === activeTool)?.label}</strong>
							</p>
							<p style={{ color: 'var(--halo-text-muted)', fontSize: '11px' }}>Coming Soon</p>
						</div>
					</Card>
				) : (
					<Card variant="default" padding="md">
						<div style={styles.placeholder}>
							<span style={{ fontSize: '48px', opacity: 0.3 }}>👆</span>
							<p style={{ color: 'var(--halo-text-secondary)', fontSize: '13px' }}>
								Select a tool to begin
							</p>
						</div>
					</Card>
				)}
			</div>

			{/* Footer */}
			<div style={styles.footer}>
				<span>🔒 Zero tracking</span>
				<span>•</span>
				<span>💾 Local only</span>
			</div>
		</div>
	);
};

const styles: Record<string, React.CSSProperties> = {
	container: {
		display: 'flex',
		flexDirection: 'column',
		gap: '12px',
		padding: '16px',
		minHeight: '100vh',
		fontFamily: 'system-ui, -apple-system, sans-serif',
		color: 'var(--halo-text, #e0e0e0)',
		background: 'var(--halo-bg, #1a1a1a)',
	},
	header: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'space-between',
	},
	headerLeft: {
		display: 'flex',
		alignItems: 'center',
		gap: '8px',
	},
	title: {
		margin: 0,
		fontSize: '18px',
		fontWeight: 600,
		color: 'var(--halo-text, #fff)',
	},
	settingsBtn: {
		padding: '6px 10px',
		background: 'transparent',
		border: '1px solid var(--halo-border, #444)',
		borderRadius: '6px',
		fontSize: '14px',
		cursor: 'pointer',
		transition: 'background 0.15s',
	},
	toolbar: {
		display: 'grid',
		gridTemplateColumns: 'repeat(6, 1fr)',
		gap: '6px',
	},
	toolBtn: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		gap: '2px',
		padding: '8px 4px',
		border: '1px solid var(--halo-border, #444)',
		borderRadius: '6px',
		transition: 'all 0.15s',
		color: 'var(--halo-text)',
	},
	content: {
		flex: 1,
		minHeight: 0,
	},
	placeholder: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		justifyContent: 'center',
		minHeight: '200px',
		textAlign: 'center',
	},
	footer: {
		display: 'flex',
		justifyContent: 'center',
		gap: '8px',
		fontSize: '10px',
		color: 'var(--halo-text-muted, #666)',
		marginTop: 'auto',
		paddingTop: '8px',
	},
	loading: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		justifyContent: 'center',
		gap: '8px',
		minHeight: '200px',
		color: 'var(--halo-text-secondary, #888)',
	},
};

createRoot(document.getElementById('root')!).render(<SidePanel />);

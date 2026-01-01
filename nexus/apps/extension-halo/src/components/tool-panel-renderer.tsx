// goal: Tool panel wrapper with lazy loading
// eff: Centralized Suspense + tool rendering logic. Excludes system tools from Keep-Alive.

import React from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../i18n';
import type { ToolId, HaloSettings } from '../kernel';
import { TOOL_REGISTRY } from '../kernel';
import { LazyToolRenderer } from './lazy-tool-loader';
import { SettingsPanel } from '../pages/settings';
import { ModuleStorePanel } from '../pages/module-store';

const styles = {
	placeholder: {
		display: 'flex', flexDirection: 'column' as const, alignItems: 'center',
		justifyContent: 'center', minHeight: '200px', textAlign: 'center' as const,
	},
	contentWrapper: {
		height: '100%', width: '100%', padding: '12px 12px 0 12px', boxSizing: 'border-box' as const,
		display: 'flex', flexDirection: 'column' as const
	}
};

interface ToolPanelRendererProps {
	activeTool: ToolId | null;
	openTools: ToolId[];
	onSettingsChange: (s: HaloSettings) => void;
	selectToolText: string;
}

export const ToolPanelRenderer: React.FC<ToolPanelRendererProps> = ({ 
	activeTool, 
	openTools, 
	onSettingsChange, 
	selectToolText 
}) => {
	const { t } = useTranslation();
	
	const fallbackUI = (
		<div style={{ ...styles.placeholder, height: '100%', flex: 1 }}>
			<div style={{ width: 'auto', maxWidth: '300px' }}>
				<Card variant="default" padding="md">
					<div style={{ padding: '24px', textAlign: 'center' }}>
						<span style={{ fontSize: '48px', opacity: 0.3, display: 'block', marginBottom: '16px' }}>👆</span>
						<p style={{ color: 'var(--halo-text-secondary)', fontSize: '13px', margin: 0 }}>
							{selectToolText}
						</p>
					</div>
				</Card>
			</div>
		</div>
	);

	if (openTools.length === 0 && !activeTool) {
		return fallbackUI;
	}

	return (
		<>
			{/* System Pages (Rendered only when active) */}
			{activeTool === 'module-store' && (
				<div style={{ ...styles.contentWrapper, overflowY: 'auto' }}>
					<ModuleStorePanel />
				</div>
			)}
			
			{activeTool === 'settings' && (
				<div style={{ ...styles.contentWrapper, overflowY: 'auto' }}>
					<SettingsPanel onSettingsChange={onSettingsChange} />
				</div>
			)}
			
			{activeTool === 'permissions' && (
				<div style={{ ...styles.contentWrapper, overflowY: 'auto' }}>
					<LazyToolRenderer toolId="permissions" onSettingsChange={onSettingsChange} />
				</div>
			)}

			{/* Standard Tools (Keep Alive) */}
			{openTools
				.filter(id => id !== 'settings' && id !== 'module-store' && id !== 'permissions')
				.map(toolId => {
					const isActive = activeTool === toolId;
					
					return (
						<div 
							key={toolId} 
							style={{ 
								...styles.contentWrapper,
								display: isActive ? 'flex' : 'none',
							}}
						>
							<div style={{ flex: 1, overflowY: 'auto', position: 'relative', minHeight: 0 }}>
								<LazyToolRenderer toolId={toolId} onSettingsChange={onSettingsChange} />
							</div>
						</div>
					);
				})}
				
			{!activeTool && openTools.length > 0 && fallbackUI}
		</>
	);
};

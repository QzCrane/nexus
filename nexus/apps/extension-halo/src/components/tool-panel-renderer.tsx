import React from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../i18n';
import type { ToolId, HaloSettings } from '../kernel';
import { useSmoothWheel } from '../kernel/hooks/use-smooth-wheel';
import { LazyToolRenderer } from './lazy-tool-loader';
import { SettingsPanel } from '../pages/settings';
import { ModuleStorePanel } from '../pages/module-store';
import { PermissionsPanel } from '../pages/permissions';

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

/**
 * Internal scrollable container with custom smooth wheel
 */
const SmoothScrollContainer: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => {
	const ref = React.useRef<HTMLDivElement>(null);
	useSmoothWheel(ref, 'y');
	return (
		<div ref={ref} style={{ ...styles.contentWrapper, overflowY: 'auto', ...style }}>
			{children}
		</div>
	);
};

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
				<SmoothScrollContainer>
					<ModuleStorePanel />
				</SmoothScrollContainer>
			)}
			
			{activeTool === 'settings' && (
				<SmoothScrollContainer>
					<SettingsPanel onSettingsChange={onSettingsChange} />
				</SmoothScrollContainer>
			)}
			
			{activeTool === 'permissions' && (
				<SmoothScrollContainer>
					<PermissionsPanel />
				</SmoothScrollContainer>
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
								padding: 0, // Container below SmoothScrollContainer handles padding
							}}
						>
							<div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
								<SmoothScrollContainer style={{ padding: '12px 12px 0 12px' }}>
									<LazyToolRenderer toolId={toolId} onSettingsChange={onSettingsChange} />
								</SmoothScrollContainer>
							</div>
						</div>
					);
				})}
				
			{!activeTool && openTools.length > 0 && fallbackUI}
		</>
	);
};

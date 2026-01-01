// goal: Tool panel wrapper with lazy loading
// eff: Centralized Suspense + tool rendering logic

import React from 'react';
import { Card } from '@nexus/ui-kit';
import type { ToolId, HaloSettings } from '../kernel';
import { LazyToolRenderer } from './lazy-tool-loader';

const styles = {
	placeholder: {
		display: 'flex', flexDirection: 'column' as const, alignItems: 'center',
		justifyContent: 'center', minHeight: '200px', textAlign: 'center' as const,
	},
};

interface ToolPanelRendererProps {
	activeTool: ToolId | null;
	openTools: ToolId[];
	onSettingsChange: (s: HaloSettings) => void;
	selectToolText: string;
}

export const ToolPanelRenderer: React.FC<ToolPanelRendererProps> = ({ activeTool, openTools, onSettingsChange, selectToolText }) => {
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
			{openTools.map(toolId => (
				<div 
					key={toolId} 
					style={{ 
						display: activeTool === toolId ? 'block' : 'none', 
						height: '100%', 
						flex: 1,
						maxWidth: '800px',
						margin: '0 auto',
						width: '100%'
					}}
				>
					<LazyToolRenderer 
						toolId={toolId} 
						onSettingsChange={onSettingsChange}
					/>
				</div>
			))}
			{!activeTool && openTools.length > 0 && fallbackUI}
		</>
	);
};

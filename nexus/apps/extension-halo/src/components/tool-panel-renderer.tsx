// goal: Render tool panels with animated tab switching
// eff: Keep-alive pattern with fade transitions between tabs

import React from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../i18n';
import type { ToolId, HaloSettings } from '../kernel';
import { TOOL_REGISTRY } from '../kernel';
import { useSmoothWheel } from '../kernel/hooks/use-smooth-wheel';
import { LazyToolRenderer } from './lazy-tool-loader';
import { AnimatedTransition } from './ui/animated-transition';

// SSOT: Get system tool IDs from registry
const SYSTEM_TOOL_IDS = new Set(
	TOOL_REGISTRY.filter(t => t.pluginType === 'system').map(t => t.id)
);

const isSystemTool = (id: string): boolean => SYSTEM_TOOL_IDS.has(id);

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

	// No tool active and no tools open -> show fallback
	if (!activeTool && openTools.length === 0) {
		return fallbackUI;
	}

	// System tool active: render with fade animation
	if (activeTool && isSystemTool(activeTool)) {
		return (
			<AnimatedTransition show={true} type="fade" duration={150}>
				<SmoothScrollContainer>
					<LazyToolRenderer 
						toolId={activeTool} 
						onSettingsChange={activeTool === 'settings' ? onSettingsChange : undefined} 
					/>
				</SmoothScrollContainer>
			</AnimatedTransition>
		);
	}

	// User tools: render with keep-alive pattern and fade transitions
	return (
		<div style={{ position: 'relative', width: '100%', height: '100%' }}>
			{openTools
				.filter(id => !isSystemTool(id))
				.map(toolId => {
					const isActive = activeTool === toolId;
					
					return (
						<AnimatedTransition
							key={toolId}
							show={isActive}
							type="fade"
							duration={180}
							keepMounted // Keep tool state alive when switching tabs
							style={{
								position: 'absolute',
								top: 0,
								left: 0,
								right: 0,
								bottom: 0,
							}}
						>
							<div style={{ ...styles.contentWrapper, padding: 0, height: '100%' }}>
								<div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
									<SmoothScrollContainer style={{ padding: '12px 12px 0 12px' }}>
										<LazyToolRenderer toolId={toolId} onSettingsChange={onSettingsChange} />
									</SmoothScrollContainer>
								</div>
							</div>
						</AnimatedTransition>
					);
				})}
				
			{/* No active tool but have open tools -> show fallback with fade */}
			<AnimatedTransition show={!activeTool && openTools.length > 0} type="fade">
				{fallbackUI}
			</AnimatedTransition>
		</div>
	);
};

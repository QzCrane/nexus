// goal: Tool panel renderer with unified right-slide animations
// eff: All tool switches animate from right (enter) / to right (exit)

import React, { useRef, useEffect, useState } from 'react';
import { Card } from '@nexus/ui-kit';
import type { ToolId, HaloSettings } from '../../kernel';
import { useSmoothWheel } from '../../kernel/hooks/use-smooth-wheel';
import { LazyToolRenderer } from './lazy-tool-loader';
import { ANIMATION_CONSTANTS } from '../../kernel/core/animations';

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

/** Smooth scrollable container */
const ScrollContainer: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => {
	const ref = React.useRef<HTMLDivElement>(null);
	useSmoothWheel(ref, 'y');
	return <div ref={ref} style={{ ...styles.contentWrapper, overflowY: 'auto', ...style }}>{children}</div>;
};

export const ToolPanelRenderer: React.FC<ToolPanelRendererProps> = ({
	activeTool, openTools, onSettingsChange, selectToolText
}) => {
	const prevToolRef = useRef<ToolId | null>(null);

	// Animation state: 'idle' | 'enter' | 'exit'
	const [animState, setAnimState] = useState<'idle' | 'enter'>('idle');
	const [renderedTool, setRenderedTool] = useState<ToolId | null>(activeTool);

	useEffect(() => {
		const prev = prevToolRef.current;
		prevToolRef.current = activeTool;

		// Skip if same tool or initial mount (null -> tool on first load)
		if (prev === activeTool) return;

		// Animate all tool switches when coming from another tool (prev !== null)
		if (activeTool && prev !== null) {
			// Trigger slide-in animation for new tool
			setAnimState('enter');
			setRenderedTool(activeTool);

			const timer = setTimeout(() => setAnimState('idle'), ANIMATION_CONSTANTS.DURATION.DEFAULT);
			return () => clearTimeout(timer);
		} else {
			// Direct switch without animation (initial mount)
			setRenderedTool(activeTool);
			setAnimState('idle');
		}
	}, [activeTool]);

	const fallbackUI = (
		<div style={{ ...styles.placeholder, height: '100%', flex: 1 }}>
			<div style={{ width: 'auto', maxWidth: '300px' }}>
				<Card variant="default" padding="md">
					<div style={{ padding: '24px', textAlign: 'center' }}>
						<span style={{ fontSize: '48px', opacity: 0.3, display: 'block', marginBottom: '16px' }}>👆</span>
						<p style={{ color: 'var(--halo-text-secondary)', fontSize: '13px', margin: 0 }}>{selectToolText}</p>
					</div>
				</Card>
			</div>
		</div>
	);

	// No tool active
	if (!activeTool && openTools.length === 0) return fallbackUI;

	// Build animation styles - applies to ALL tools now
	const slideStyle: React.CSSProperties = {
		position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
		animation: animState === 'enter'
      ? `var(--halo-motion-animation, haloSlideIn ${ANIMATION_CONSTANTS.DURATION.DEFAULT}ms ${ANIMATION_CONSTANTS.EASING.DEFAULT} forwards)`
      : 'var(--halo-motion-animation, none)',
		background: 'var(--halo-bg)',
	};

	// Active tool with animation
	if (activeTool && renderedTool) {
		return (
			<div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
				<style>{`
					@keyframes haloSlideIn {
						from { transform: translateX(100%); opacity: 0.8; }
						to { transform: translateX(0); opacity: 1; }
					}
				`}</style>
				<div key={renderedTool} style={slideStyle}>
					<ScrollContainer>
						<LazyToolRenderer
							toolId={renderedTool}
							onSettingsChange={renderedTool === 'settings' ? onSettingsChange : undefined}
						/>
					</ScrollContainer>
				</div>
			</div>
		);
	}

	// No active tool but has open tools (show placeholder)
	return fallbackUI;
};

// goal: Modern Mobile-style Launcher layout with slide transitions
// eff: Container component orchestrating HomePage and ToolPage

import React, { useState } from 'react';
import type { LayoutProps } from './types';
import { commonStyles } from './layouts.styles';
import { ScrollbarStyles } from './classic-layout-parts';
import { LauncherHomePage } from './LauncherHomePage';
import { LauncherToolPage } from './LauncherToolPage';

export const LauncherLayout: React.FC<LayoutProps & { onToggleMode: () => void }> = ({
	activeTool,
	onSelectTool,
	onBack,
	settings,
	onSettingsChange,
	visibleTools,
	onToggleMode,
	openTools,
	onCloseTool
}) => {
	const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

	const toggleCategory = (category: string) => {
		setCollapsedCategories(prev => ({ ...prev, [category]: !prev[category] }));
	};

	return (
		<div style={commonStyles.container}>
			<ScrollbarStyles />
			<div style={{
				display: 'flex',
				width: '200%',
				height: '100%',
				transform: activeTool ? 'translateX(-50%)' : 'translateX(0)',
				transition: 'transform 0.3s cubic-bezier(0.4, 0.0, 0.2, 1)',
			}}>
				{/* PAGE 1: HOME / LAUNCHER */}
				<LauncherHomePage
					visibleTools={visibleTools}
					settings={settings}
					onSettingsChange={onSettingsChange}
					onSelectTool={onSelectTool}
					onToggleMode={onToggleMode}
					collapsedCategories={collapsedCategories}
					toggleCategory={toggleCategory}
				/>

				{/* PAGE 2: TOOL VIEW */}
				<LauncherToolPage
					activeTool={activeTool}
					openTools={openTools}
					visibleTools={visibleTools}
					onBack={onBack}
					onSelectTool={onSelectTool}
					onCloseTool={onCloseTool}
					onSettingsChange={onSettingsChange}
				/>
			</div>
		</div>
	);
};

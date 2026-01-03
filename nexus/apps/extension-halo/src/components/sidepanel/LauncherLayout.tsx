// goal: Modern Mobile-style Launcher layout with slide transitions
// eff: Pure content-area manager, Header is handled by SidePanel.tsx

import React, { useState } from 'react';
import type { LayoutProps } from './types';
import { LauncherHomePage } from './LauncherHomePage';
import { LauncherToolPage } from './LauncherToolPage';

export const LauncherLayout: React.FC<LayoutProps> = ({
	activeTool,
	onSelectTool,
	settings,
	onSettingsChange,
	visibleTools,
	openTools,
	onTogglePin,
	onReorderTools,
	onReorderCategories
}) => {
	const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

	const toggleCategory = (category: string) => {
		setCollapsedCategories(prev => ({ ...prev, [category]: !prev[category] }));
	};

	// Handle clicking on a script tool to edit it
	const handleEditScript = (scriptId: string) => {
		// Store script ID in sessionStorage for userscripts panel to pick up
		sessionStorage.setItem('halo_edit_script', scriptId);
		onSelectTool('userscripts');
	};

	const showPage2 = !!activeTool;

	return (
		<div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
			<div style={{
				flex: 1,
				display: 'flex',
				width: '200%',
				height: '100%',
				transform: showPage2 ? 'translateX(-50%)' : 'translateX(0)',
				transition: 'transform 0.3s cubic-bezier(0.4, 0.0, 0.2, 1)',
				minHeight: 0,
			}}>
				{/* PAGE 1: HOME */}
				<div style={{ width: '50%', height: '100%', flexShrink: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
					<LauncherHomePage
						visibleTools={visibleTools}
						settings={settings}
						onSelectTool={onSelectTool}
						collapsedCategories={collapsedCategories}
						toggleCategory={toggleCategory}
						onTogglePin={onTogglePin}
						onReorderTools={onReorderTools}
						onReorderCategories={onReorderCategories}
						openTools={openTools}
						onEditScript={handleEditScript}
					/>
				</div>

				{/* PAGE 2: TOOLS / SETTINGS / STORE */}
				<div style={{ width: '50%', height: '100%', flexShrink: 0, background: 'var(--halo-bg)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
					<LauncherToolPage
						activeTool={activeTool}
						openTools={openTools}
						onSettingsChange={onSettingsChange}
					/>
				</div>
			</div>
		</div>
	);
};

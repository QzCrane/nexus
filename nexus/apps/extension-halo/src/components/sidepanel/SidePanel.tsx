// goal: SidePanel container and state manager
// eff: Handles global state and initialization (Launcher Mode Only)

import React from 'react';
import { useTranslation } from '../../i18n';
import { LauncherHeader } from './LauncherHeader';
import { DockTabBar } from './DockTabBar';
import { LauncherLayout } from './LauncherLayout';
import { useSidePanelState } from './use-sidepanel-state';
import { EngineStatusProvider } from './EngineStatusProvider';
import { ActiveServicesProvider } from './ActiveServicesContext';

export const SidePanel: React.FC = () => {
	const { t, ready: i18nReady } = useTranslation();
	const {
		loading,
		modulesLoading,
		activeTool,
		openTools,
		settings,
		visibleTools,
		handleToolSelect,
		handleCloseTool,
		handleBack,
		handleSettingsChange,
		handleTogglePin,
		handleReorderTools,
		handleReorderCategories
	} = useSidePanelState();

	if (loading || !i18nReady || modulesLoading) {
		return (
			<div style={{
				display: 'flex', flexDirection: 'column', alignItems: 'center', 
				justifyContent: 'center', height: '100%', 
				background: 'var(--halo-bg, #1a1a1a)', color: 'var(--halo-text-secondary, #888)'
			}}>
				<span style={{ fontSize: '24px', marginBottom: '8px' }}>🌟</span>
				<span>{t('common.loading')}</span>
			</div>
		);
	}

	const hasDock = openTools.some(id => {
		const tool = visibleTools.find(m => m.id === id);
		return tool && !tool.system && id !== 'settings' && id !== 'module-store' && id !== 'permissions';
	});

	return (
		<ActiveServicesProvider>
			<EngineStatusProvider>
				<div style={{ 
					position: 'relative', width: '100%', height: '100%', 
					overflow: 'hidden', background: 'var(--halo-bg, #1a1a1a)', 
					color: 'var(--halo-text)', display: 'flex', flexDirection: 'column'
				}}>
					{/* GLOBAL PERSISTENT HEADER: NEVER ANIMATES, FIXED AT TOP */}
					<LauncherHeader
						activeTool={activeTool}
						visibleTools={visibleTools}
						onBack={handleBack}
						onSelectTool={handleToolSelect}
						hideBorder={hasDock}
					/>

					{/* DOCK TAB BAR: macOS-style tab switcher below header */}
					<DockTabBar
						openTools={openTools}
						activeTool={activeTool}
						visibleTools={visibleTools}
						onSelectTool={handleToolSelect}
						onCloseTool={handleCloseTool}
					/>

					{/* Main Content Area (Layout with slide transitions) */}
					<main style={{ flex: 1, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
						<LauncherLayout
							activeTool={activeTool}
							openTools={openTools || []}
							onCloseTool={handleCloseTool}
							onSelectTool={handleToolSelect}
							onBack={handleBack}
							settings={settings}
							onSettingsChange={handleSettingsChange}
							visibleTools={visibleTools}
							onTogglePin={handleTogglePin}
							onReorderTools={handleReorderTools}
							onReorderCategories={handleReorderCategories}
						/>
					</main>
				</div>
			</EngineStatusProvider>
		</ActiveServicesProvider>
	);
};

// goal: SidePanel container and state manager
// eff: Handles global state via SidePanelContext (Launcher Mode Only)

import React, { useMemo } from 'react';
import { useTranslation } from '../../i18n';
import { LauncherHeader } from './LauncherHeader';
import { DockTabBar } from './DockTabBar';
import { LauncherLayout } from './LauncherLayout';
import { useSidePanelState } from './use-sidepanel-state';
import { EngineStatusProvider } from './EngineStatusProvider';
import { ActiveServicesProvider } from './ActiveServicesContext';
import { SidePanelProvider, type SidePanelContextValue } from './SidePanelContext';
import { ToastProvider } from '../ToastProvider';

export const SidePanel: React.FC = () => {
	const { t, ready: i18nReady } = useTranslation();
	const state = useSidePanelState();

	// Memoize context value to prevent unnecessary re-renders
	const contextValue: SidePanelContextValue = useMemo(() => ({
		activeTool: state.activeTool,
		openTools: state.openTools,
		settings: state.settings,
		visibleTools: state.visibleTools,
		loading: state.loading,
		modulesLoading: state.modulesLoading,
		handleToolSelect: state.handleToolSelect,
		handleCloseTool: state.handleCloseTool,
		handleBack: state.handleBack,
		handleSettingsChange: state.handleSettingsChange,
		handleTogglePin: state.handleTogglePin,
		handleReorderTools: state.handleReorderTools,
		handleReorderCategories: state.handleReorderCategories,
	}), [state]);

	if (state.loading || !i18nReady || state.modulesLoading) {
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

	const hasDock = state.openTools.some(id => {
		const tool = state.visibleTools.find(m => m.id === id);
		return tool && !tool.system && id !== 'settings' && id !== 'module-store' && id !== 'permissions';
	});

	return (
		<SidePanelProvider value={contextValue}>
			<ToastProvider>
				<ActiveServicesProvider>
					<EngineStatusProvider>
						<div style={{ 
							position: 'relative', width: '100%', height: '100%', 
							overflow: 'hidden', background: 'var(--halo-bg, #1a1a1a)', 
							color: 'var(--halo-text)', display: 'flex', flexDirection: 'column'
						}}>
						{/* GLOBAL PERSISTENT HEADER: NEVER ANIMATES, FIXED AT TOP */}
						<LauncherHeader
							activeTool={state.activeTool}
							visibleTools={state.visibleTools}
							onBack={state.handleBack}
							onSelectTool={state.handleToolSelect}
							hideBorder={hasDock}
						/>

						{/* DOCK TAB BAR: macOS-style tab switcher below header */}
						<DockTabBar
							openTools={state.openTools}
							activeTool={state.activeTool}
							visibleTools={state.visibleTools}
							onSelectTool={state.handleToolSelect}
							onCloseTool={state.handleCloseTool}
						/>

						{/* Main Content Area (Layout with slide transitions) */}
						<main style={{ flex: 1, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
							<LauncherLayout
								activeTool={state.activeTool}
								openTools={state.openTools || []}
								onCloseTool={state.handleCloseTool}
								onSelectTool={state.handleToolSelect}
								onBack={state.handleBack}
								settings={state.settings}
								onSettingsChange={state.handleSettingsChange}
								visibleTools={state.visibleTools}
								onTogglePin={state.handleTogglePin}
								onReorderTools={state.handleReorderTools}
								onReorderCategories={state.handleReorderCategories}
							/>
						</main>
					</div>
				</EngineStatusProvider>
			</ActiveServicesProvider>
		</ToastProvider>
	</SidePanelProvider>
	);
};


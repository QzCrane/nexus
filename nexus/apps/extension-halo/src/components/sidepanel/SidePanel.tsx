// goal: SidePanel container and state manager
// eff: Launcher mode runtime with only contexts that have live consumers

import type React from 'react';
import { useMemo } from 'react';
import { useTranslation } from '../../i18n';
import { LauncherHeader } from './LauncherHeader';
import { DockTabBar } from './DockTabBar';
import { LauncherLayout } from './LauncherLayout';
import { useSidePanelState } from './use-sidepanel-state';
import { EngineStatusProvider } from './EngineStatusProvider';
import { ActiveServicesProvider } from './ActiveServicesContext';
import { StorageHealthBanner } from './StorageHealthBanner';
import { OverlayProvider } from '../ui/overlay';

export const SidePanel: React.FC = () => {
	const { t, ready: i18nReady } = useTranslation();
	const state = useSidePanelState();
	const visibleToolById = useMemo(
		() => new Map(state.visibleTools.map((tool) => [tool.id, tool])),
		[state.visibleTools],
	);

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

	const hasDock = state.openTools.some(
		(id) => visibleToolById.get(id)?.pluginType !== 'system',
	);

	return (
		<OverlayProvider>
			<ActiveServicesProvider>
				<EngineStatusProvider>
					<div style={{ 
						position: 'relative', width: '100%', height: '100%', 
						overflow: 'hidden', background: 'var(--halo-bg, #1a1a1a)', 
						color: 'var(--halo-text)', display: 'flex', flexDirection: 'column'
					}}>
						<LauncherHeader
							activeTool={state.activeTool}
							visibleTools={state.visibleTools}
							onBack={state.handleBack}
							onSelectTool={state.handleToolSelect}
							hideBorder={hasDock}
						/>

						<StorageHealthBanner />
						<DockTabBar
							openTools={state.openTools}
							activeTool={state.activeTool}
							visibleTools={state.visibleTools}
							onSelectTool={state.handleToolSelect}
							onCloseTool={state.handleCloseTool}
						/>

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
		</OverlayProvider>
	);
};

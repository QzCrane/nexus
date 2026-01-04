import React from 'react';
import { OverlayProvider } from '../ui/overlay';
import { ActiveServicesProvider } from './ActiveServicesContext';
import { EngineStatusProvider } from './EngineStatusProvider';
import { SidePanelProvider, type SidePanelContextValue } from './SidePanelContext';

interface AppProvidersProps {
	children: React.ReactNode;
	sidePanelValue: SidePanelContextValue;
}

/**
 * Unified provider wrapper for the application
 * eff: Centralizes global state providers for cleaner layout
 */
export const AppProviders: React.FC<AppProvidersProps> = ({ children, sidePanelValue }) => {
	return (
		<SidePanelProvider value={sidePanelValue}>
			<OverlayProvider>
				<ActiveServicesProvider>
					<EngineStatusProvider>
						{children}
					</EngineStatusProvider>
				</ActiveServicesProvider>
			</OverlayProvider>
		</SidePanelProvider>
	);
};

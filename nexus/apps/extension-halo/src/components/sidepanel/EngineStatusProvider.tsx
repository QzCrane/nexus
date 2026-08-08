import type React from 'react';
import { createContext, useContext, useMemo } from 'react';
import { useActiveServices } from './ActiveServicesContext';

export interface EngineStatus {
	smoothScroll: boolean;
	userscripts: boolean;
	clipboard: boolean;
}

const EngineStatusContext = createContext<EngineStatus>({
	smoothScroll: false,
	userscripts: false,
	clipboard: false,
});

/**
 * Pure projection of the SidePanel runtime-status authority.
 * ActiveServicesProvider owns the only storage read/listener lifecycle.
 */
export const EngineStatusProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const { activeServices } = useActiveServices();
	const smoothScroll = activeServices.has('smooth-scroll');
	const userscripts = activeServices.has('userscripts');
	const clipboard = activeServices.has('clipboard');
	const status = useMemo<EngineStatus>(() => ({
		smoothScroll,
		userscripts,
		clipboard,
	}), [smoothScroll, userscripts, clipboard]);

	return (
		<EngineStatusContext.Provider value={status}>
			{children}
		</EngineStatusContext.Provider>
	);
};

export const useEngineStatus = () => useContext(EngineStatusContext);

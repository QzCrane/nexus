import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Toggle, Card } from '@nexus/ui-kit';
import { createLogger } from '@nexus/kernel';

const logger = createLogger('Popup', 'HALO');

const App = () => {
	const [isDark, setIsDark] = useState(false);

	useEffect(() => {
		chrome.storage.sync.get(['halo_dark_mode'], (result) => {
			setIsDark(result.halo_dark_mode || false);
		});
	}, []);

	const toggleDarkMode = async (newState: boolean) => {
		setIsDark(newState);
		
		// Persist state
		await chrome.storage.sync.set({ halo_dark_mode: newState });
		logger.log(`Dark mode ${newState ? 'enabled' : 'disabled'}`);

		// Notify all tabs
		const tabs = await chrome.tabs.query({});
		for (const tab of tabs) {
			if (tab.id) {
				chrome.tabs.sendMessage(tab.id, { 
					type: 'HALO_DARK_MODE_TOGGLE', 
					payload: newState 
				}).catch(() => {}); // Ignore unreachable tabs
			}
		}
	};

	return (
		<div style={{ padding: '20px', minWidth: '280px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
			<header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
				<h1 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>HALO</h1>
				<span style={{ fontSize: '10px', background: '#f0f0f0', padding: '2px 6px', borderRadius: '4px' }}>v0.1.0</span>
			</header>

			<Card variant="default" padding="md">
				<Toggle
					checked={isDark}
					onChange={toggleDarkMode}
					label="Dark Mode"
					sublabel="Smart SVG Matrix"
					size="md"
				/>
			</Card>

			<Card variant="outlined" padding="sm">
				<div style={{ fontSize: '12px', color: '#666', textAlign: 'center' }}>
					More features coming soon...
				</div>
			</Card>

			<footer style={{ fontSize: '10px', color: '#999', textAlign: 'center' }}>
				Zero upload • Zero tracking • Zero cost
			</footer>
		</div>
	);
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);

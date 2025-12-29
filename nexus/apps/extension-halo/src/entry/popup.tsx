// goal: HALO popup main entry with dark mode panel integration
// tradeoff: split components for maintainability

import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Toggle, Card } from '@nexus/ui-kit';
import { createLogger } from '@nexus/kernel';
import type { DarkModeConfig, DarkModeFixes, DarkModePreset } from '../modules/dark-mode';
import { DARK_MODE_PRESETS } from '../modules/dark-mode';
import { 
	STORAGE_KEYS, addToWhitelist, removeFromWhitelist, 
	getDarkModeSettings, saveDarkModeConfig, saveDarkModeFixes 
} from '../kernel/storage';
import { DarkModePanel } from '../modules/dark-mode-panel';

const logger = createLogger('Popup', 'HALO');

interface TabStatus { hostname: string; darkModeActive: boolean; }

const App = () => {
	const [isDark, setIsDark] = useState(false);
	const [config, setConfig] = useState<Partial<DarkModeConfig>>({});
	const [fixes, setFixes] = useState<Partial<DarkModeFixes>>({});
	const [tabStatus, setTabStatus] = useState<TabStatus | null>(null);
	const [isWhitelisted, setIsWhitelisted] = useState(false);
	const [showPanel, setShowPanel] = useState(false);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		(async () => {
			const settings = await getDarkModeSettings();
			setIsDark(settings.enabled);
			setConfig(settings.config);
			setFixes(settings.fixes);
			
			try {
				const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
				if (tab?.id) {
					const response = await chrome.tabs.sendMessage(tab.id, { type: 'HALO_GET_STATUS' });
					if (response) {
						setTabStatus(response);
						setIsWhitelisted(settings.whitelist.includes(response.hostname));
					}
				}
			} catch { /* tab not accessible */ }
			setLoading(false);
		})();
	}, []);

	const toggleDarkMode = useCallback(async (newState: boolean) => {
		setIsDark(newState);
		await chrome.storage.sync.set({ [STORAGE_KEYS.DARK_MODE_ENABLED]: newState });
		const tabs = await chrome.tabs.query({});
		for (const tab of tabs) {
			if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'HALO_DARK_MODE_TOGGLE', payload: newState }).catch(() => {});
		}
	}, []);

	const handleConfigChange = useCallback(async (newConfig: Partial<DarkModeConfig>) => {
		setConfig(newConfig);
		await saveDarkModeConfig(newConfig);
		if (isDark) toggleDarkMode(true); // re-apply
	}, [isDark, toggleDarkMode]);

	const handleFixesChange = useCallback(async (newFixes: Partial<DarkModeFixes>) => {
		setFixes(newFixes);
		await saveDarkModeFixes(newFixes);
		if (isDark) toggleDarkMode(true);
	}, [isDark, toggleDarkMode]);

	const handlePresetSelect = useCallback(async (preset: DarkModePreset) => {
		const presetConfig = DARK_MODE_PRESETS[preset];
		setConfig(presetConfig);
		await saveDarkModeConfig(presetConfig);
		if (isDark) toggleDarkMode(true);
	}, [isDark, toggleDarkMode]);

	const toggleWhitelist = useCallback(async () => {
		if (!tabStatus?.hostname) return;
		const newState = !isWhitelisted;
		setIsWhitelisted(newState);
		if (newState) await addToWhitelist(tabStatus.hostname);
		else await removeFromWhitelist(tabStatus.hostname);
		try {
			const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
			if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'HALO_WHITELIST_CHANGED' });
		} catch {}
	}, [tabStatus, isWhitelisted]);

	if (loading) return <div style={{ padding: '20px', width: '348px', textAlign: 'center', color: '#888' }}>Loading...</div>;

	return (
		<div style={{ padding: '16px', width: '348px', display: 'flex', flexDirection: 'column', gap: '12px', fontFamily: 'system-ui', color: '#e0e0e0' }}>
			<header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
					<span style={{ fontSize: '22px' }}>🌓</span>
					<h1 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#fff' }}>HALO</h1>
				</div>
				<span style={{ fontSize: '10px', background: '#333', padding: '3px 8px', borderRadius: '4px', color: '#888' }}>v0.2.0</span>
			</header>

			<Card variant="default" padding="md">
				<Toggle checked={isDark} onChange={toggleDarkMode} label="Dark Mode" sublabel="Dark Reader Engine" size="md" />
			</Card>

			{isDark && (
				<>
					<button onClick={() => setShowPanel(!showPanel)} style={{
						padding: '10px', fontSize: '12px', fontWeight: '500',
						border: '1px solid #444', borderRadius: '6px',
						background: '#2a2a2a', color: '#aaa', cursor: 'pointer',
					}}>
						{showPanel ? '▲ Hide Settings' : '▼ Show Settings'}
					</button>
					{showPanel && (
						<DarkModePanel config={config} fixes={fixes}
							onConfigChange={handleConfigChange} onFixesChange={handleFixesChange} onPresetSelect={handlePresetSelect} />
					)}
				</>
			)}

			{tabStatus?.hostname && (
				<Card variant="outlined" padding="md">
					<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
						<div>
							<div style={{ fontSize: '12px', color: '#888' }}>Current Site</div>
							<div style={{ fontSize: '13px', color: '#e0e0e0', fontWeight: '500' }}>{tabStatus.hostname}</div>
						</div>
						<div style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '4px', background: tabStatus.darkModeActive ? '#4CAF50' : '#9E9E9E', color: 'white' }}>
							{tabStatus.darkModeActive ? 'ACTIVE' : 'OFF'}
						</div>
					</div>
					<button onClick={toggleWhitelist} style={{
						width: '100%', padding: '10px', fontSize: '12px', fontWeight: '500',
						border: isWhitelisted ? '1px solid #f44336' : '1px solid #4CAF50', borderRadius: '8px',
						background: isWhitelisted ? '#3d1b1b' : '#1b3d1b', color: isWhitelisted ? '#ff6e6e' : '#6eff6e', cursor: 'pointer',
					}}>
						{isWhitelisted ? '✓ Whitelisted — Click to enable' : '+ Exclude this site'}
					</button>
				</Card>
			)}

			<div style={{ display: 'flex', justifyContent: 'center', gap: '12px', fontSize: '10px', color: '#666', marginTop: '4px' }}>
				<span>🔒 Zero tracking</span>
				<span>💾 Local only</span>
			</div>
		</div>
	);
};

createRoot(document.getElementById('root')!).render(<App />);

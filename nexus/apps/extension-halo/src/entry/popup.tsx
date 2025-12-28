import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Toggle, Card } from '@nexus/ui-kit';
import { createLogger } from '@nexus/kernel';
import { DARK_MODE_PRESETS, type DarkModePreset } from '@nexus/zen-engine';
import { 
	STORAGE_KEYS, 
	addToWhitelist, 
	removeFromWhitelist, 
	getDarkModeSettings 
} from '../kernel/storage';

const logger = createLogger('Popup', 'HALO');

const PRESET_LABELS: Record<DarkModePreset, { name: string; desc: string }> = {
	default: { name: 'Default', desc: 'Balanced dark mode' },
	highContrast: { name: 'High Contrast', desc: 'Better readability' },
	warm: { name: 'Warm', desc: 'Easier on eyes at night' },
	pure: { name: 'Pure Dark', desc: 'Maximum darkness' },
};

interface TabStatus {
	hostname: string;
	darkModeActive: boolean;
}

const App = () => {
	const [isDark, setIsDark] = useState(false);
	const [preset, setPreset] = useState<DarkModePreset>('default');
	const [tabStatus, setTabStatus] = useState<TabStatus | null>(null);
	const [isWhitelisted, setIsWhitelisted] = useState(false);
	const [loading, setLoading] = useState(true);

	// Load initial state
	useEffect(() => {
		async function init() {
			const settings = await getDarkModeSettings();
			setIsDark(settings.enabled);
			
			// Load saved preset
			const stored = await chrome.storage.sync.get(['halo_dark_preset']);
			if (stored.halo_dark_preset && stored.halo_dark_preset in DARK_MODE_PRESETS) {
				setPreset(stored.halo_dark_preset);
			}

			// Get current tab status
			try {
				const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
				if (tab?.id) {
					const response = await chrome.tabs.sendMessage(tab.id, { type: 'HALO_GET_STATUS' });
					if (response) {
						setTabStatus(response);
						setIsWhitelisted(settings.whitelist.includes(response.hostname));
					}
				}
			} catch (e) {
				logger.warn('Could not get tab status');
			}
			
			setLoading(false);
		}
		init();
	}, []);

	// Toggle global dark mode
	const toggleDarkMode = useCallback(async (newState: boolean) => {
		setIsDark(newState);
		await chrome.storage.sync.set({ [STORAGE_KEYS.DARK_MODE_ENABLED]: newState });
		logger.log(`Dark mode ${newState ? 'enabled' : 'disabled'}`);

		// Notify all tabs
		const tabs = await chrome.tabs.query({});
		for (const tab of tabs) {
			if (tab.id) {
				chrome.tabs.sendMessage(tab.id, { 
					type: 'HALO_DARK_MODE_TOGGLE', 
					payload: newState 
				}).catch(() => {});
			}
		}
	}, []);

	// Change preset
	const changePreset = useCallback(async (newPreset: DarkModePreset) => {
		setPreset(newPreset);
		await chrome.storage.sync.set({ halo_dark_preset: newPreset });
		logger.log(`Preset changed to ${newPreset}`);
		
		// Re-apply if dark mode is on
		if (isDark) {
			const tabs = await chrome.tabs.query({});
			for (const tab of tabs) {
				if (tab.id) {
					chrome.tabs.sendMessage(tab.id, { 
						type: 'HALO_DARK_MODE_TOGGLE', 
						payload: true,
						preset: newPreset
					}).catch(() => {});
				}
			}
		}
	}, [isDark]);

	// Toggle whitelist for current site
	const toggleWhitelist = useCallback(async () => {
		if (!tabStatus?.hostname) return;
		
		const newState = !isWhitelisted;
		setIsWhitelisted(newState);

		if (newState) {
			await addToWhitelist(tabStatus.hostname);
			logger.log(`Added ${tabStatus.hostname} to whitelist`);
		} else {
			await removeFromWhitelist(tabStatus.hostname);
			logger.log(`Removed ${tabStatus.hostname} from whitelist`);
		}

		try {
			const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
			if (tab?.id) {
				await chrome.tabs.sendMessage(tab.id, { type: 'HALO_WHITELIST_CHANGED' });
			}
		} catch (e) {
			// Tab might not be accessible
		}
	}, [tabStatus, isWhitelisted]);

	if (loading) {
		return (
			<div style={{ padding: '20px', width: '348px', textAlign: 'center', color: '#888' }}>
				Loading...
			</div>
		);
	}

	return (
		<div style={{ padding: '16px', width: '348px', display: 'flex', flexDirection: 'column', gap: '12px', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#e0e0e0' }}>
			{/* Header */}
			<header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
					<span style={{ fontSize: '22px' }}>🌓</span>
					<h1 style={{ margin: 0, fontSize: '18px', fontWeight: '600', letterSpacing: '-0.3px', color: '#fff' }}>HALO</h1>
				</div>
				<span style={{ fontSize: '10px', background: '#333', padding: '3px 8px', borderRadius: '4px', color: '#888' }}>
					v0.1.0
				</span>
			</header>

			{/* Global Dark Mode Toggle */}
			<Card variant="default" padding="md">
				<Toggle
					checked={isDark}
					onChange={toggleDarkMode}
					label="Dark Mode"
					sublabel={`<50ms activation • ${PRESET_LABELS[preset].name}`}
					size="md"
				/>
			</Card>

			{/* Preset Selector */}
			{isDark && (
				<Card variant="outlined" padding="sm">
					<div style={{ fontSize: '12px', fontWeight: '500', marginBottom: '8px', color: '#aaa' }}>
						Mode Preset
					</div>
					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
						{(Object.keys(DARK_MODE_PRESETS) as DarkModePreset[]).map((key) => (
							<button
								key={key}
								onClick={() => changePreset(key)}
								style={{
									padding: '8px 10px',
									fontSize: '11px',
									border: preset === key ? '2px solid #4CAF50' : '1px solid #444',
									borderRadius: '6px',
									background: preset === key ? '#1b3d1b' : '#2a2a2a',
									color: preset === key ? '#6eff6e' : '#ccc',
									cursor: 'pointer',
									textAlign: 'left',
									transition: 'all 0.15s'
								}}
							>
								<div style={{ fontWeight: '500' }}>{PRESET_LABELS[key].name}</div>
								<div style={{ fontSize: '10px', opacity: 0.7, marginTop: '2px' }}>{PRESET_LABELS[key].desc}</div>
							</button>
						))}
					</div>
				</Card>
			)}

			{/* Current Site Control */}
			{tabStatus?.hostname && (
				<Card variant="outlined" padding="md">
					<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
						<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
							<div>
								<div style={{ fontSize: '12px', fontWeight: '500', color: '#888' }}>
									Current Site
								</div>
								<div style={{ fontSize: '13px', color: '#e0e0e0', marginTop: '2px', fontWeight: '500' }}>
									{tabStatus.hostname}
								</div>
							</div>
							<div style={{ 
								fontSize: '10px', 
								padding: '3px 8px', 
								borderRadius: '4px',
								background: tabStatus.darkModeActive ? '#4CAF50' : '#9E9E9E',
								color: 'white',
								fontWeight: '500'
							}}>
								{tabStatus.darkModeActive ? 'ACTIVE' : 'OFF'}
							</div>
						</div>
						
						<button
							onClick={toggleWhitelist}
							style={{
								padding: '10px 12px',
								fontSize: '12px',
								fontWeight: '500',
								border: isWhitelisted ? '1px solid #f44336' : '1px solid #4CAF50',
								borderRadius: '8px',
								background: isWhitelisted ? '#3d1b1b' : '#1b3d1b',
								color: isWhitelisted ? '#ff6e6e' : '#6eff6e',
								cursor: 'pointer',
								transition: 'all 0.15s'
							}}
						>
							{isWhitelisted ? '✓ Whitelisted — Click to enable here' : '+ Exclude this site'}
						</button>
					</div>
				</Card>
			)}

			{/* Performance Badge */}
			<div style={{ 
				display: 'flex', 
				justifyContent: 'center', 
				gap: '12px',
				fontSize: '10px', 
				color: '#666',
				marginTop: '4px'
			}}>
				<span>⚡ &lt;50ms</span>
				<span>🔒 Zero tracking</span>
				<span>💾 Local only</span>
			</div>
		</div>
	);
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);

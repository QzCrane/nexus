// goal: User-Agent Switcher panel UI - view and copy UA strings

import type React from 'react';
import { useMemo, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { UA_PRESETS, getCurrentUserAgent, parseUserAgent } from './core';
import { styles } from './panel.styles';

export const UserAgentPanel: React.FC = () => {
	const { t } = useTranslation();
	const currentUA = getCurrentUserAgent();
	const parsed = useMemo(() => parseUserAgent(currentUA), [currentUA]);

	// Copy UA
	const handleCopy = useCallback((ua: string) => {
		navigator.clipboard.writeText(ua);
	}, []);

	// Group presets
	const desktopPresets = UA_PRESETS.filter((p) => !p.name.includes('iPhone') && !p.name.includes('iPad') && !p.name.includes('Android'));
	const mobilePresets = UA_PRESETS.filter((p) => p.name.includes('iPhone') || p.name.includes('iPad') || p.name.includes('Android'));
	const botPresets = UA_PRESETS.filter((p) => p.name.includes('bot'));

	return (
		<div style={styles.wrapper}>
			{/* Current UA */}
			<div style={styles.current}>
				<div style={styles.label}>{t('userAgent.current')}</div>
				<div style={styles.value}>{currentUA}</div>
				<div style={styles.info}>
					<span style={styles.badge}>{parsed.browser}</span>
					<span style={styles.badge}>{parsed.os}</span>
					<span style={styles.badge}>{parsed.device}</span>
				</div>
			</div>

			{/* Presets */}
			<div style={styles.list}>
				{/* Desktop */}
				<div style={styles.section}>💻 Desktop</div>
				{desktopPresets.map((preset) => (
					<button type="button" key={preset.name} style={{ ...styles.item, width: '100%', border: 'none', textAlign: 'left' }} onClick={() => handleCopy(preset.ua)}>
						<span style={styles.icon}>{preset.icon}</span>
						<span style={styles.name}>{preset.name}</span>
						<span style={styles.copyBtn}>📋</span>
					</button>
				))}

				{/* Mobile */}
				<div style={styles.section}>📱 Mobile</div>
				{mobilePresets.map((preset) => (
					<button type="button" key={preset.name} style={{ ...styles.item, width: '100%', border: 'none', textAlign: 'left' }} onClick={() => handleCopy(preset.ua)}>
						<span style={styles.icon}>{preset.icon}</span>
						<span style={styles.name}>{preset.name}</span>
						<span style={styles.copyBtn}>📋</span>
					</button>
				))}

				{/* Bots */}
				<div style={styles.section}>🤖 Bots</div>
				{botPresets.map((preset) => (
					<button type="button" key={preset.name} style={{ ...styles.item, width: '100%', border: 'none', textAlign: 'left' }} onClick={() => handleCopy(preset.ua)}>
						<span style={styles.icon}>{preset.icon}</span>
						<span style={styles.name}>{preset.name}</span>
						<span style={styles.copyBtn}>📋</span>
					</button>
				))}
			</div>
		</div>
	);
};

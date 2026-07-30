// goal: IP Lookup panel UI - query and display IP information

import type React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import type { IpInfo } from './types';
import { getMyIpInfo, lookupIp, isValidIp, formatLocation } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const IpLookupPanel: React.FC = () => {
	const { t } = useTranslation();
	const [query, setQuery] = useToolState<string>('ip-lookup-query', '');
	const [info, setInfo] = useToolState<IpInfo | null>('ip-lookup-info', null);

	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');

	// Load my IP on mount
	useEffect(() => {
		getMyIpInfo().then((data) => {
			setInfo(data);
			setLoading(false);
		});
	}, [setInfo]);

	// Lookup IP
	const handleLookup = useCallback(async () => {
		if (!query.trim()) {
			setLoading(true);
			const data = await getMyIpInfo();
			setInfo(data);
			setLoading(false);
			setError('');
			return;
		}

		if (!isValidIp(query)) {
			setError(t('ipLookup.invalidIp'));
			return;
		}

		setLoading(true);
		setError('');
		const data = await lookupIp(query);
		if (data) {
			setInfo(data);
		} else {
			setError(t('ipLookup.notFound'));
		}
		setLoading(false);
	}, [query, t, setInfo]);

	// Copy IP
	const handleCopy = useCallback(() => {
		if (info?.ip) navigator.clipboard.writeText(info.ip);
	}, [info]);

	return (
		<div style={styles.wrapper}>
			{/* Search */}
			<div style={styles.row}>
				<input
					style={styles.input}
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder={t('ipLookup.placeholder')}
					onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
				/>
				<button type="button" style={styles.btn} onClick={handleLookup}>🔍</button>
			</div>

			{/* Error */}
			{error && <div style={{ color: '#ef4444', fontSize: '12px' }}>{error}</div>}

			{/* Loading */}
			{loading && <div style={styles.loading}>⏳ {t('ipLookup.loading')}</div>}

			{/* Result */}
			{!loading && info && (
				<div style={styles.card}>
					<button
						type="button"
						style={{ ...styles.ip, width: '100%', padding: 0, border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer' }}
						onClick={handleCopy}
					>
						{info.ip} 📋
					</button>
					<div style={styles.grid}>
						<div style={styles.item}>
							<span style={styles.label}>{t('ipLookup.location')}</span>
							<span style={styles.value}>{formatLocation(info)}</span>
						</div>
						{info.org && (
							<div style={styles.item}>
								<span style={styles.label}>{t('ipLookup.org')}</span>
								<span style={styles.value}>{info.org}</span>
							</div>
						)}
						{info.hostname && (
							<div style={styles.item}>
								<span style={styles.label}>{t('ipLookup.hostname')}</span>
								<span style={styles.value}>{info.hostname}</span>
							</div>
						)}
						{info.timezone && (
							<div style={styles.item}>
								<span style={styles.label}>{t('ipLookup.timezone')}</span>
								<span style={styles.value}>{info.timezone}</span>
							</div>
						)}
						{info.loc && (
							<div style={styles.item}>
								<span style={styles.label}>{t('ipLookup.coords')}</span>
								<span style={styles.value}>{info.loc}</span>
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
};

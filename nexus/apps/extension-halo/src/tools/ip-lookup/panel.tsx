// goal: IP Lookup panel UI - query and display IP information

import type React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import type { IpInfo } from './types';
import { formatLocation, getMyIpInfo, ipInfoCodec, isValidIp, lookupIp } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import { useOwnedAsyncTask } from '../../kernel/hooks/use-owned-async-task';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';


export const IpLookupPanel: React.FC = () => {
	const { t } = useTranslation();
	const [query, setQuery] = useToolState<string>('ip-lookup-query', '');
	const [info, setInfo, , infoRecovery] = useToolState<IpInfo | null>('ip-lookup-info', null, { codec: ipInfoCodec });

	const [error, setError] = useState('');
	const task = useOwnedAsyncTask();
	const runLookup = useCallback((lookup: (signal: AbortSignal) => Promise<IpInfo | null>) => {
		const controller = new AbortController();
		return task.run(() => ({ promise: lookup(controller.signal), dispose: () => controller.abort() }));
	}, [task.run]);

	// Load my IP on mount
	useEffect(() => {
		void runLookup(getMyIpInfo).then((outcome) => {
			if (outcome.kind === 'succeeded') setInfo(outcome.value);
		});
		return task.cancel;
	}, [setInfo, runLookup, task.cancel]);

	// Lookup IP
	const handleLookup = useCallback(async () => {
		if (!query.trim()) {
			const outcome = await runLookup(getMyIpInfo);
			if (outcome.kind === 'succeeded') setInfo(outcome.value);
			setError('');
			return;
		}

		if (!isValidIp(query)) {
			setError(t('ipLookup.invalidIp'));
			return;
		}

		setError('');
		const frozenQuery = query;
		const outcome = await runLookup((signal) => lookupIp(frozenQuery, signal));
		if (outcome.kind === 'succeeded' && outcome.value) {
			setInfo(outcome.value);
		} else if (outcome.kind === 'succeeded') {
			setError(t('ipLookup.notFound'));
		}
	}, [query, t, setInfo, runLookup]);

	// Copy IP
	const handleCopy = useCallback(() => {
		if (info?.ip) navigator.clipboard.writeText(info.ip);
	}, [info]);

	return (
		<div style={styles.wrapper}>
			<StorageRecoveryActions recovery={infoRecovery} emptyValue={null} exportName="halo-ip-info-damaged.json" />
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
			{(error || task.error !== null) && <div style={{ color: '#ef4444', fontSize: '12px' }}>{error || String(task.error)}</div>}

			{/* Loading */}
			{task.phase === 'running' && <div style={styles.loading}>⏳ {t('ipLookup.loading')}</div>}

			{/* Result */}
			{task.phase !== 'running' && info && (
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

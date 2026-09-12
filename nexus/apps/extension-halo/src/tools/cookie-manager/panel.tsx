// goal: Cookie Manager panel UI - view and manage cookies

import type React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { CookieInfo } from './types';
import { scanActiveTabCookies, deleteCookie, exportCookies, formatExpiry } from './core';
import { styles } from './panel.styles';
import { usePermission, useToolState } from '../../kernel';
import { useOwnedAsyncTask } from '../../kernel/hooks/use-owned-async-task';


export const CookieManagerPanel: React.FC = () => {
	const { t } = useTranslation();
	const { hasPermission, request } = usePermission('cookies');
	const [cookies, setCookies] = useState<CookieInfo[]>([]);
	const [search, setSearch] = useToolState<string>('cookie-manager', '');
	const [error, setError] = useState<string | null>(null);

	const task = useOwnedAsyncTask();

	// Load cookies
	const loadCookies = useCallback(async () => {
		setError(null);
		const outcome = await task.run(() => scanActiveTabCookies());
		if (outcome.kind === 'succeeded') setCookies(outcome.value.cookies);
		else if (outcome.kind === 'failed') setError(String(outcome.error));
	}, [task.run]);

	useEffect(() => {
		if (hasPermission === true) void loadCookies();
	}, [hasPermission, loadCookies]);

	// Filter cookies
	const filtered = cookies.filter((c) =>
		c.name.toLowerCase().includes(search.toLowerCase()) ||
		c.value.toLowerCase().includes(search.toLowerCase())
	);

	// Delete cookie
	const handleDelete = useCallback(async (cookie: CookieInfo) => {
		setError(null);
		const outcome = await task.run(async () => {
			const ok = await deleteCookie(cookie);
			if (!ok) throw new Error(t('cookieManager.deleteFailed', { defaultValue: 'Cookie deletion failed; the cookie is still present.' }));
			return scanActiveTabCookies();
		});
		if (outcome.kind === 'failed') {
			setError(t('cookieManager.deleteFailed', { defaultValue: 'Cookie deletion failed; the cookie is still present.' }));
		} else if (outcome.kind === 'succeeded') {
			setCookies(outcome.value.cookies);
		}
	}, [task.run, t]);

	// Export all
	const handleExport = useCallback(() => {
		const json = exportCookies(cookies);
		navigator.clipboard.writeText(json);
	}, [cookies]);

	// Copy value
	const handleCopy = useCallback((value: string) => {
		navigator.clipboard.writeText(value);
	}, []);

	if (hasPermission === null || task.phase === 'running') {
		return <div style={styles.empty}>⏳ {t('cookieManager.loading')}</div>;
	}

	if (!hasPermission) {
		return (
			<div style={{ ...styles.wrapper, height: '100%', justifyContent: 'center', alignItems: 'center' }}>
				<div style={{ width: '100%', maxWidth: '320px' }}>
					<Card variant="default" padding="md">
						<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', padding: '32px 16px' }}>
							<span style={{ fontSize: '48px', opacity: 0.8 }}>🔒</span>
							<div style={{ textAlign: 'center' }}>
								<h3 style={{ margin: '0 0 8px 0', color: 'var(--halo-text)' }}>{t('common.permissionRequired')}</h3>
								<p style={{ margin: 0, fontSize: '13px', color: 'var(--halo-text-secondary)' }}>{t('common.permissionDesc')}</p>
							</div>
							<button
								type="button"
								onClick={request}
								style={{
									padding: '8px 24px',
									background: 'var(--halo-accent)',
									color: '#fff',
									border: 'none',
									borderRadius: '6px',
									cursor: 'pointer',
									fontWeight: 500,
								}}
							>
								{t('common.grantPermission')}
							</button>
						</div>
					</Card>
				</div>
			</div>
		);
	}

	return (
		<div style={styles.wrapper}>
			{/* Header */}
			<div style={styles.header}>
				<span style={styles.title}>🍪 {t('cookieManager.title')}</span>
				<span style={styles.count}>{cookies.length} {t('cookieManager.cookies')}</span>
			</div>

			{/* Search & Actions */}
			<div style={styles.row}>
				<input
					style={styles.search}
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					placeholder={t('cookieManager.search')}
				/>
				<button type="button" style={styles.btn} onClick={loadCookies}>🔄</button>
				<button type="button" style={styles.btn} onClick={handleExport}>📋 {t('cookieManager.export', { defaultValue: 'Export JSON' })}</button>
			</div>

			{(error || task.error !== null) && <div style={{ color: '#d33', fontSize: '12px', padding: '4px 0' }}>{error ?? String(task.error)}</div>}

			{/* Cookie List */}
			<Card variant="default" padding="sm">
				<div style={styles.list}>
					{filtered.length === 0 ? (
						<div style={styles.empty}>{t('cookieManager.noCookies')}</div>
					) : (
							filtered.map((cookie) => (
								<div key={JSON.stringify([cookie.storeId ?? '', cookie.partitionKey ?? null, cookie.domain, cookie.path, cookie.name, cookie.hostOnly])} style={styles.item}>
								<div style={styles.itemHeader}>
									<span style={styles.name}>{cookie.name}</span>
									<div style={styles.row}>
										<button type="button" style={styles.btn} onClick={() => handleCopy(cookie.value)}>📋</button>
										<button type="button" style={{ ...styles.btn, ...styles.btnDanger }} onClick={() => handleDelete(cookie)}>🗑️</button>
									</div>
								</div>
								<div style={styles.value}>{cookie.value.slice(0, 100)}{cookie.value.length > 100 ? '...' : ''}</div>
								<div style={styles.meta}>
									<span style={styles.badge}>{cookie.domain}</span>
									{cookie.secure && <span style={styles.badge}>🔒 {t('cookieManager.secure', { defaultValue: 'Secure' })}</span>}
									{cookie.httpOnly && <span style={styles.badge}>{t('cookieManager.httpOnly', { defaultValue: 'HTTP Only' })}</span>}
									<span>{formatExpiry(cookie.expires)}</span>
								</div>
							</div>
						))
					)}
				</div>
			</Card>
		</div>
	);
};

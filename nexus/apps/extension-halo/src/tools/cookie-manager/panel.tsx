// goal: Cookie Manager panel UI - view and manage cookies

import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { CookieInfo } from './types';
import { getCookiesForCurrentTab, deleteCookie, exportCookies, formatExpiry } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const CookieManagerPanel: React.FC = () => {
	const { t } = useTranslation();
	const [cookies, setCookies] = useState<CookieInfo[]>([]);
	const [search, setSearch] = useToolState<string>('cookie-manager' as any, '');

	const [loading, setLoading] = useState(true);

	// Load cookies
	const loadCookies = useCallback(async () => {
		setLoading(true);
		const data = await getCookiesForCurrentTab();
		setCookies(data);
		setLoading(false);
	}, []);

	useEffect(() => { loadCookies(); }, [loadCookies]);

	// Filter cookies
	const filtered = cookies.filter((c) =>
		c.name.toLowerCase().includes(search.toLowerCase()) ||
		c.value.toLowerCase().includes(search.toLowerCase())
	);

	// Delete cookie
	const handleDelete = useCallback(async (cookie: CookieInfo) => {
		await deleteCookie(cookie.name, cookie.domain, cookie.path);
		loadCookies();
	}, [loadCookies]);

	// Export all
	const handleExport = useCallback(() => {
		const json = exportCookies(cookies);
		navigator.clipboard.writeText(json);
	}, [cookies]);

	// Copy value
	const handleCopy = useCallback((value: string) => {
		navigator.clipboard.writeText(value);
	}, []);

	if (loading) {
		return <div style={styles.empty}>⏳ {t('cookieManager.loading')}</div>;
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
				<button style={styles.btn} onClick={loadCookies}>🔄</button>
				<button style={styles.btn} onClick={handleExport}>📋 {t('cookieManager.export', { defaultValue: 'Export JSON' })}</button>
			</div>

			{/* Cookie List */}
			<Card variant="default" padding="sm">
				<div style={styles.list}>
					{filtered.length === 0 ? (
						<div style={styles.empty}>{t('cookieManager.noCookies')}</div>
					) : (
						filtered.map((cookie, i) => (
							<div key={`${cookie.name}-${i}`} style={styles.item}>
								<div style={styles.itemHeader}>
									<span style={styles.name}>{cookie.name}</span>
									<div style={styles.row}>
										<button style={styles.btn} onClick={() => handleCopy(cookie.value)}>📋</button>
										<button style={{ ...styles.btn, ...styles.btnDanger }} onClick={() => handleDelete(cookie)}>🗑️</button>
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

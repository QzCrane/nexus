// goal: Permission manager panel UI

import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { PermissionDef, PermissionState } from './types';
import { useToolState } from '../../kernel';
import {
	OPTIONAL_PERMISSIONS,
	HOST_PERMISSIONS,
	getAllPermissionStates,
	requestPermission,
	requestHostPermission,
	revokePermission,
	revokeHostPermission,
} from './core';
import { styles } from './panel.styles';

// Group permissions by category
const groupByCategory = (perms: PermissionDef[]): Record<string, PermissionDef[]> => {
	const grouped: Record<string, PermissionDef[]> = { basic: [], advanced: [], privacy: [] };
	for (const p of perms) {
		grouped[p.category].push(p);
	}
	return grouped;
};

export const PermissionsPanel: React.FC = () => {
	const { t } = useTranslation();
	const [states, setStates] = useToolState<Record<string, boolean>>('permissions-states' as any, {});
	const [loading, setLoading] = useState<string | null>(null);


	// Load permission states
	useEffect(() => {
		loadStates();
	}, []);

	const loadStates = async () => {
		const allStates = await getAllPermissionStates();
		const stateMap: Record<string, boolean> = {};
		for (const s of allStates) {
			stateMap[s.id] = s.granted;
		}
		setStates(stateMap);
	};

	// Toggle permission
	const handleToggle = useCallback(async (perm: PermissionDef, isHost = false) => {
		setLoading(perm.id);
		const isGranted = states[perm.id];
		
		let success: boolean;
		if (isGranted) {
			success = isHost ? await revokeHostPermission(perm.id) : await revokePermission(perm.id);
		} else {
			success = isHost ? await requestHostPermission(perm.id) : await requestPermission(perm.id);
		}
		
		if (success) {
			await loadStates();
		}
		setLoading(null);
	}, [states]);

	const grouped = groupByCategory(OPTIONAL_PERMISSIONS);
	const categoryLabels: Record<string, string> = {
		basic: t('permissions.categoryBasic'),
		advanced: t('permissions.categoryAdvanced'),
		privacy: t('permissions.categoryPrivacy'),
	};

	const renderPermCard = (perm: PermissionDef, isHost = false) => {
		const isGranted = states[perm.id] || false;
		const isLoading = loading === perm.id;
		
		// Use special key for all hosts permission
		const i18nKey = isHost ? 'allHosts' : perm.id;

		return (
			<div key={perm.id} style={styles.card}>
				<span style={styles.icon}>{perm.icon}</span>
				<div style={styles.info}>
					<div style={styles.name}>{t(`permissions.items.${i18nKey}.name`)}</div>
					<div style={styles.desc}>{t(`permissions.items.${i18nKey}.desc`)}</div>
					{perm.requiredBy.length > 0 && (
						<div style={styles.requiredBy}>🔗 {t('permissions.usedBy')}: {perm.requiredBy.map(id => t(`tools.${id}.name`)).join(', ')}</div>
					)}
				</div>
				{isGranted ? (
					<button
						style={{ ...styles.btn, ...styles.btnRevoke }}
						onClick={() => handleToggle(perm, isHost)}
						disabled={isLoading}
					>
						{isLoading ? '...' : t('permissions.revoke')}
					</button>
				) : (
					<button
						style={{ ...styles.btn, ...styles.btnGrant }}
						onClick={() => handleToggle(perm, isHost)}
						disabled={isLoading}
					>
						{isLoading ? '...' : t('permissions.grant')}
					</button>
				)}
			</div>
		);
	};

	return (
		<div style={styles.wrapper}>
			{/* Header */}
			<Card variant="default" padding="sm">
				<div style={styles.header}>
					<span style={{ fontSize: '24px' }}>🔐</span>
					<div>
						<div style={styles.title}>{t('permissions.title')}</div>
						<div style={styles.subtitle}>{t('permissions.subtitle')}</div>
					</div>
				</div>
			</Card>

			{/* Privacy Warning */}
			<div style={styles.warning}>
				<span>⚠️</span>
				<span>{t('permissions.privacyNote')}</span>
			</div>

			{/* Host Permissions (All Websites) */}
			<div style={styles.category}>{t('permissions.categoryAdvanced')}</div>
			{renderPermCard(HOST_PERMISSIONS, true)}

			{/* Basic Permissions */}
			<div style={styles.category}>{categoryLabels.basic}</div>
			{grouped.basic.map((p) => renderPermCard(p))}

			{/* Privacy Permissions */}
			{grouped.privacy.length > 0 && (
				<>
					<div style={styles.category}>{categoryLabels.privacy}</div>
					{grouped.privacy.map((p) => renderPermCard(p))}
				</>
			)}
		</div>
	);
};

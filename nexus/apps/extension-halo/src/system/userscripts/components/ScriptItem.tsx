// goal: Script item component with enhanced visual design
// eff: Rich colors, gradients, and visual hierarchy

import type React from 'react';
import type { TranslationFunction } from '../../../i18n';
import type { UserScript } from '../types';
import { itemStyles } from '../styles/script-item';

interface ScriptItemProps {
	script: UserScript;
	isFirst: boolean;
	isLast: boolean;
	onToggle: () => void;
	onEdit: () => void;
	onDelete: () => void;
	onTest: () => void;
	onMove: (dir: 'up' | 'down') => void;
	isActive?: boolean;
	t: TranslationFunction;
}

export const ScriptItem: React.FC<ScriptItemProps> = ({
	script, isFirst, isLast, onToggle, onEdit, onDelete, onTest, onMove, isActive, t,
}) => {
	const formatDate = (ts?: number) => {
		if (!ts) return t('userscripts.never', { defaultValue: 'Never' });
		return new Date(ts).toLocaleDateString();
	};

	const isJS = script.type === 'javascript';
	const isManaged = script.managedBy !== undefined;
	const accentColor = isJS ? '#FFD700' : '#2196F3';

	return (
		<div
			style={{
				...itemStyles.card,
				...(script.enabled && isActive ? itemStyles.cardActive : {}),
				...(!script.enabled ? itemStyles.cardDisabled : {}),
				cursor: 'default',
			}}
		>
			{/* Top accent bar */}
			<div style={{ ...itemStyles.accentBar, background: `linear-gradient(90deg, ${accentColor}, transparent)`, opacity: script.enabled ? 0.8 : 0.3 } as React.CSSProperties} />

			{/* Header */}
			<div style={itemStyles.header}>
				<div style={{ ...itemStyles.icon, ...(isJS ? itemStyles.iconJS : itemStyles.iconCSS) }}>{isJS ? '⚡' : '🎨'}</div>
				<div style={itemStyles.info as React.CSSProperties}>
					<div style={itemStyles.name}>{script.name}</div>
					<div style={itemStyles.meta as React.CSSProperties}>
						<span style={{ ...itemStyles.badge, ...(isJS ? itemStyles.badgeJS : itemStyles.badgeCSS) }}>{script.type.toUpperCase()}</span>
						<span style={itemStyles.statusLabel}>
							<span style={{ ...itemStyles.statusDot, ...(isActive && script.enabled ? itemStyles.statusActive : itemStyles.statusInactive) }} />
							{isActive && script.enabled ? t('userscripts.activeOnSite', { defaultValue: 'Active' }) : t('userscripts.inactiveOnSite', { defaultValue: 'Inactive' })}
						</span>
						<span>📍 {script.matches.length}</span>
						<span>▶️ {script.runCount}x</span>
						{script.lastRun && <span>📅 {formatDate(script.lastRun)}</span>}
					</div>
				</div>
				{/* Controls */}
				<div style={itemStyles.controls as React.CSSProperties}>
					<button type="button" style={{ ...itemStyles.reorderBtn, opacity: isFirst || isManaged ? 0.3 : 1, cursor: isFirst || isManaged ? 'not-allowed' : 'pointer' }}
						onClick={(e) => { e.stopPropagation(); if (!isFirst && !isManaged) onMove('up'); }} disabled={isFirst || isManaged} title={t('userscripts.moveUp', { defaultValue: 'Move up' })}>↑</button>
					<button type="button" style={{ ...itemStyles.reorderBtn, opacity: isLast || isManaged ? 0.3 : 1, cursor: isLast || isManaged ? 'not-allowed' : 'pointer' }}
						onClick={(e) => { e.stopPropagation(); if (!isLast && !isManaged) onMove('down'); }} disabled={isLast || isManaged} title={t('userscripts.moveDown', { defaultValue: 'Move down' })}>↓</button>
					<button
						type="button"
						aria-label={script.enabled
							? t('userscripts.disable', { defaultValue: 'Disable script' })
							: t('userscripts.enable', { defaultValue: 'Enable script' })}
						aria-pressed={script.enabled}
						style={{
							...itemStyles.toggle,
							...(script.enabled ? itemStyles.toggleActive : {}),
							padding: 0,
							border: 'none',
						}}
						onClick={onToggle}
						disabled={isManaged}
					>
						<div style={{ ...itemStyles.toggleKnob, left: script.enabled ? '19px' : '3px' } as React.CSSProperties} />
					</button>
				</div>
			</div>

			{/* Actions */}
			{isManaged ? (
				<div style={itemStyles.actions as React.CSSProperties}>
					<span>{t('userscripts.managedByModule', { defaultValue: 'Managed by its packaged module' })}</span>
				</div>
			) : (
				<div style={itemStyles.actions as React.CSSProperties}>
					<button type="button" style={itemStyles.btn} onClick={onEdit}>✏️ {t('userscripts.edit', { defaultValue: 'Edit' })}</button>
					<button type="button" style={{ ...itemStyles.btn, ...itemStyles.btnPrimary }} onClick={onTest}>▶️ {t('userscripts.test', { defaultValue: 'Test' })}</button>
					<button type="button" style={{ ...itemStyles.iconBtn, ...itemStyles.deleteBtn }} onClick={onDelete} title={t('userscripts.delete', { defaultValue: 'Delete' })}>🗑️</button>
				</div>
			)}
		</div>
	);
};

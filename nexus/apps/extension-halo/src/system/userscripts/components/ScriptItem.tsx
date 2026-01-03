// goal: Script item component with enhanced visual design
// eff: Rich colors, gradients, and visual hierarchy

import React from 'react';
import type { UserScript } from '../types';
import { itemStyles } from '../styles/script-item';

type TFunc = (key: string, opts?: { defaultValue?: string } & Record<string, any>) => string;

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
	t: TFunc;
}

export const ScriptItem: React.FC<ScriptItemProps> = ({
	script, isFirst, isLast, onToggle, onEdit, onDelete, onTest, onMove, isActive, t,
}) => {
	const formatDate = (ts?: number) => {
		if (!ts) return t('userscripts.never', { defaultValue: 'Never' });
		return new Date(ts).toLocaleDateString();
	};

	const isJS = script.type === 'javascript';
	const accentColor = isJS ? '#FFD700' : '#2196F3';

	return (
		<div
			style={{
				...itemStyles.card,
				...(script.enabled && isActive ? itemStyles.cardActive : {}),
				...(!script.enabled ? itemStyles.cardDisabled : {}),
			}}
			onClick={onEdit}
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
					<button style={{ ...itemStyles.reorderBtn, opacity: isFirst ? 0.3 : 1, cursor: isFirst ? 'not-allowed' : 'pointer' }}
						onClick={(e) => { e.stopPropagation(); if (!isFirst) onMove('up'); }} disabled={isFirst} title={t('userscripts.moveUp', { defaultValue: 'Move up' })}>↑</button>
					<button style={{ ...itemStyles.reorderBtn, opacity: isLast ? 0.3 : 1, cursor: isLast ? 'not-allowed' : 'pointer' }}
						onClick={(e) => { e.stopPropagation(); if (!isLast) onMove('down'); }} disabled={isLast} title={t('userscripts.moveDown', { defaultValue: 'Move down' })}>↓</button>
					<div style={{ ...itemStyles.toggle, ...(script.enabled ? itemStyles.toggleActive : {}) }} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
						<div style={{ ...itemStyles.toggleKnob, left: script.enabled ? '19px' : '3px' } as React.CSSProperties} />
					</div>
				</div>
			</div>

			{/* Actions */}
			<div style={itemStyles.actions as React.CSSProperties}>
				<button style={itemStyles.btn} onClick={(e) => { e.stopPropagation(); onEdit(); }}>✏️ {t('userscripts.edit', { defaultValue: 'Edit' })}</button>
				<button style={{ ...itemStyles.btn, ...itemStyles.btnPrimary }} onClick={(e) => { e.stopPropagation(); onTest(); }}>▶️ {t('userscripts.test', { defaultValue: 'Test' })}</button>
				<button style={{ ...itemStyles.iconBtn, ...itemStyles.deleteBtn }} onClick={(e) => { e.stopPropagation(); onDelete(); }} title={t('userscripts.delete', { defaultValue: 'Delete' })}>🗑️</button>
			</div>
		</div>
	);
};

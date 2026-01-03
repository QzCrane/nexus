import React from 'react';
import type { UserScript } from '../types';
import { styles } from '../styles';

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
	script,
	isFirst,
	isLast,
	onToggle,
	onEdit,
	onDelete,
	onTest,
	onMove,
	isActive,
	t,
}) => {
	const formatDate = (ts?: number) => {
		if (!ts) return t('userscripts.never', { defaultValue: 'Never' });
		return new Date(ts).toLocaleDateString();
	};

	return (
		<div
			style={{
				...styles.scriptCard,
				...(script.enabled ? {} : styles.scriptCardDisabled),
			}}
		>
			<div style={styles.scriptHeader}>
				<div style={styles.scriptInfo}>
					<div style={styles.scriptTitle}>{script.name}</div>
					<div style={styles.scriptMeta}>
						<span style={{
							...styles.scriptBadge,
							...(script.type === 'css' ? styles.scriptBadgeCSS : {}),
						}}>
							{script.type.toUpperCase()}
						</span>
						{/* Active Status */}
						<span style={{ 
							display: 'flex', 
							alignItems: 'center', 
							gap: '4px',
							color: isActive ? '#4CAF50' : 'var(--halo-text-secondary)',
							fontWeight: isActive ? 600 : 400 
						}}>
							<span style={{ 
								width: '6px', 
								height: '6px', 
								borderRadius: '50%', 
								background: isActive ? '#4CAF50' : '#ccc',
								boxShadow: isActive ? '0 0 4px #4CAF50' : 'none'
							}} />
							{isActive ? t('userscripts.activeOnSite', { defaultValue: 'Active' }) : t('userscripts.inactiveOnSite', { defaultValue: 'Inactive' })}
						</span>
						<span>📍 {script.matches.length} {script.matches.length === 1 ? t('userscripts.match', { defaultValue: 'match' }) : t('userscripts.matches', { defaultValue: 'matches' })}</span>
						<span>▶️ {script.runCount}x</span>
						{script.lastRun && <span>📅 {formatDate(script.lastRun)}</span>}
					</div>
				</div>
				<div style={styles.scriptActions}>
					{/* Reorder buttons */}
					<button
						style={{ ...styles.iconBtn, opacity: isFirst ? 0.3 : 1 }}
						onClick={(e) => { e.stopPropagation(); onMove('up'); }}
						disabled={isFirst}
						title={t('userscripts.moveUp', { defaultValue: 'Move up' })}
					>↑</button>
					<button
						style={{ ...styles.iconBtn, opacity: isLast ? 0.3 : 1 }}
						onClick={(e) => { e.stopPropagation(); onMove('down'); }}
						disabled={isLast}
						title={t('userscripts.moveDown', { defaultValue: 'Move down' })}
					>↓</button>
					
					{/* Toggle */}
					<div
						style={{ ...styles.toggle, ...(script.enabled ? styles.toggleActive : {}) }}
						onClick={(e) => { e.stopPropagation(); onToggle(); }}
					>
						<div style={{ ...styles.toggleKnob, left: script.enabled ? '18px' : '2px' }} />
					</div>
				</div>
			</div>
			
			{/* Action row */}
			<div style={{ ...styles.btnGroup, marginTop: '10px' }}>
				<button style={styles.btnSecondary} onClick={onEdit}>✏️ {t('userscripts.edit', { defaultValue: 'Edit' })}</button>
				<button style={styles.btnSecondary} onClick={onTest}>▶️ {t('userscripts.test', { defaultValue: 'Test' })}</button>
				<button
					style={{ ...styles.iconBtn, ...styles.iconBtnDanger }}
					onClick={onDelete}
					title={t('userscripts.delete', { defaultValue: 'Delete' })}
				>🗑️</button>
			</div>
		</div>
	);
};

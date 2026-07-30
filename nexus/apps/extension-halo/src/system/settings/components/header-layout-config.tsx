
import type React from 'react';
import { useState } from 'react';
import { Toggle } from '@nexus/ui-kit';
import { useTranslation } from '../../../i18n';
import { getToolMeta } from '../../../kernel';
import { styles } from '../panel.styles';
import {
	type HeaderLayoutMove,
	moveHeaderLayoutItem,
} from './header-layout-order';

interface HeaderLayoutConfigProps {
	activeTools: string[];
	inactiveTools: string[];
	onChange: (layout: string[]) => void;
}

export const HeaderLayoutConfig: React.FC<HeaderLayoutConfigProps> = ({ activeTools, inactiveTools, onChange }) => {
	const { t } = useTranslation();
	const [draggedItem, setDraggedItem] = useState<string | null>(null);
	const [reorderAnnouncement, setReorderAnnouncement] = useState('');

	const handleDragStart = (e: React.DragEvent, id: string) => {
		setDraggedItem(id);
		e.dataTransfer.effectAllowed = 'move';
	};

	const handleDragOver = (e: React.DragEvent, targetId: string) => {
		e.preventDefault();
		if (!draggedItem || draggedItem === targetId) return;

		const currentIndex = activeTools.indexOf(draggedItem);
		const targetIndex = activeTools.indexOf(targetId);

		if (currentIndex !== -1 && targetIndex !== -1) {
			const newLayout = [...activeTools];
			newLayout.splice(currentIndex, 1);
			newLayout.splice(targetIndex, 0, draggedItem);
			onChange(newLayout);
		}
	};

	const handleToggle = (id: string, checked: boolean) => {
		if (checked) {
			const newLayout = [...activeTools];
			const settingsIndex = newLayout.indexOf('settings');
			if (settingsIndex !== -1) {
				newLayout.splice(settingsIndex, 0, id);
			} else {
				newLayout.push(id);
			}
			onChange(newLayout);
		} else {
			onChange(activeTools.filter(x => x !== id));
		}
	};

	const handleReorderKeyDown = (
		event: React.KeyboardEvent<HTMLButtonElement>,
		id: string,
		label: string,
	): void => {
		const move: HeaderLayoutMove | null = event.key === 'ArrowUp'
			? -1
			: event.key === 'ArrowDown'
				? 1
				: event.key === 'Home'
					? 'first'
					: event.key === 'End'
						? 'last'
						: null;
		if (move === null) return;
		event.preventDefault();
		const next = moveHeaderLayoutItem(activeTools, id, move);
		if (!next) return;
		onChange(next);
		setReorderAnnouncement(t('settings.headerShortcutMoved', {
			defaultValue: `Moved ${label} to position ${next.indexOf(id) + 1}`,
		}));
	};

	const renderItem = (id: string, isActive: boolean) => {
		const meta = getToolMeta(id);
		const icon = meta?.icon || (id === 'userscripts' ? '📜' : '🧩');
		const isSettings = id === 'settings';
		const label = meta ? t(`tools.${id}.name`) : id;

		return (
			<li
				key={id}
				style={{
					...styles.row,
					listStyle: 'none',
					cursor: isActive ? 'grab' : 'default',
					opacity: draggedItem === id ? 0.5 : 1,
					border: draggedItem === id ? '1px dashed var(--halo-accent)' : 'none',
					padding: '8px',
					borderRadius: '6px',
					background: isActive ? 'var(--halo-bg-secondary)' : 'transparent',
					marginBottom: '4px'
				}}
			>
				<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
					{isActive && (
						<button
							type="button"
							draggable
							aria-keyshortcuts="ArrowUp ArrowDown Home End"
							aria-label={t('settings.reorderHeaderShortcut', {
								defaultValue: `Reorder ${label}`,
							})}
							title={t('settings.reorderHeaderShortcutHint', {
								defaultValue: 'Drag, or use Arrow Up/Down, Home, and End',
							})}
							onDragStart={(event) => handleDragStart(event, id)}
							onDragOver={(event) => handleDragOver(event, id)}
							onDragEnd={() => setDraggedItem(null)}
							onKeyDown={(event) => handleReorderKeyDown(event, id, label)}
							style={{
								appearance: 'none',
								background: 'transparent',
								border: 0,
								color: 'var(--halo-text-muted)',
								cursor: 'grab',
								font: 'inherit',
								padding: '2px 4px',
							}}
						>
							⋮⋮
						</button>
					)}
					<div style={styles.label}>
						<span style={{ marginRight: 8, fontSize: '16px' }}>{icon}</span>
						{label}
					</div>
				</div>
				<Toggle
					checked={isActive}
					disabled={isSettings}
					onChange={(checked) => !isSettings && handleToggle(id, checked)}
				/>
			</li>
		);
	};

	return (
		<div>
			<div style={{ ...styles.sectionTitle, marginTop: 16 }}>
				📌 {t('settings.headerShortcuts')}
				<span style={{ fontSize: '11px', fontWeight: 'normal', marginLeft: '8px', opacity: 0.7 }}>
					{t('settings.dragToReorder', { defaultValue: '(Drag to reorder)' })}
				</span>
			</div>
			
			<ul style={{ display: 'flex', flexDirection: 'column', gap: '2px', listStyle: 'none', margin: 0, padding: 0 }}>
				{activeTools.map(id => renderItem(id, true))}
				{inactiveTools.length > 0 && (
					<li
						aria-hidden="true"
						style={{ height: '1px', background: 'var(--halo-border)', margin: '8px 0' }}
					/>
				)}
				{inactiveTools.map(id => renderItem(id, false))}
			</ul>
			<div
				aria-live="polite"
				style={{
					border: 0,
					clip: 'rect(0 0 0 0)',
					height: 1,
					margin: -1,
					overflow: 'hidden',
					padding: 0,
					position: 'absolute',
					whiteSpace: 'nowrap',
					width: 1,
				}}
			>
				{reorderAnnouncement}
			</div>
		</div>
	);
};

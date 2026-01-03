
import React, { useState } from 'react';
import { Toggle } from '@nexus/ui-kit';
import { useTranslation } from '../../../i18n';
import { getToolMeta } from '../../../kernel';
import { styles } from '../panel.styles';

interface HeaderLayoutConfigProps {
	activeTools: string[];
	inactiveTools: string[];
	onChange: (layout: string[]) => void;
}

export const HeaderLayoutConfig: React.FC<HeaderLayoutConfigProps> = ({ activeTools, inactiveTools, onChange }) => {
	const { t } = useTranslation();
	const [draggedItem, setDraggedItem] = useState<string | null>(null);

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

	const renderItem = (id: string, isActive: boolean) => {
		const meta = getToolMeta(id);
		const icon = meta?.icon || (id === 'userscripts' ? '📜' : '🧩');
		const isSettings = id === 'settings';

		return (
			<div
				key={id}
				style={{
					...styles.row,
					cursor: isActive ? 'grab' : 'default',
					opacity: draggedItem === id ? 0.5 : 1,
					border: draggedItem === id ? '1px dashed var(--halo-accent)' : 'none',
					padding: '8px',
					borderRadius: '6px',
					background: isActive ? 'var(--halo-bg-secondary)' : 'transparent',
					marginBottom: '4px'
				}}
				draggable={isActive}
				onDragStart={(e) => isActive && handleDragStart(e, id)}
				onDragOver={(e) => isActive && handleDragOver(e, id)}
				onDragEnd={() => setDraggedItem(null)}
			>
				<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
					{isActive && <span style={{ cursor: 'grab', color: 'var(--halo-text-muted)' }}>⋮⋮</span>}
					<div style={styles.label}>
						<span style={{ marginRight: 8, fontSize: '16px' }}>{icon}</span>
						{meta ? t(`tools.${id}.name`) : id}
					</div>
				</div>
				<Toggle
					checked={isActive}
					disabled={isSettings}
					onChange={(checked) => !isSettings && handleToggle(id, checked)}
				/>
			</div>
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
			
			<div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
				{activeTools.map(id => renderItem(id, true))}
				{inactiveTools.length > 0 && <div style={{ height: '1px', background: 'var(--halo-border)', margin: '8px 0' }} />}
				{inactiveTools.map(id => renderItem(id, false))}
			</div>
		</div>
	);
};

// goal: Launcher category header component
// eff: Handles category collapsible and drag-and-drop visuals

import React from 'react';
import { commonStyles } from './layouts.styles';

interface CategoryHeaderProps {
	cat: string;
	title: string;
	count: number;
	isCollapsed: boolean;
	onToggle: () => void;
	onDragStart: (e: React.DragEvent) => void;
	onDragEnter: () => void;
	onDrop: (e: React.DragEvent) => void;
}

export const CategoryHeader: React.FC<CategoryHeaderProps> = ({
	cat, title, count, isCollapsed, onToggle,
	onDragStart, onDragEnter, onDrop
}) => {
	const isActiveCat = cat === 'active';
	const isScriptsCat = cat === 'scripts';
	const isSystemCat = cat === 'system';
	const isSpecialCat = isActiveCat || isScriptsCat || isSystemCat;

	const catColors = {
		active: { border: '#10b981', bg: 'rgba(76, 175, 80, 0.08)', text: '#10b981', dot: '#4CAF50' },
		scripts: { border: '#f59e0b', bg: 'rgba(245, 158, 11, 0.08)', text: '#f59e0b', dot: '#FFD700' },
		system: { border: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.08)', text: '#8b5cf6', dot: '#9C27B0' },
	};
	const colors = catColors[cat as keyof typeof catColors];

	return (
		<div
			draggable
			onDragStart={onDragStart}
			onDragEnter={onDragEnter}
			onDragOver={(e) => e.preventDefault()}
			onDrop={onDrop}
			style={{
				...commonStyles.categoryTitle as any,
				display: 'flex', justifyContent: 'space-between', alignItems: 'center',
				cursor: 'pointer', padding: '4px',
				borderLeft: isSpecialCat && colors ? `3px solid ${colors.border}` : 'none',
				background: isSpecialCat && colors ? colors.bg : 'transparent'
			}}
			onClick={onToggle}
		>
			<div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
				<span style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', fontSize: '10px', opacity: 0.6 }}>▼</span>
				<div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
					{isSpecialCat && colors && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: colors.dot, boxShadow: `0 0 6px ${colors.dot}` }}></span>}
					<span style={{ color: isSpecialCat && colors ? colors.text : 'inherit', fontWeight: isSpecialCat ? 700 : 600 }}>{title}</span>
				</div>
			</div>
			<span style={{ fontSize: '10px', opacity: 0.6 }}>{count}</span>
		</div>
	);
};

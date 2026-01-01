import React from 'react';
import { useTranslation } from '../../i18n';
import type { ToolId, ToolMeta } from '../../kernel';
import { popOutWindow } from '../../kernel';

interface LauncherHeaderProps {
	activeTool: ToolId | null;
	visibleTools: ToolMeta[];
	onBack: () => void;
	onSelectTool: (id: ToolId) => void;
}

export const LauncherHeader: React.FC<LauncherHeaderProps> = ({
	activeTool,
	visibleTools,
	onBack,
	onSelectTool,
}) => {
	const { t } = useTranslation();
	
	const activeToolMeta = visibleTools.find(tool => tool.id === activeTool);

	return (
		<header style={{ 
			display: 'flex', 
			alignItems: 'center', 
			justifyContent: 'space-between', 
			padding: '0 8px 0 12px',
			height: '44px',
			flexShrink: 0,
			borderBottom: '1px solid var(--halo-border, #333)',
			background: 'var(--halo-bg-secondary, #222)',
			boxSizing: 'border-box',
		}}>
			<div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
				{activeTool ? (
					<>
						<button 
							style={{ 
								background: 'var(--halo-bg-tertiary)', border: 'none', color: 'var(--halo-text)',
								width: '30px', height: '30px', borderRadius: '50%', cursor: 'pointer',
								display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
							}}
							onClick={onBack}
							title={t('common.back')}
						>
							<span style={{ fontSize: '12px', fontWeight: 'bold' }}>←</span>
						</button>
						<div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
							<span style={{ fontSize: '18px' }}>{activeToolMeta?.icon}</span>
							<span style={{ 
								fontSize: '14px', fontWeight: 600, color: 'var(--halo-text)',
								overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
							}}>
								{t(`tools.${activeTool}.name`)}
							</span>
						</div>
					</>
				) : (
					<div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
						<div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
							<span style={{ fontSize: '22px', lineHeight: 1 }}>🌟</span>
							<h1 style={{ 
								margin: 0, fontSize: '18px', fontWeight: 800, 
								color: 'var(--halo-text)', letterSpacing: '-0.02em',
								fontFamily: 'system-ui, -apple-system, sans-serif'
							}}>
								HALO
							</h1>
						</div>
						{/* Tool count badge */}
						<div style={{
							display: 'flex',
							alignItems: 'center',
							gap: '4px',
							padding: '3px 8px',
							borderRadius: '12px',
							background: 'rgba(124, 58, 237, 0.15)',
							border: '1px solid rgba(124, 58, 237, 0.3)',
						}}>
							<span style={{ fontSize: '11px' }}>🧰</span>
							<span style={{ 
								fontSize: '11px', 
								fontWeight: 600,
								color: 'var(--halo-accent)',
								fontVariantNumeric: 'tabular-nums'
							}}>
								{visibleTools.filter(tool => !tool.system && tool.id !== 'permissions').length}
							</span>
						</div>
					</div>
				)}
			</div>

			<div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginLeft: '8px', flexShrink: 0 }}>
				<button 
					style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px', fontSize: '18px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} 
					onClick={popOutWindow}
					title={t('layout.popOut')}
				>📤</button>
				<button
					style={{
						background: activeTool === 'module-store' ? 'var(--halo-bg-tertiary)' : 'transparent',
						border: 'none', borderRadius: '8px', cursor: 'pointer', padding: '4px', fontSize: '18px',
						width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
						boxShadow: activeTool === 'module-store' ? '0 0 0 1px var(--halo-border)' : 'none'
					}}
					onClick={() => onSelectTool('module-store' as ToolId)}
					title={t('tools.module-store.name')}
				>🧩</button>
				<button
					style={{
						background: activeTool === 'permissions' ? 'var(--halo-bg-tertiary)' : 'transparent',
						border: 'none', borderRadius: '8px', cursor: 'pointer', padding: '4px', fontSize: '18px',
						width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
						boxShadow: activeTool === 'permissions' ? '0 0 0 1px var(--halo-border)' : 'none'
					}}
					onClick={() => onSelectTool('permissions' as ToolId)}
					title={t('tools.permissions.name')}
				>🔐</button>
				<button 
					style={{
						background: activeTool === 'settings' ? 'var(--halo-bg-tertiary)' : 'transparent',
						border: 'none', borderRadius: '8px', cursor: 'pointer', padding: '4px', fontSize: '18px',
						width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
						boxShadow: activeTool === 'settings' ? '0 0 0 1px var(--halo-border)' : 'none'
					}}
					onClick={() => onSelectTool('settings' as ToolId)}
					title={t('common.settings')}
				>⚙️</button>
			</div>
		</header>
	);
};

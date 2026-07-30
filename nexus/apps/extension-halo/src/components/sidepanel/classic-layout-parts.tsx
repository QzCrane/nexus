// goal: ClassicLayout sub-components to keep main file under 200 lines

import React from 'react';
import type { ToolId, HaloSettings } from '../../kernel';
import { commonStyles } from './layouts.styles';
import { ToolPanelRenderer } from '../core/tool-panel-renderer';

// Scrollbar CSS injection
export const ScrollbarStyles: React.FC = () => (
	<style>{`
		.halo-scrollbar {
			scrollbar-gutter: stable;
		}
		.halo-scrollbar::-webkit-scrollbar {
			width: 6px;
			height: 6px;
		}
		.halo-scrollbar::-webkit-scrollbar-track {
			background: transparent;
		}
		.halo-scrollbar::-webkit-scrollbar-thumb {
			background: var(--halo-border, #444);
			border-radius: 3px;
		}
		.halo-scrollbar::-webkit-scrollbar-thumb:hover {
			background: var(--halo-text-muted, #666);
		}
	`}</style>
);

// Header component props
interface ClassicHeaderProps {
	showLabels: boolean;
	onToggleLabels: () => void;
	onToggleMode: () => void;
	onSelectTool: (id: ToolId) => void;
	moduleStoreIcon?: string;
	t: (key: string) => string;
}

// Header component
export const ClassicHeader: React.FC<ClassicHeaderProps> = ({
	showLabels,
	onToggleLabels,
	onToggleMode,
	onSelectTool,
	moduleStoreIcon,
	t,
}) => (
	<header style={commonStyles.header}>
		<div style={commonStyles.headerContent}>
			<span style={{ fontSize: '20px' }}>🌟</span>
			<h1 style={commonStyles.title}>HALO</h1>
		</div>
		<div style={commonStyles.headerActions}>
			<button type="button"
				style={{ ...commonStyles.iconBtn, fontSize: '12px', width: 'auto', padding: '0 6px' }}
				onClick={onToggleLabels}
				title={showLabels ? t('layout.hideLabels') : t('layout.showLabels')}
			>
				{showLabels ? '📝' : '✖️'}
			</button>
			<button type="button" style={commonStyles.iconBtn} onClick={onToggleMode} title={`${t('layout.mode')}: ${t('layout.classic')}`}>
				📑
			</button>
			{moduleStoreIcon && (
				<button type="button" style={commonStyles.iconBtn} onClick={() => onSelectTool('module-store')} title={t('tools.module-store.name')}>
					{moduleStoreIcon}
				</button>
			)}
			<button type="button" style={commonStyles.iconBtn} onClick={() => onSelectTool('settings')} title={t('common.settings')}>
				⚙️
			</button>
		</div>
	</header>
);

// Footer component
export const ClassicFooter: React.FC<{ t: (key: string) => string }> = ({ t }) => (
	<div style={commonStyles.footer}>
		<span>🔒 {t('footer.zeroTracking')}</span>
		<span>•</span>
		<span>💾 {t('footer.localOnly')}</span>
	</div>
);

// Overlay Panel for "Launcher-style" tools in Classic mode
interface OverlayPanelProps {
	activeTool: ToolId | null;
	visible: boolean;
	openTools: ToolId[];
	onBack: () => void;
	onSettingsChange: (newSettings: HaloSettings) => void;
	t: (key: string) => string;
}


export const OverlayPanel: React.FC<OverlayPanelProps> = ({
	activeTool,
	visible,
	openTools,
	onBack,
	onSettingsChange,
	t
}) => {
	// Keep track of the tool to display so we preserve content during slide-out animation
	const [renderedTool, setRenderedTool] = React.useState<ToolId | null>(activeTool);

	React.useEffect(() => {
		if (visible && activeTool) {
			setRenderedTool(activeTool);
		}
	}, [visible, activeTool]);

	return (
		<div
			style={{
				position: 'absolute',
				top: 0,
				left: 0,
				width: '100%',
				height: '100%',
				background: 'var(--halo-bg, #1a1a1a)',
				zIndex: 20,
				display: 'flex',
				flexDirection: 'column',
				transform: visible ? 'translateX(0)' : 'translateX(100%)',
				transition: 'transform 0.3s cubic-bezier(0.4, 0.0, 0.2, 1)',
				pointerEvents: visible ? 'auto' : 'none',
				boxShadow: visible ? '-5px 0 15px rgba(0,0,0,0.3)' : 'none',
			}}
		>
			<header style={commonStyles.header}>
				<div style={commonStyles.headerContent}>
					<button type="button"
						style={{ ...commonStyles.iconBtn, width: 'auto', padding: '0 8px', gap: '4px' }}
						onClick={onBack}
						title={t('common.back')}
					>
						<span style={{ fontSize: '18px' }}>←</span>
						<span style={{ fontSize: '14px', fontWeight: 500 }}>{t('common.back')}</span>
					</button>
				</div>
			</header>
			<div className="halo-scrollbar" style={{ ...commonStyles.content, overflowY: 'auto', padding: '16px' }}>
				<ToolPanelRenderer
					activeTool={renderedTool}
					openTools={openTools}
					onSettingsChange={onSettingsChange}
					selectToolText={t('common.selectTool')}
				/>
			</div>
		</div>
	);
};

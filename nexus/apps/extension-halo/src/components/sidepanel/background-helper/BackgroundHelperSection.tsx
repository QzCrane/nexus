// goal: Background Helper Section - main UI component
// eff: Display all global background services with status and controls

import type React from 'react';
import { useTranslation } from '../../../i18n';
import { useBackgroundHelpers } from '../hooks/use-background-helpers';
import { BackgroundHelperItemComponent } from './BackgroundHelperItem';

export const BackgroundHelperSection: React.FC = () => {
	const { t } = useTranslation();
	const { helpers, activeCount, toggleHelper } = useBackgroundHelpers();

	if (helpers.length === 0) return null;

	return (
		<div style={{
			padding: '16px',
			background: 'var(--halo-bg)',
			borderRadius: '12px',
			border: '1px solid var(--halo-border)'
		}}>
			{/* Header */}
			<div style={{
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'space-between',
				marginBottom: '12px',
				paddingBottom: '8px',
				borderBottom: '1px solid var(--halo-border)'
			}}>
				<div style={{
					fontSize: '14px',
					fontWeight: 600,
					color: 'var(--halo-text)',
					display: 'flex',
					alignItems: 'center',
					gap: '8px'
				}}>
					<span>⚡</span>
					<span>{t('backgroundHelper.title', { defaultValue: '后台助手' })}</span>
				</div>
				<div style={{
					fontSize: '12px',
					color: 'var(--halo-text-muted)',
					background: activeCount > 0 ? 'rgba(76, 175, 80, 0.1)' : 'var(--halo-bg-secondary)',
					padding: '2px 8px',
					borderRadius: '12px',
					fontWeight: 500
				}}>
					{activeCount} / {helpers.length} {t('backgroundHelper.running', { defaultValue: '运行中' })}
				</div>
			</div>

			{/* Helper List */}
			<div style={{
				display: 'flex',
				flexDirection: 'column',
				gap: '8px'
			}}>
				{helpers.map(helper => (
					<BackgroundHelperItemComponent
						key={helper.id}
						item={helper}
						onToggle={toggleHelper}
					/>
				))}
			</div>

			{/* Footer Hint */}
			<div style={{
				marginTop: '12px',
				padding: '8px 12px',
				background: 'var(--halo-bg-tertiary)',
				borderRadius: '6px',
				fontSize: '11px',
				color: 'var(--halo-text-muted)',
				lineHeight: '1.4'
			}}>
				💡 {t('backgroundHelper.hint', { defaultValue: '这些工具在后台持续运行，即使关闭面板也保持活跃' })}
			</div>
		</div>
	);
};

// goal: Background Helper Item - individual tool card with status indicator
// eff: Clean, compact display with toggle control

import type React from 'react';
import type { BackgroundHelperItem } from '../hooks/use-background-helpers';

interface BackgroundHelperItemProps {
	item: BackgroundHelperItem;
	onToggle: (id: string, enabled: boolean) => void;
}

export const BackgroundHelperItemComponent: React.FC<BackgroundHelperItemProps> = ({ item, onToggle }) => {
	const { id, name, icon, active, enabled } = item;

	return (
		<div style={{
			display: 'flex',
			alignItems: 'center',
			padding: '10px 12px',
			background: 'var(--halo-bg-secondary)',
			borderRadius: '8px',
			border: '1px solid var(--halo-border)',
			gap: '12px',
			transition: 'all 0.2s ease',
			position: 'relative'
		}}>
			{/* Status Indicator (Left Top Corner) */}
			<div style={{
				position: 'absolute',
				top: '8px',
				left: '8px',
				width: '6px',
				height: '6px',
				borderRadius: '50%',
				background: active ? '#4CAF50' : '#9ca3af',
				boxShadow: active ? '0 0 6px #4CAF50' : 'none',
				animation: active ? 'pulse 2s infinite' : 'none'
			}} />

			{/* Icon */}
			<div style={{
				fontSize: '24px',
				width: '32px',
				height: '32px',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				marginLeft: '8px' // Space for indicator
			}}>
				{icon}
			</div>

			{/* Name & Description */}
			<div style={{ flex: 1, minWidth: 0 }}>
				<div style={{
					fontSize: '13px',
					fontWeight: 500,
					color: 'var(--halo-text)',
					marginBottom: '2px'
				}}>
					{name}
				</div>
				<div style={{
					fontSize: '11px',
					color: 'var(--halo-text-muted)',
					opacity: 0.8
				}}>
					{item.profile.frequency} • {item.profile.descriptionKey.split('.').pop()}
				</div>
			</div>

			{/* Toggle Switch */}
			<label style={{
				position: 'relative',
				display: 'inline-block',
				width: '40px',
				height: '20px',
				cursor: 'pointer'
			}}>
				<input
					type="checkbox"
					checked={enabled}
					onChange={(e) => onToggle(id, e.target.checked)}
					style={{ opacity: 0, width: 0, height: 0 }}
				/>
				<span style={{
					position: 'absolute',
					top: 0,
					left: 0,
					right: 0,
					bottom: 0,
					background: enabled ? '#4CAF50' : '#ccc',
					borderRadius: '20px',
					transition: '0.3s',
					cursor: 'pointer'
				}}>
					<span style={{
						position: 'absolute',
						height: '14px',
						width: '14px',
						left: enabled ? '23px' : '3px',
						bottom: '3px',
						background: 'white',
						borderRadius: '50%',
						transition: '0.3s'
					}} />
				</span>
			</label>

			<style>{`
				@keyframes pulse {
					0%, 100% { opacity: 1; transform: scale(1); }
					50% { opacity: 0.7; transform: scale(1.2); }
				}
			`}</style>
		</div>
	);
};

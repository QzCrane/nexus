// goal: reusable card container component for consistent UI layout (dark theme)

import React from 'react';

export interface CardProps {
	children: React.ReactNode;
	title?: string;
	subtitle?: string;
	className?: string;
	variant?: 'default' | 'outlined' | 'elevated';
	padding?: 'none' | 'sm' | 'md' | 'lg';
}

const PADDING_MAP = {
	none: '0',
	sm: '10px',
	md: '14px',
	lg: '20px'
};

const VARIANT_STYLES = {
	default: {
		background: '#2a2a2a',
		border: 'none',
		boxShadow: 'none'
	},
	outlined: {
		background: 'transparent',
		border: '1px solid #444',
		boxShadow: 'none'
	},
	elevated: {
		background: '#2a2a2a',
		border: 'none',
		boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
	}
};

export function Card({ 
	children, 
	title, 
	subtitle, 
	className = '', 
	variant = 'default',
	padding = 'md'
}: CardProps) {
	const variantStyle = VARIANT_STYLES[variant];

	return (
		<div 
			className={`nexus-card ${className}`}
			style={{
				...variantStyle,
				padding: PADDING_MAP[padding],
				borderRadius: '10px'
			}}
		>
			{(title || subtitle) && (
				<div className="card-header" style={{ marginBottom: padding !== 'none' ? '10px' : '0' }}>
					{title && <div className="card-title" style={{ fontWeight: 600, fontSize: '14px', color: '#fff' }}>{title}</div>}
					{subtitle && <div className="card-subtitle" style={{ fontSize: '12px', color: '#888' }}>{subtitle}</div>}
				</div>
			)}
			{children}
		</div>
	);
}

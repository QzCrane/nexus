// goal: reusable card container component for consistent UI layout

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
	sm: '8px',
	md: '15px',
	lg: '20px'
};

const VARIANT_STYLES = {
	default: {
		background: 'var(--card-bg, #f8f9fa)',
		border: 'none',
		boxShadow: 'none'
	},
	outlined: {
		background: 'transparent',
		border: '1px solid var(--border-color, #e0e0e0)',
		boxShadow: 'none'
	},
	elevated: {
		background: 'var(--card-bg, #fff)',
		border: 'none',
		boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
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
				borderRadius: '8px'
			}}
		>
			{(title || subtitle) && (
				<div className="card-header" style={{ marginBottom: padding !== 'none' ? '10px' : '0' }}>
					{title && <div className="card-title" style={{ fontWeight: 600, fontSize: '14px' }}>{title}</div>}
					{subtitle && <div className="card-subtitle" style={{ fontSize: '12px', color: '#666' }}>{subtitle}</div>}
				</div>
			)}
			{children}
		</div>
	);
}

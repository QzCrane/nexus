// goal: reusable card container component for consistent UI layout (theme-aware)

import React from 'react';

export interface CardProps {
	children: React.ReactNode;
	title?: string;
	subtitle?: string;
	className?: string;
	variant?: 'default' | 'outlined' | 'elevated';
	padding?: 'none' | 'sm' | 'md' | 'lg';
	style?: React.CSSProperties;
}

const PADDING_MAP = {
	none: '0',
	sm: '10px',
	md: '14px',
	lg: '20px'
};

// Use CSS Variables for theme support
const VARIANT_STYLES = {
	default: {
		background: 'var(--halo-bg-tertiary, #2a2a2a)',
		border: 'none',
		boxShadow: 'none'
	},
	outlined: {
		background: 'transparent',
		border: '1px solid var(--halo-border, #444)',
		boxShadow: 'none'
	},
	elevated: {
		background: 'var(--halo-bg-tertiary, #2a2a2a)',
		border: 'none',
		boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
	}
};

export function Card({ 
	children, 
	title, 
	subtitle, 
	className = '', 
	variant = 'default',
	padding = 'md',
	style = {}
}: CardProps) {
	const variantStyle = VARIANT_STYLES[variant];

	return (
		<section
			className={`nexus-card ${className}`}
			style={{
				...variantStyle,
				padding: PADDING_MAP[padding],
				borderRadius: '10px',
				transition: 'background 0.2s, border-color 0.2s',
				...style
			}}
		>
			{(title || subtitle) && (
				<div className="card-header" style={{ marginBottom: padding !== 'none' ? '10px' : '0' }}>
					{title && <h3 className="card-title" style={{ fontWeight: 600, fontSize: '14px', color: 'var(--halo-text, #fff)' }}>{title}</h3>}
					{subtitle && <div className="card-subtitle" style={{ fontSize: '12px', color: 'var(--halo-text-muted, #888)' }}>{subtitle}</div>}
				</div>
			)}
			{children}
		</section>
	);
}

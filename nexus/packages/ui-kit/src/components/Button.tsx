import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
	size?: 'sm' | 'md' | 'lg';
	loading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
	children,
	variant = 'primary',
	size = 'md',
	loading,
	style,
	disabled,
	...props
}) => {
	const baseStyle: React.CSSProperties = {
		display: 'inline-flex',
		alignItems: 'center',
		justifyContent: 'center',
		borderRadius: '6px',
		fontWeight: 500,
		cursor: disabled || loading ? 'not-allowed' : 'pointer',
		transition: 'all 0.2s',
		border: 'none',
		outline: 'none',
		opacity: disabled || loading ? 0.6 : 1,
		padding: size === 'sm' ? '4px 8px' : size === 'lg' ? '10px 20px' : '6px 12px',
		fontSize: size === 'sm' ? '12px' : size === 'lg' ? '16px' : '14px',
	};

	const variantStyles: Record<string, React.CSSProperties> = {
		primary: {
			background: 'var(--halo-primary, #10b981)',
			color: '#fff',
		},
		secondary: {
			background: 'var(--halo-bg-secondary, #333)',
			color: 'var(--halo-text-primary, #fff)',
		},
		ghost: {
			background: 'transparent',
			color: 'var(--halo-text-primary, #fff)',
		},
		danger: {
			background: '#ef4444',
			color: '#fff',
		},
	};

	const finalStyle = {
		...baseStyle,
		...variantStyles[variant],
		...style,
	};

	return (
		<button
			style={finalStyle}
			disabled={disabled || loading}
			{...props}
		>
			{loading ? '...' : children}
		</button>
	);
};

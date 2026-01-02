// goal: Segmented control component for button-style options
// eff: Replaces dropdowns with <= 5 options for better UX

import React from 'react';

export interface SegmentOption<T extends string | number> {
	value: T;
	label: string;
	icon?: string;
}

interface SegmentedControlProps<T extends string | number> {
	options: SegmentOption<T>[];
	value: T;
	onChange: (value: T) => void;
	disabled?: boolean;
	size?: 'sm' | 'md';
}

const baseStyles: Record<string, React.CSSProperties> = {
	wrapper: {
		display: 'inline-flex',
		borderRadius: '6px',
		overflow: 'hidden',
		border: '1px solid var(--halo-border)',
		background: 'var(--halo-bg-tertiary)',
	},
	button: {
		border: 'none',
		background: 'transparent',
		color: 'var(--halo-text-muted)',
		cursor: 'pointer',
		fontWeight: 500,
		transition: 'all 0.15s',
		whiteSpace: 'nowrap',
	},
	buttonActive: {
		background: 'var(--halo-accent)',
		color: '#fff',
	},
	buttonDisabled: {
		cursor: 'not-allowed',
		opacity: 0.5,
	},
};

const sizeStyles = {
	sm: { padding: '4px 8px', fontSize: '11px' },
	md: { padding: '6px 12px', fontSize: '12px' },
};

export function SegmentedControl<T extends string | number>({
	options,
	value,
	onChange,
	disabled = false,
	size = 'md',
}: SegmentedControlProps<T>) {
	return (
		<div style={baseStyles.wrapper}>
			{options.map((opt) => (
				<button
					key={String(opt.value)}
					type="button"
					style={{
						...baseStyles.button,
						...sizeStyles[size],
						...(value === opt.value ? baseStyles.buttonActive : {}),
						...(disabled ? baseStyles.buttonDisabled : {}),
					}}
					onClick={() => !disabled && onChange(opt.value)}
					disabled={disabled}
				>
					{opt.icon && <span style={{ marginRight: '4px' }}>{opt.icon}</span>}
					{opt.label}
				</button>
			))}
		</div>
	);
}

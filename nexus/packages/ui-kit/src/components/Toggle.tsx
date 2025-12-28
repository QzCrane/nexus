// goal: reusable toggle switch component with customizable styling

import React from 'react';

export interface ToggleProps {
	checked: boolean;
	onChange: (checked: boolean) => void;
	label?: string;
	sublabel?: string;
	disabled?: boolean;
	size?: 'sm' | 'md' | 'lg';
	className?: string;
}

const SIZE_MAP = {
	sm: { track: 'w-8 h-4', thumb: 'w-3 h-3', translate: 'translate-x-4' },
	md: { track: 'w-10 h-5', thumb: 'w-4 h-4', translate: 'translate-x-5' },
	lg: { track: 'w-12 h-6', thumb: 'w-5 h-5', translate: 'translate-x-6' }
};

export function Toggle({ 
	checked, 
	onChange, 
	label, 
	sublabel, 
	disabled = false, 
	size = 'md',
	className = '' 
}: ToggleProps) {
	const sizes = SIZE_MAP[size];

	const handleClick = () => {
		if (!disabled) onChange(!checked);
	};

	return (
		<div className={`toggle-wrapper ${className}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
			{(label || sublabel) && (
				<div className="toggle-labels">
					{label && <div className="toggle-label" style={{ fontWeight: 500 }}>{label}</div>}
					{sublabel && <div className="toggle-sublabel" style={{ fontSize: '12px', color: '#666' }}>{sublabel}</div>}
				</div>
			)}
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				disabled={disabled}
				onClick={handleClick}
				className={`toggle-track ${sizes.track}`}
				style={{
					position: 'relative',
					display: 'inline-flex',
					alignItems: 'center',
					borderRadius: '9999px',
					padding: '2px',
					cursor: disabled ? 'not-allowed' : 'pointer',
					opacity: disabled ? 0.5 : 1,
					backgroundColor: checked ? '#6200ee' : '#e0e0e0',
					border: 'none',
					transition: 'background-color 0.2s ease',
					width: size === 'sm' ? '32px' : size === 'md' ? '40px' : '48px',
					height: size === 'sm' ? '16px' : size === 'md' ? '20px' : '24px'
				}}
			>
				<span
					className={`toggle-thumb ${sizes.thumb}`}
					style={{
						display: 'block',
						borderRadius: '9999px',
						backgroundColor: '#fff',
						boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
						transition: 'transform 0.2s ease',
						transform: checked 
							? `translateX(${size === 'sm' ? '16px' : size === 'md' ? '20px' : '24px'})` 
							: 'translateX(0)',
						width: size === 'sm' ? '12px' : size === 'md' ? '16px' : '20px',
						height: size === 'sm' ? '12px' : size === 'md' ? '16px' : '20px'
					}}
				/>
			</button>
		</div>
	);
}

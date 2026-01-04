// goal: Unified search input component
// desc: Standard search input for use in tool panels. Inherits main SearchBar styling.
// rule: ALL search inputs in HALO must use this component for visual consistency.

import React, { useRef, useEffect } from 'react';
import { useTranslation } from '../../i18n';

interface SearchInputProps {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	/** Enable Ctrl+K shortcut to focus */
	enableShortcut?: boolean;
	/** Auto focus on mount */
	autoFocus?: boolean;
	className?: string;
}

const styles: Record<string, React.CSSProperties> = {
	wrapper: {
		display: 'flex',
		alignItems: 'center',
		gap: '8px',
		padding: '8px 12px',
		background: 'var(--halo-bg-secondary)',
		border: '1px solid var(--halo-border)',
		borderRadius: '8px',
		transition: 'border-color 0.15s, box-shadow 0.15s',
		width: '100%',
	},
	wrapperFocus: {
		borderColor: 'var(--halo-accent)',
		boxShadow: '0 0 0 2px var(--halo-accent-alpha, rgba(124, 58, 237, 0.2))',
	},
	icon: {
		fontSize: '14px',
		opacity: 0.6,
		flexShrink: 0,
	},
	input: {
		flex: 1,
		border: 'none',
		background: 'transparent',
		color: 'var(--halo-text)',
		fontSize: '13px',
		outline: 'none',
		minWidth: 0,
	},
	shortcut: {
		fontSize: '10px',
		padding: '2px 6px',
		background: 'var(--halo-bg-tertiary)',
		borderRadius: '4px',
		color: 'var(--halo-text-muted)',
		flexShrink: 0,
	},
};

export const SearchInput: React.FC<SearchInputProps> = ({
	value,
	onChange,
	placeholder,
	enableShortcut = false,
	autoFocus = false,
}) => {
	const { t } = useTranslation();
	const inputRef = useRef<HTMLInputElement>(null);
	const [focused, setFocused] = React.useState(false);

	// Ctrl+K shortcut
	useEffect(() => {
		if (!enableShortcut) return;
		
		const handleGlobalKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
				e.preventDefault();
				inputRef.current?.focus();
			}
		};
		window.addEventListener('keydown', handleGlobalKey);
		return () => window.removeEventListener('keydown', handleGlobalKey);
	}, [enableShortcut]);

	// Auto focus
	useEffect(() => {
		if (autoFocus) {
			inputRef.current?.focus();
		}
	}, [autoFocus]);

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Escape') {
			onChange('');
			inputRef.current?.blur();
		}
	};

	return (
		<div style={{ ...styles.wrapper, ...(focused ? styles.wrapperFocus : {}) }}>
			<span style={styles.icon}>🔍</span>
			<input
				ref={inputRef}
				style={styles.input}
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onFocus={() => setFocused(true)}
				onBlur={() => setFocused(false)}
				onKeyDown={handleKeyDown}
				placeholder={placeholder || t('common.search')}
			/>
			{enableShortcut && !focused && (
				<span style={styles.shortcut}>⌘K</span>
			)}
		</div>
	);
};

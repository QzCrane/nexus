// goal: Command Palette for quick tool access (Ctrl+K)
// eff: Elegant fuzzy search with keyboard navigation

import type React from 'react';
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from '../../i18n';
import type { ToolId } from '../../kernel';
import { resolveCommandPaletteKeyAction } from './command-palette-keyboard';

interface CommandPaletteProps {
	isOpen: boolean;
	onClose: () => void;
	onSelectTool: (toolId: ToolId) => void;
	tools: { id: ToolId; icon: string; name: string; desc: string }[];
}

const styles: Record<string, React.CSSProperties> = {
	overlay: {
		position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
		display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
		paddingTop: '80px', zIndex: 9999, backdropFilter: 'blur(4px)',
	},
	container: {
		width: '100%', maxWidth: '380px', background: 'var(--halo-bg-secondary)',
		borderRadius: '12px', boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
		border: '1px solid var(--halo-border)', overflow: 'hidden',
	},
	input: {
		width: '100%', padding: '16px 20px', fontSize: '14px',
		background: 'transparent', border: 'none', borderBottom: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', outline: 'none',
	},
	list: { maxHeight: '300px', overflowY: 'auto' },
	item: {
		display: 'flex', alignItems: 'center', gap: '12px',
		padding: '12px 16px', cursor: 'pointer', transition: 'var(--halo-motion-transition, background 0.1s)',
	},
	itemActive: { background: 'var(--halo-accent)', color: '#fff' },
	icon: { fontSize: '18px', width: '28px', textAlign: 'center' },
	info: { flex: 1 },
	name: { fontSize: '13px', fontWeight: 500 },
	desc: { fontSize: '11px', opacity: 0.7, marginTop: '2px' },
	hint: {
		padding: '10px 16px', fontSize: '11px', color: 'var(--halo-text-muted)',
		borderTop: '1px solid var(--halo-border)', textAlign: 'center',
	},
	empty: {
		padding: '24px', textAlign: 'center', color: 'var(--halo-text-muted)', fontSize: '13px',
	},
};

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, onSelectTool, tools }) => {
	const { t } = useTranslation();
	const [query, setQuery] = useState('');
	const [activeIndex, setActiveIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	// Fuzzy filter
	const filtered = useMemo(() => {
		if (!query.trim()) return tools;
		const q = query.toLowerCase();
		return tools.filter((tool) =>
			tool.name.toLowerCase().includes(q) ||
			tool.desc.toLowerCase().includes(q) ||
			tool.id.toLowerCase().includes(q)
		);
	}, [query, tools]);

	// Reset on open
	useEffect(() => {
		if (isOpen) {
			setQuery('');
			setActiveIndex(0);
			setTimeout(() => inputRef.current?.focus(), 50);
		}
	}, [isOpen]);

	// Keep active in view
	useEffect(() => {
		const item = listRef.current?.children[activeIndex] as HTMLElement;
		item?.scrollIntoView({ block: 'nearest' });
	}, [activeIndex]);

	// Keyboard navigation
	const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
		const action = resolveCommandPaletteKeyAction(
			e.key,
			e.target === inputRef.current,
		);
		if (action === 'close') {
			onClose();
			return;
		}
		if (action === 'next') {
			e.preventDefault();
			setActiveIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
			return;
		}
		if (action === 'previous') {
			e.preventDefault();
			setActiveIndex((i) => Math.max(i - 1, 0));
			return;
		}
		const activeTool = filtered[activeIndex];
		if (action === 'select-active' && activeTool) {
			e.preventDefault();
			onSelectTool(activeTool.id);
			onClose();
		}
	}, [filtered, activeIndex, onClose, onSelectTool]);

	if (!isOpen) return null;

	return (
		<div style={styles.overlay}>
			<button
				type="button"
				aria-label={t('common.close')}
				onClick={onClose}
				style={{ position: 'absolute', inset: 0, border: 0, padding: 0, background: 'transparent' }}
			/>
			<div style={{ ...styles.container, position: 'relative' }} onKeyDown={handleKeyDown} role="dialog" aria-modal="true">
				<input
					ref={inputRef}
					style={styles.input}
					type="text"
					value={query}
					onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
					placeholder={t('common.search')}
				/>
				<div style={styles.list} ref={listRef}>
					{filtered.length > 0 ? (
						filtered.map((tool, i) => (
							<button
								type="button"
								key={tool.id}
								style={{
									...styles.item,
									...(i === activeIndex ? styles.itemActive : {}),
									width: '100%',
									border: 'none',
									color: 'inherit',
									textAlign: 'left',
								}}
								onClick={() => { onSelectTool(tool.id); onClose(); }}
								onMouseEnter={() => setActiveIndex(i)}
							>
								<span style={styles.icon as React.CSSProperties}>{tool.icon}</span>
								<div style={styles.info}>
									<div style={styles.name}>{tool.name}</div>
									<div style={styles.desc}>{tool.desc}</div>
								</div>
							</button>
						))
					) : (
						<div style={styles.empty}>{t('common.noResults')}</div>
					)}
				</div>
				<div style={styles.hint}>↑↓ Navigate • Enter Select • Esc Close</div>
			</div>
		</div>
	);
};

// goal: Command Palette for quick tool access (Ctrl+K)
// eff: Elegant fuzzy search with keyboard navigation

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from '../../i18n';
import type { ToolId } from '../../kernel';

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
		padding: '12px 16px', cursor: 'pointer', transition: 'background 0.1s',
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
		if (e.key === 'Escape') { onClose(); return; }
		if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, filtered.length - 1)); return; }
		if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); return; }
		if (e.key === 'Enter' && filtered[activeIndex]) {
			onSelectTool(filtered[activeIndex].id);
			onClose();
		}
	}, [filtered, activeIndex, onClose, onSelectTool]);

	// Click outside to close
	const handleOverlayClick = useCallback((e: React.MouseEvent) => {
		if (e.target === e.currentTarget) onClose();
	}, [onClose]);

	if (!isOpen) return null;

	return (
		<div style={styles.overlay} onClick={handleOverlayClick}>
			<div style={styles.container} onKeyDown={handleKeyDown} role="dialog">
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
							<div
								key={tool.id}
								style={{ ...styles.item, ...(i === activeIndex ? styles.itemActive : {}) }}
								onClick={() => { onSelectTool(tool.id); onClose(); }}
								onMouseEnter={() => setActiveIndex(i)}
							>
								<span style={styles.icon as React.CSSProperties}>{tool.icon}</span>
								<div style={styles.info}>
									<div style={styles.name}>{tool.name}</div>
									<div style={styles.desc}>{tool.desc}</div>
								</div>
							</div>
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

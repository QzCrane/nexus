// goal: Emoji Picker panel UI - browse and copy emojis

import type React from 'react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from '../../i18n';
import { EMOJI_CATEGORIES } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


const CATEGORY_ICONS: Record<string, string> = {
	smileys: '😀', gestures: '👋', animals: '🐶', food: '🍎', objects: '💡', symbols: '❤️',
};

export const EmojiPickerPanel: React.FC = () => {
	const { t } = useTranslation();
	const [search, setSearch] = useToolState<string>('emoji-search', '');
	const [category, setCategory] = useToolState<keyof typeof EMOJI_CATEGORIES>('emoji-category', 'smileys');
	const [recent, setRecent] = useToolState<string[]>('emoji-recent', []);


	// Filter emojis
	const emojis = useMemo(() => {
		const list = EMOJI_CATEGORIES[category];
		if (!search) return list;
		return list.filter((e) => e.includes(search));
	}, [category, search]);

	// Copy emoji
	const handleCopy = useCallback((emoji: string) => {
		navigator.clipboard.writeText(emoji);
		setRecent((r) => [emoji, ...r.filter((e) => e !== emoji)].slice(0, 16));
	}, [setRecent]);

	return (
		<div style={styles.wrapper}>
			{/* Search */}
			<input
				style={styles.search}
				value={search}
				onChange={(e) => setSearch(e.target.value)}
				placeholder={t('emoji.search')}
			/>

			{/* Recent */}
			{recent.length > 0 && (
				<div style={styles.recent}>
					<div style={styles.recentLabel}>{t('emoji.recent')}</div>
					<div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
						{recent.map((e) => (
							<button type="button" key={e} style={styles.emoji} onClick={() => handleCopy(e)}>{e}</button>
						))}
					</div>
				</div>
			)}

			{/* Category tabs */}
			<div style={styles.tabs}>
				{Object.keys(EMOJI_CATEGORIES).map((cat) => (
					<button type="button"
						key={cat}
						style={{ ...styles.tab, background: category === cat ? 'var(--halo-bg-secondary)' : 'transparent' }}
						onClick={() => setCategory(cat as keyof typeof EMOJI_CATEGORIES)}
					>
						{CATEGORY_ICONS[cat]}
					</button>
				))}
			</div>

			{/* Emoji grid */}
			<div style={styles.grid}>
				{emojis.map((e) => (
					<button type="button" key={e} style={styles.emoji} onClick={() => handleCopy(e)}>{e}</button>
				))}
			</div>
		</div>
	);
};

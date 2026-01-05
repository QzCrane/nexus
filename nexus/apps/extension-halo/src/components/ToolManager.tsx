import React, { useCallback, useMemo } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../i18n';
import type { ToolCategory } from '../i18n/types';
import type { ToolMeta, ToolPrefs } from '../kernel';
import type { SortMode } from '../kernel';
import { TAXONOMY } from '../kernel/registry/taxonomy';
import { styles } from './ToolManager.styles';
import { ToolManagerItem } from './ToolManagerItem';

interface ToolManagerProps {
  tools: ToolMeta[];
  prefs: Record<string, ToolPrefs>;
  filteredTools: ToolMeta[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  sortMode: SortMode;
  onSortChange: (m: SortMode) => void;
  categoryFilter: ToolCategory | 'all' | 'pinned';
  onCategoryChange: (c: ToolCategory | 'all' | 'pinned') => void;
  onToggleEnabled: (id: string) => void;
  onTogglePinned: (id: string) => void;
  onEnableAll: () => void;
  onDisableAll: () => void;
}

export const ToolManagerPanel: React.FC<ToolManagerProps> = ({
  prefs,
  filteredTools,
  searchQuery,
  onSearchChange,
  categoryFilter,
  onCategoryChange,
  onToggleEnabled,
  onTogglePinned,
  onEnableAll,
  onDisableAll,
}) => {
  const { t } = useTranslation();

  // SSOT: Derive categories from Kernel Taxonomy
  const categories: (ToolCategory | 'all' | 'pinned')[] = useMemo(() => {
    const coreCats = TAXONOMY
      .filter(c => c.id !== 'active') // 'active' is a runtime state, not a persistent filter usually
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(c => c.id);
    
    return ['all', 'pinned', ...coreCats];
  }, []);

  const getPrefs = useCallback((id: string): ToolPrefs => {
    return prefs[id] || { enabled: true, pinned: false, usageCount: 0 };
  }, [prefs]);

  const getCategoryLabel = (cat: ToolCategory | 'all' | 'pinned'): string => {
    if (cat === 'all') return t('common.all');
    if (cat === 'pinned') return t('common.favorites');
    
    const tax = TAXONOMY.find(c => c.id === cat);
    if (tax) return t(tax.i18nKey);
    
    return t(`categories.${cat}`); // Fallback
  };

  return (
    <div style={styles.wrapper}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.title}>{t('toolManager.title')}</span>
        <div style={styles.actions}>
          <button style={styles.btn} onClick={onEnableAll}>
            {t('toolManager.enableAll')}
          </button>
          <button style={styles.btn} onClick={onDisableAll}>
            {t('toolManager.disableAll')}
          </button>
        </div>
      </div>

      {/* Search */}
      <div style={styles.searchWrapper}>
        <span style={styles.searchIcon}>🔍</span>
        <input
          style={styles.searchInput}
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('toolManager.searchPlaceholder')}
        />
      </div>

      {/* Category Filters */}
      <div style={styles.filters}>
        {categories.map((cat) => (
          <button
            key={cat}
            style={{
              ...styles.filterChip,
              ...(categoryFilter === cat ? styles.filterChipActive : {}),
            }}
            onClick={() => onCategoryChange(cat)}
          >
           {/* Add icons if available in Taxonomy */}
           {cat === 'all' && '🖇️ '}
           {cat === 'pinned' && '⭐ '}
           {TAXONOMY.find(c => c.id === cat)?.icon} {getCategoryLabel(cat)}
          </button>
        ))}
      </div>

      {/* Tool List */}
      <Card variant="default" padding="none" style={styles.cardOverride}>
        <div style={styles.list}>
          {filteredTools.length > 0 ? (
            filteredTools.map((tool) => (
              <ToolManagerItem
                key={tool.id}
                tool={tool}
                prefs={getPrefs(tool.id)}
                onTogglePinned={onTogglePinned}
                onToggleEnabled={onToggleEnabled}
              />
            ))
          ) : (
            <div style={styles.empty}>{t('common.noResults')}</div>
          )}
        </div>
      </Card>
    </div>
  );
};

// goal: Tool manager panel UI
// eff: Enable/disable, pin/unpin, category filter, search. Logic split into ToolManagerItem.tsx and ToolManager.styles.ts

import React, { useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../i18n';
import type { ToolCategory } from '../i18n/types';
import type { ToolMeta, ToolPrefs } from '../kernel/tool-registry';
import type { SortMode } from '../kernel/use-tool-manager';
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

const CATEGORY_OPTIONS: (ToolCategory | 'all' | 'pinned')[] = [
  'all', 'pinned', 'general', 'dev', 'efficiency', 'visual',
];

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

  const getPrefs = useCallback((id: string): ToolPrefs => {
    return prefs[id] || { enabled: true, pinned: false, usageCount: 0 };
  }, [prefs]);

  const getCategoryLabel = (cat: ToolCategory | 'all' | 'pinned'): string => {
    if (cat === 'all') return t('common.all');
    if (cat === 'pinned') return t('common.favorites');
    return t(`categories.${cat}`);
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
      <input
        style={styles.searchInput}
        type="text"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={t('toolManager.searchPlaceholder')}
      />

      {/* Category Filters */}
      <div style={styles.filters}>
        {CATEGORY_OPTIONS.map((cat) => (
          <button
            key={cat}
            style={{
              ...styles.filterChip,
              ...(categoryFilter === cat ? styles.filterChipActive : {}),
            }}
            onClick={() => onCategoryChange(cat)}
          >
            {getCategoryLabel(cat)}
          </button>
        ))}
      </div>

      {/* Tool List */}
      <Card variant="default" padding="sm">
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

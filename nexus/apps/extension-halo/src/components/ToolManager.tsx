import { isLaunchablePlugin } from '../kernel';
// goal: Tool manager panel UI
// eff: Enable/disable, pin/unpin, category filter, search

import type React from 'react';
import { useCallback } from 'react';
import { Card, Toggle } from '@nexus/ui-kit';
import { useTranslation } from '../i18n';
import type { ToolCategory } from '../i18n/types';
import type { ToolMeta, ToolPrefs } from '../kernel/registry/tool-registry';
import type { SortMode } from '../kernel/hooks/use-tool-manager';
import { toolManagerStyles as styles } from './styles/tool-manager';

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
      <div style={styles.header}>
        <span style={styles.title}>{t('toolManager.title')}</span>
        <div style={styles.actions}>
          <button type="button" style={styles.btn} onClick={onEnableAll}>
            {t('toolManager.enableAll')}
          </button>
          <button type="button" style={styles.btn} onClick={onDisableAll}>
            {t('toolManager.disableAll')}
          </button>
        </div>
      </div>

      <input
        style={styles.searchInput}
        type="text"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={t('toolManager.searchPlaceholder')}
      />

      <div style={styles.filters}>
        {CATEGORY_OPTIONS.map((cat) => (
          <button
            type="button"
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

      <Card variant="default" padding="sm">
        <div style={styles.list}>
          {filteredTools.length > 0 ? (
            filteredTools.map((tool) => {
              const toolPrefs = getPrefs(tool.id);
              const isSettings = tool.id === 'settings';
              const isReady = isLaunchablePlugin(tool);

              return (
                <div key={tool.id} style={styles.item}>
                  <span style={styles.itemIcon as React.CSSProperties}>{tool.icon}</span>
                  <div style={styles.itemInfo}>
                    <div style={styles.itemName}>
                      {t(`tools.${tool.id}.name`)}
                      {toolPrefs.pinned && (
                        <span style={{
                          ...styles.badge,
                          background: 'var(--halo-accent-alpha)',
                          color: 'var(--halo-accent)',
                        }}>⭐</span>
                      )}
                      {!isReady && (
                        <span style={{
                          ...styles.badge,
                          background: 'var(--halo-warning-alpha, rgba(245, 158, 11, 0.2))',
                          color: 'var(--halo-warning, #f59e0b)',
                        }}>{t('common.comingSoon')}</span>
                      )}
                    </div>
                    <div style={styles.itemDesc}>{t(`tools.${tool.id}.desc`)}</div>
                  </div>

                  <button
                    type="button"
                    style={styles.pinBtn}
                    onClick={() => onTogglePinned(tool.id)}
                    title={toolPrefs.pinned ? t('toolManager.unpin') : t('toolManager.pin')}
                  >
                    {toolPrefs.pinned ? '⭐' : '☆'}
                  </button>

                  {isReady && !isSettings && (
                    <Toggle
                      checked={toolPrefs.enabled}
                      onChange={() => onToggleEnabled(tool.id)}
                    />
                  )}
                </div>
              );
            })
          ) : (
            <div style={styles.empty}>{t('common.noResults')}</div>
          )}
        </div>
      </Card>
    </div>
  );
};

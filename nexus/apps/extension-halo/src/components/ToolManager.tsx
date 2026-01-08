// goal: Tool manager panel UI
// eff: Enable/disable, pin/unpin, category filter, search

import React, { useCallback } from 'react';
import { Card, Toggle } from '@nexus/ui-kit';
import { useTranslation } from '../i18n';
import type { ToolCategory } from '../i18n/types';
import type { ToolMeta, ToolPrefs } from '../kernel/tool-registry';
import type { SortMode } from '../kernel/use-tool-manager';

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

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--halo-text)',
  },
  actions: {
    display: 'flex',
    gap: '8px',
  },
  btn: {
    padding: '6px 10px',
    fontSize: '11px',
    background: 'var(--halo-bg-tertiary)',
    border: '1px solid var(--halo-border)',
    borderRadius: '6px',
    color: 'var(--halo-text-secondary)',
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  searchInput: {
    width: '100%',
    padding: '10px 12px',
    background: 'var(--halo-bg-secondary)',
    border: '1px solid var(--halo-border)',
    borderRadius: '8px',
    color: 'var(--halo-text)',
    fontSize: '13px',
    outline: 'none',
  },
  filters: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  },
  filterChip: {
    padding: '6px 12px',
    fontSize: '11px',
    background: 'var(--halo-bg-tertiary)',
    border: '1px solid var(--halo-border)',
    borderRadius: '20px',
    color: 'var(--halo-text-secondary)',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  filterChipActive: {
    background: 'var(--halo-accent)',
    borderColor: 'var(--halo-accent)',
    color: '#fff',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxHeight: '400px',
    overflowY: 'auto',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px',
    background: 'var(--halo-bg-secondary)',
    borderRadius: '8px',
    border: '1px solid var(--halo-border)',
  },
  itemIcon: {
    fontSize: '20px',
    width: '32px',
    textAlign: 'center',
  },
  itemInfo: {
    flex: 1,
    minWidth: 0,
  },
  itemName: {
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--halo-text)',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  itemDesc: {
    fontSize: '11px',
    color: 'var(--halo-text-muted)',
    marginTop: '2px',
  },
  pinBtn: {
    width: '28px',
    height: '28px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    transition: 'background 0.15s',
  },
  badge: {
    fontSize: '9px',
    padding: '2px 6px',
    borderRadius: '4px',
  },
  empty: {
    padding: '24px',
    textAlign: 'center',
    color: 'var(--halo-text-muted)',
    fontSize: '13px',
  },
};

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
            filteredTools.map((tool) => {
              const toolPrefs = getPrefs(tool.id);
              const isSettings = tool.id === 'settings';
              const isReady = tool.status === 'ready' || tool.status === 'beta';

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

                  {/* Pin button */}
                  <button
                    style={styles.pinBtn}
                    onClick={() => onTogglePinned(tool.id)}
                    title={toolPrefs.pinned ? t('toolManager.unpin') : t('toolManager.pin')}
                  >
                    {toolPrefs.pinned ? '⭐' : '☆'}
                  </button>

                  {/* Enable toggle */}
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

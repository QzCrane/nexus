// goal: Sub-component for ToolManager list items
// eff: Extracted to reduce ToolManager.tsx size

import type React from 'react';
import { Toggle } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { ToolMeta, ToolPrefs } from '../../kernel';
import { styles } from './ToolManager.styles';

interface ToolManagerItemProps {
  tool: ToolMeta;
  prefs: ToolPrefs;
  onTogglePinned: (id: string) => void;
  onToggleEnabled: (id: string) => void;
}

export const ToolManagerItem: React.FC<ToolManagerItemProps> = ({
  tool,
  prefs,
  onTogglePinned,
  onToggleEnabled,
}) => {
  const { t } = useTranslation();
  const isSettings = tool.id === 'settings';
  const isReady = tool.status === 'ready' || tool.status === 'beta';

  return (
    <div style={styles.item}>
      <span style={styles.itemIcon as React.CSSProperties}>{tool.icon}</span>
      <div style={styles.itemInfo}>
        <div style={styles.itemName}>
          {t(`tools.${tool.id}.name`)}
          {prefs.pinned && (
             <span style={{ fontSize: '10px', marginLeft: '4px' }}>⭐</span>
          )}
          {!isReady && (
            <span style={{
              ...styles.badge,
              background: 'var(--halo-warning-alpha, rgba(245, 158, 11, 0.2))',
              color: 'var(--halo-warning, #f59e0b)',
              marginLeft: '6px'
            }}>{t('common.comingSoon')}</span>
          )}
        </div>
        <div style={styles.itemDesc}>{t(`tools.${tool.id}.desc`)}</div>
      </div>

      {/* Pin button */}
      <button type="button"
        style={{
          ...styles.pinBtn,
          color: prefs.pinned ? 'var(--halo-accent)' : 'var(--halo-text-muted)',
          opacity: prefs.pinned ? 1 : 0.6,
        }}
        onClick={() => onTogglePinned(tool.id)}
        title={prefs.pinned ? t('toolManager.unpin') : t('toolManager.pin')}
      >
        {prefs.pinned ? '★' : '☆'}
      </button>

      {/* Enable toggle */}
      {isReady && !isSettings && (
        <Toggle
          checked={prefs.enabled}
          onChange={() => onToggleEnabled(tool.id)}
        />
      )}
    </div>
  );
};

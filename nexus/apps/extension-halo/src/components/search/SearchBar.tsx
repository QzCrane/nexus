import { isLaunchablePlugin } from '../../kernel';
// goal: Global search bar component
// eff: Fuzzy search with keyboard shortcuts. Logic extracted to search-utils.ts and styles to SearchBar.styles.ts

import type React from 'react';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useClipboardIntent } from '../../kernel/hooks/use-clipboard-intent';

import type { ToolMeta } from '../../kernel';
import { useTranslation } from '../../i18n';
import { matchTool } from './search-utils';
import { styles } from './SearchBar.styles';

interface SearchBarProps {
  onSelect: (toolId: string) => void;
  visibleTools: ToolMeta[];
  placeholder?: string;
}

export const SearchBar: React.FC<SearchBarProps> = ({ onSelect, visibleTools, placeholder }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<ToolMeta[]>([]);
  const intent = useClipboardIntent();

  const suggestedTool = useMemo(() => {
    if (!intent || query.trim()) return null;
    return visibleTools.find((t) => t.id === intent);
  }, [intent, query, visibleTools]);


  // Filter results
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const matched = visibleTools.filter((tool) => matchTool(tool, query, t));
    setResults(matched);
    setActiveIndex(0);
  }, [query, t, visibleTools]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      // Cmd/Ctrl + K to focus
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setQuery('');
      inputRef.current?.blur();
      return;
    }
    if (!results.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = results[activeIndex];
      if (selected && (isLaunchablePlugin(selected))) {
        onSelect(selected.id);
        setQuery('');
        inputRef.current?.blur();
      }
    }
  }, [results, activeIndex, onSelect]);

  const handleSelect = useCallback((tool: ToolMeta) => {
    if (isLaunchablePlugin(tool)) {
      onSelect(tool.id);
      setQuery('');
    }
  }, [onSelect]);

  const showDropdown = focused && query.trim().length > 0;

  return (
    <div style={styles.wrapper}>
      <div style={{
        ...styles.inputWrapper,
        ...(focused ? styles.inputWrapperFocus : {}),
      }}>
        <span style={styles.icon}>🔍</span>
        <input
          ref={inputRef}
          style={styles.input}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || (suggestedTool ? `${t('common.suggested')}: ${t(`tools.${suggestedTool.id}.name`)}` : t('common.search'))}
        />
        {!focused && !suggestedTool && <span style={styles.shortcut}>⌘K</span>}
        {suggestedTool && !focused && !query && (
          <button
            type="button"
            onClick={() => onSelect(suggestedTool.id)}
            style={{
              position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
              padding: '2px 8px', borderRadius: '4px', background: 'var(--halo-primary-alpha, rgba(16, 185, 129, 0.15))',
              color: 'var(--halo-primary, #10b981)', fontSize: '10px', fontWeight: 600, cursor: 'pointer',
              border: '1px solid var(--halo-primary-alpha)'
            }}
          >
            {suggestedTool.icon} {t('common.open')}
          </button>
        )}
      </div>

      {showDropdown && (
        <div style={styles.dropdown}>
          {results.length > 0 ? (
            results.map((tool, i) => (
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
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => handleSelect(tool)}
              >
                <span style={styles.itemIcon as React.CSSProperties}>{tool.icon}</span>
                <div style={styles.itemInfo}>
                  <div style={styles.itemName}>{t(`tools.${tool.id}.name`)}</div>
                  <div style={styles.itemDesc}>{t(`tools.${tool.id}.desc`)}</div>
                </div>
                {!isLaunchablePlugin(tool) && (
                  <span style={{
                    ...styles.itemStatus,
                    background: 'var(--halo-warning-alpha, rgba(245, 158, 11, 0.2))',
                    color: 'var(--halo-warning, #f59e0b)',
                  }}>
                    {t('common.comingSoon')}
                  </span>
                )}
              </button>
            ))
          ) : (
            <div style={styles.noResults}>{t('common.noResults')}</div>
          )}
        </div>
      )}
    </div>
  );
};

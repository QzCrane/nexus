// goal: QR Code tool panel UI

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Card } from '@nexus/ui-kit';
import { createLogger } from '@nexus/kernel';
import {
  generateQRCode,
  saveToHistory,
  loadHistory,
  downloadQRCode,
  copyQRCodeToClipboard,
} from './core';

const logger = createLogger('QRCode', 'HALO');

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  textarea: {
    width: '100%',
    minHeight: '60px',
    padding: '10px',
    border: '1px solid #444',
    borderRadius: '6px',
    background: '#2a2a2a',
    color: '#fff',
    fontSize: '13px',
    resize: 'vertical',
    fontFamily: 'inherit',
  },
  generateBtn: {
    padding: '10px 16px',
    background: 'linear-gradient(135deg, #4a9eff, #7c3aed)',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'transform 0.1s, box-shadow 0.2s',
  },
  qrContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    padding: '16px',
    background: '#1e1e1e',
    borderRadius: '8px',
  },
  qrImage: {
    padding: '12px',
    background: '#333',
    borderRadius: '8px',
  },
  actionRow: {
    display: 'flex',
    gap: '8px',
  },
  actionBtn: {
    flex: 1,
    padding: '8px 12px',
    background: '#333',
    border: '1px solid #444',
    borderRadius: '6px',
    color: '#ddd',
    fontSize: '12px',
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  historySection: {
    marginTop: '8px',
  },
  historyTitle: {
    fontSize: '11px',
    color: '#888',
    marginBottom: '6px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    maxHeight: '120px',
    overflowY: 'auto',
  },
  historyItem: {
    padding: '6px 10px',
    background: '#252525',
    borderRadius: '4px',
    fontSize: '11px',
    color: '#aaa',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    transition: 'background 0.1s',
  },
  toast: {
    position: 'fixed',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '8px 16px',
    background: '#22c55e',
    borderRadius: '6px',
    fontSize: '12px',
    color: '#fff',
    zIndex: 1000,
  },
};

export const QRCodePanel: React.FC = () => {
  const [text, setText] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadHistory().then(setHistory);
    // Focus textarea on mount
    textareaRef.current?.focus();
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!text.trim()) return;
    setLoading(true);
    try {
      const dataUrl = await generateQRCode(text.trim());
      setQrDataUrl(dataUrl);
      const updated = await saveToHistory(text.trim());
      setHistory(updated);
      logger.info('QR generated for:', text.substring(0, 50));
    } catch (e) {
      logger.error('Generate failed:', e);
      showToast('Generation failed');
    } finally {
      setLoading(false);
    }
  }, [text, showToast]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        handleGenerate();
      }
    },
    [handleGenerate]
  );

  const handleCopy = useCallback(async () => {
    if (!qrDataUrl) return;
    const ok = await copyQRCodeToClipboard(qrDataUrl);
    showToast(ok ? 'Copied!' : 'Copy failed');
  }, [qrDataUrl, showToast]);

  const handleDownload = useCallback(() => {
    if (!qrDataUrl) return;
    const filename = `qr-${Date.now()}`;
    downloadQRCode(qrDataUrl, filename);
    showToast('Downloaded!');
  }, [qrDataUrl, showToast]);

  const handleHistoryClick = useCallback((item: string) => {
    setText(item);
    textareaRef.current?.focus();
  }, []);

  return (
    <div style={styles.wrapper}>
      <Card variant="default" padding="md">
        <div style={styles.inputGroup}>
          <textarea
            ref={textareaRef}
            style={styles.textarea}
            placeholder="Enter text or URL... (Ctrl+Enter to generate)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            style={{
              ...styles.generateBtn,
              opacity: loading || !text.trim() ? 0.6 : 1,
            }}
            onClick={handleGenerate}
            disabled={loading || !text.trim()}
          >
            {loading ? 'Generating...' : '🔲 Generate QR Code'}
          </button>
        </div>
      </Card>

      {qrDataUrl && (
        <div style={styles.qrContainer}>
          <img
            src={qrDataUrl}
            alt="QR Code"
            style={styles.qrImage}
            width={180}
            height={180}
          />
          <div style={styles.actionRow}>
            <button style={styles.actionBtn} onClick={handleCopy}>
              📋 Copy
            </button>
            <button style={styles.actionBtn} onClick={handleDownload}>
              💾 Save
            </button>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div style={styles.historySection}>
          <div style={styles.historyTitle}>
            <span>Recent</span>
            <span style={{ color: '#666' }}>{history.length}</span>
          </div>
          <div style={styles.historyList}>
            {history.map((item, i) => (
              <div
                key={i}
                style={styles.historyItem}
                onClick={() => handleHistoryClick(item)}
                title={item}
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      )}

      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
};

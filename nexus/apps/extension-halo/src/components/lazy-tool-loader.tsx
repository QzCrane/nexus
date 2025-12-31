// goal: Lazy tool loader with preload and loading states
// eff: Dynamic import + hover preload + skeleton fallback

import React, { Suspense, lazy, useState, useCallback, useEffect, useRef } from 'react';
import { Card } from '@nexus/ui-kit';
import type { ToolId } from '../kernel/types';

// Lazy panel imports (code splitting)
const toolPanels = {
	'qrcode': lazy(() => import('../tools/qrcode/panel').then((m) => ({ default: m.QRCodePanel }))),
	'screenshot': lazy(() => import('../tools/screenshot/panel').then((m) => ({ default: m.ScreenshotPanel }))),
	'base64': lazy(() => import('../tools/base64/panel').then((m) => ({ default: m.Base64Panel }))),
	'json-formatter': lazy(() => import('../tools/json-formatter/panel').then((m) => ({ default: m.JSONFormatterPanel }))),
	'color-picker': lazy(() => import('../tools/color-picker/panel').then((m) => ({ default: m.ColorPickerPanel }))),
	'hash': lazy(() => import('../tools/hash/panel').then((m) => ({ default: m.HashPanel }))),
	'regex': lazy(() => import('../tools/regex/panel').then((m) => ({ default: m.RegexPanel }))),
	'ruler': lazy(() => import('../tools/ruler/panel').then((m) => ({ default: m.RulerPanel }))),
	'outline': lazy(() => import('../tools/outline/panel').then((m) => ({ default: m.OutlinePanel }))),
	'clipboard': lazy(() => import('../tools/clipboard/panel').then((m) => ({ default: m.ClipboardPanel }))),
	'smooth-scroll': lazy(() => import('../tools/smooth-scroll/panel').then((m) => ({ default: m.SmoothScrollPanel }))),
	'tabs': lazy(() => import('../tools/tabs/panel').then((m) => ({ default: m.TabsPanel }))),
	'settings': lazy(() => import('../tools/settings/panel').then((m) => ({ default: m.SettingsPanel }))),
	'pdf': lazy(() => import('../tools/pdf/panel').then((m) => ({ default: m.PDFPanel }))),
	'module-store': lazy(() => import('../tools/module-store/panel').then((m) => ({ default: m.ModuleStorePanel }))),
	'crypto': lazy(() => import('../tools/crypto/panel').then((m) => ({ default: m.CryptoPanel }))),
	'mock-data': lazy(() => import('../tools/mock-data/panel').then((m) => ({ default: m.MockDataPanel }))),
	'network': lazy(() => import('../tools/network/panel').then((m) => ({ default: m.NetworkPanel }))),
	'archive': lazy(() => import('../tools/archive/panel').then((m) => ({ default: m.ArchivePanel }))),
	'userscripts': lazy(() => import('../tools/userscripts/panel').then((m) => ({ default: m.UserScriptsPanel }))),
	'permissions': lazy(() => import('../tools/permissions/panel').then((m) => ({ default: m.PermissionsPanel }))),
	'text-tools': lazy(() => import('../tools/text-tools/panel').then((m) => ({ default: m.TextToolsPanel }))),
	'lorem-ipsum': lazy(() => import('../tools/lorem-ipsum/panel').then((m) => ({ default: m.LoremIpsumPanel }))),
	'diff': lazy(() => import('../tools/diff/panel').then((m) => ({ default: m.DiffPanel }))),
	'yaml': lazy(() => import('../tools/yaml/panel').then((m) => ({ default: m.YamlPanel }))),
	'number-base': lazy(() => import('../tools/number-base/panel').then((m) => ({ default: m.NumberBasePanel }))),
	'markdown': lazy(() => import('../tools/markdown/panel').then((m) => ({ default: m.MarkdownPanel }))),
	'unit-converter': lazy(() => import('../tools/unit-converter/panel').then((m) => ({ default: m.UnitConverterPanel }))),
	'cron': lazy(() => import('../tools/cron/panel').then((m) => ({ default: m.CronPanel }))),
	'html-entity': lazy(() => import('../tools/html-entity/panel').then((m) => ({ default: m.HtmlEntityPanel }))),
	'code-formatter': lazy(() => import('../tools/code-formatter/panel').then((m) => ({ default: m.CodeFormatterPanel }))),
	'password-gen': lazy(() => import('../tools/password-gen/panel').then((m) => ({ default: m.PasswordGenPanel }))),
	'image-tools': lazy(() => import('../tools/image-tools/panel').then((m) => ({ default: m.ImageToolsPanel }))),
	'cookie-manager': lazy(() => import('../tools/cookie-manager/panel').then((m) => ({ default: m.CookieManagerPanel }))),
	'reader-mode': lazy(() => import('../tools/reader-mode/panel').then((m) => ({ default: m.ReaderModePanel }))),
	'totp': lazy(() => import('../tools/totp/panel').then((m) => ({ default: m.TotpPanel }))),
	'bookmark-manager': lazy(() => import('../tools/bookmark-manager/panel').then((m) => ({ default: m.BookmarkManagerPanel }))),
	'tech-stack': lazy(() => import('../tools/tech-stack/panel').then((m) => ({ default: m.TechStackPanel }))),
	'sticky-notes': lazy(() => import('../tools/sticky-notes/panel').then((m) => ({ default: m.StickyNotesPanel }))),
	'pomodoro': lazy(() => import('../tools/pomodoro/panel').then((m) => ({ default: m.PomodoroPanel }))),
	'timer': lazy(() => import('../tools/timer/panel').then((m) => ({ default: m.TimerPanel }))),
	'http-status': lazy(() => import('../tools/http-status/panel').then((m) => ({ default: m.HttpStatusPanel }))),
	'csv-viewer': lazy(() => import('../tools/csv-viewer/panel').then((m) => ({ default: m.CsvViewerPanel }))),
	'shortcuts': lazy(() => import('../tools/shortcuts/panel').then((m) => ({ default: m.ShortcutsPanel }))),
	'ip-lookup': lazy(() => import('../tools/ip-lookup/panel').then((m) => ({ default: m.IpLookupPanel }))),
	'font-inspector': lazy(() => import('../tools/font-inspector/panel').then((m) => ({ default: m.FontInspectorPanel }))),
	'xml-formatter': lazy(() => import('../tools/xml-formatter/panel').then((m) => ({ default: m.XmlFormatterPanel }))),
	'history-search': lazy(() => import('../tools/history-search/panel').then((m) => ({ default: m.HistorySearchPanel }))),
	'headers-viewer': lazy(() => import('../tools/headers-viewer/panel').then((m) => ({ default: m.HeadersViewerPanel }))),
	'exif-reader': lazy(() => import('../tools/exif-reader/panel').then((m) => ({ default: m.ExifReaderPanel }))),
	'table-extractor': lazy(() => import('../tools/table-extractor/panel').then((m) => ({ default: m.TableExtractorPanel }))),
	'todo-list': lazy(() => import('../tools/todo-list/panel').then((m) => ({ default: m.TodoListPanel }))),
	'storage-editor': lazy(() => import('../tools/storage-editor/panel').then((m) => ({ default: m.StorageEditorPanel }))),
	'text-to-speech': lazy(() => import('../tools/text-to-speech/panel').then((m) => ({ default: m.TextToSpeechPanel }))),
	'user-agent': lazy(() => import('../tools/user-agent/panel').then((m) => ({ default: m.UserAgentPanel }))),
	'color-palette': lazy(() => import('../tools/color-palette/panel').then((m) => ({ default: m.ColorPalettePanel }))),
	'gzip': lazy(() => import('../tools/gzip/panel').then((m) => ({ default: m.GzipPanel }))),
	'jwt-decoder': lazy(() => import('../tools/jwt-decoder/panel').then((m) => ({ default: m.JwtDecoderPanel }))),
	'morse': lazy(() => import('../tools/morse/panel').then((m) => ({ default: m.MorsePanel }))),
	'emoji-picker': lazy(() => import('../tools/emoji-picker/panel').then((m) => ({ default: m.EmojiPickerPanel }))),
} as const;

type LoadableTool = keyof typeof toolPanels;
const PRELOAD_DELAY = 150; // ms before preload on hover

// Preload cache to avoid duplicate preloads
const preloadedTools = new Set<string>();

// Skeleton loading component
const LoadingSkeleton: React.FC = () => (
	<Card variant="default" padding="md">
		<div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center', padding: '24px' }}>
			<div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--halo-bg-tertiary)', animation: 'pulse 1.5s infinite' }} />
			<div style={{ width: '120px', height: '12px', borderRadius: '6px', background: 'var(--halo-bg-tertiary)', animation: 'pulse 1.5s infinite' }} />
			<div style={{ width: '180px', height: '10px', borderRadius: '5px', background: 'var(--halo-bg-tertiary)', animation: 'pulse 1.5s infinite', opacity: 0.6 }} />
		</div>
		<style>{`
			@keyframes pulse {
				0%, 100% { opacity: 1; }
				50% { opacity: 0.5; }
			}
		`}</style>
	</Card>
);

interface LazyToolRendererProps {
	toolId: ToolId | null;
	fallback?: React.ReactNode;
}

export const LazyToolRenderer: React.FC<LazyToolRendererProps> = ({ toolId, fallback }) => {
	if (!toolId || !(toolId in toolPanels)) {
		return fallback ? <>{fallback}</> : null;
	}

	const Panel = toolPanels[toolId as LoadableTool];
	return (
		<Suspense fallback={<LoadingSkeleton />}>
			<Panel />
		</Suspense>
	);
};

// Preload hook for hover behavior
export const useToolPreload = () => {
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const preload = useCallback((toolId: ToolId) => {
		if (preloadedTools.has(toolId) || !(toolId in toolPanels)) return;

		timerRef.current = setTimeout(async () => {
			// Trigger lazy load by re-importing the module
			try {
				switch (toolId) {
					case 'pdf': await import('../tools/pdf/panel'); break;
					case 'qrcode': await import('../tools/qrcode/panel'); break;
					case 'screenshot': await import('../tools/screenshot/panel'); break;
					case 'base64': await import('../tools/base64/panel'); break;
					case 'json-formatter': await import('../tools/json-formatter/panel'); break;
					case 'color-picker': await import('../tools/color-picker/panel'); break;
					case 'hash': await import('../tools/hash/panel'); break;
					case 'regex': await import('../tools/regex/panel'); break;
					case 'settings': await import('../tools/settings/panel'); break;
					case 'crypto': await import('../tools/crypto/panel'); break;
				}
				preloadedTools.add(toolId);
			} catch { /* ignore preload failures */ }
		}, PRELOAD_DELAY);
	}, []);

	const cancelPreload = useCallback(() => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
	}, []);

	useEffect(() => () => cancelPreload(), [cancelPreload]);

	return { preload, cancelPreload };
};

// Get available tool IDs
export const getLoadableToolIds = (): ToolId[] => Object.keys(toolPanels) as ToolId[];

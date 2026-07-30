// goal: Media Sniffer panel UI - scan and download page media resources

import type React from 'react';
import { useState, useCallback, useEffect } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import {
	DEFAULT_FILTER_CONFIG,
	isScanResult,
	normalizeFilterConfig,
	normalizeScanResult,
	type MediaItem,
	type MediaType,
	type ScanResult,
	type FilterConfig,
} from './types';
import { filterMedia, downloadMedia, getFilename, formatSize } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


const TYPES: MediaType[] = ['video', 'audio', 'image'];
const TYPE_ICONS: Record<MediaType, string> = { video: '🎬', audio: '🎵', image: '🖼️' };

import { useOverlay } from '../../components/ui/overlay';

export const MediaSnifferPanel: React.FC = () => {
	const { t } = useTranslation();
	const { showToast } = useOverlay();
	const [result, setResult] = useToolState<ScanResult | null>(
		'media-sniffer-result',
		null,
		{ normalize: normalizeScanResult },
	);
	const [filter, setFilter] = useToolState<FilterConfig>(
		'media-sniffer-filter',
		DEFAULT_FILTER_CONFIG,
		{ normalize: normalizeFilterConfig },
	);
	const [scanning, setScanning] = useState(false);


	// Execute scan via content script
	const handleScan = useCallback(async () => {
		setScanning(true);
		try {
			const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
			if (!tab?.id) return;
			
			// Prevent scanning restricted pages
			if (tab.url && (tab.url.startsWith('chrome:') || tab.url.startsWith('edge:') || tab.url.startsWith('about:') || tab.url.startsWith('devtools:') || tab.url.startsWith('view-source:'))) {
				showToast({ message: t('mediaSniffer.errorRestricted'), type: 'error' });
				return;
			}

			const results = await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				func: scanMediaInPage,
			});
			
			if (results?.[0]?.result) {
				const parsed: unknown = JSON.parse(results[0].result);
				if (!isScanResult(parsed)) throw new Error('Invalid media scan response');
				setResult(parsed);
			}
		} catch (err: unknown) {
			console.error('[MediaSniffer] scan failed:', err);
			showToast({ message: err instanceof Error ? err.message : 'Scan failed', type: 'error' });
		} finally {
			setScanning(false);
		}
	}, [t, showToast, setResult]);

	// Auto-scan on mount
	useEffect(() => { handleScan(); }, [handleScan]);

	// Toggle type filter
	const toggleType = (type: MediaType) => {
		setFilter((prev) => {
			const selected = prev.types.includes(type);
			return {
				...prev,
				types: selected
					? prev.types.filter((candidate) => candidate !== type)
					: [...prev.types, type],
			};
		});
	};

	// Handle download
	const handleDownload = (item: MediaItem) => {
		downloadMedia(item.url, getFilename(item.url));
	};

	// Get filtered items
	const items = result ? filterMedia(result.items, filter) : [];
	const stats = { video: 0, audio: 0, image: 0 };
	items.forEach((item) => {
		stats[item.type] += 1;
	});

	return (
		<div style={styles.wrapper}>
			{/* Header */}
			<div style={styles.header}>
				<button type="button" style={styles.btn} onClick={handleScan} disabled={scanning}>
					{scanning ? '⏳' : '🔍'} {t('mediaSniffer.scan')}
				</button>
				<span style={styles.stats}>
					{items.length} {t('mediaSniffer.found')}
				</span>
			</div>

			{/* Type Filters */}
			<div style={styles.filterRow}>
				{TYPES.map((type) => (
					<button
						type="button"
						key={type}
						aria-pressed={filter.types.includes(type)}
						style={{ ...styles.chip, ...(filter.types.includes(type) ? styles.chipActive : {}) }}
						onClick={() => toggleType(type)}
					>
						{TYPE_ICONS[type]} {t(`mediaSniffer.type.${type}`)} ({stats[type]})
					</button>
				))}
			</div>

			{/* Media List */}
			{items.length === 0 ? (
				<Card variant="default" padding="lg">
					<div style={styles.empty}>
						{scanning ? t('mediaSniffer.scanning') : t('mediaSniffer.empty')}
					</div>
				</Card>
			) : (
				<div style={styles.list}>
					{items.map((item) => (
						<MediaItemRow key={item.id} item={item} onDownload={handleDownload} />
					))}
				</div>
			)}
		</div>
	);
};

// Subcomponent: Media item row
const MediaItemRow: React.FC<{ item: MediaItem; onDownload: (item: MediaItem) => void }> = ({ item, onDownload }) => {
	const badgeStyle = {
		...styles.badge,
		...(item.type === 'video' ? styles.badgeVideo : item.type === 'audio' ? styles.badgeAudio : styles.badgeImage),
	};

	return (
		<div style={styles.item}>
			<div style={styles.preview}>
				{item.type === 'image' ? (
					<img src={item.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '6px' }} />
				) : (
					TYPE_ICONS[item.type]
				)}
			</div>
			<div style={styles.info}>
				<div style={styles.filename} title={item.url}>{getFilename(item.url)}</div>
				<div style={styles.meta}>
					<span style={badgeStyle}>{item.ext}</span>
					{item.width && item.height && <span>{item.width}×{item.height}</span>}
					{item.size > 0 && <span>{formatSize(item.size)}</span>}
				</div>
			</div>
			<button type="button" style={styles.btnSecondary} onClick={() => onDownload(item)}>
				💾
			</button>
		</div>
	);
};

// Script injected into page (serialized)
function scanMediaInPage(): string {
	const items: MediaItem[] = [];
	const addItem = (
		url: string,
		source: MediaItem['source'],
		meta: Partial<Pick<MediaItem, 'width' | 'height' | 'duration'>> = {}
	) => {
		if (!url || url.startsWith('data:')) return;
		const ext = url.split('.').pop()?.split('?')[0]?.toLowerCase() || '';
		const typeMap: Partial<Record<string, MediaType>> = {
			mp4: 'video', webm: 'video', ogg: 'video', m3u8: 'video',
			mp3: 'audio', wav: 'audio', flac: 'audio',
			jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', svg: 'image', avif: 'image',
		};
		const type = typeMap[ext];
		if (!type) return;
		items.push({ id: Math.random().toString(36).slice(2), url, type, ext, source, size: 0, sizeText: '?', ...meta });
	};
	
	document.querySelectorAll('video').forEach((video) => {
		if (video.src) addItem(video.src, 'video', { width: video.videoWidth, height: video.videoHeight });
	});
	document.querySelectorAll('audio').forEach((audio) => {
		if (audio.src) addItem(audio.src, 'audio');
	});
	document.querySelectorAll('source').forEach((source) => {
		if (source.src) addItem(source.src, 'source');
	});
	document.querySelectorAll('img').forEach((image) => {
		const source = image.currentSrc || image.src;
		if (source) addItem(source, 'img', { width: image.naturalWidth, height: image.naturalHeight });
	});
	
	return JSON.stringify({ items, timestamp: Date.now(), url: location.href });
}

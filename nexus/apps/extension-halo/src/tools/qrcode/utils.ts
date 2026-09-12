// goal: QR Code utilities (History, Clipboard, Download)

import { STORAGE_KEY, MAX_HISTORY } from './types';
import { conditionalLedgerWrite, readLedgerEntry } from '../../kernel/core/safe-storage';

function parseHistory(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}
import { downloadBlob } from '../../kernel/utils/object-url-lease';

export async function saveToHistory(text: string): Promise<string[]> {
	const base = await readLedgerEntry(STORAGE_KEY, { area: 'local' });
	const history = parseHistory(base.value);
	const updated = [text, ...history.filter(h => h !== text)].slice(0, MAX_HISTORY);
	const outcome = await conditionalLedgerWrite(STORAGE_KEY, {
		area: 'local', baseRevision: base.revision, value: updated,
		remerge: (current) => [text, ...parseHistory(current).filter((entry) => entry !== text)].slice(0, MAX_HISTORY),
	});
	if (outcome.kind !== 'committed') throw new Error('QR history update was not committed');
	return parseHistory(outcome.value);
}

export async function loadHistory(): Promise<string[]> {
	return parseHistory((await readLedgerEntry(STORAGE_KEY, { area: 'local' })).value);
}

export async function clearHistory(): Promise<void> {
	const base = await readLedgerEntry(STORAGE_KEY, { area: 'local' });
	const outcome = await conditionalLedgerWrite(STORAGE_KEY, { area: 'local', baseRevision: base.revision, value: [], remerge: () => [] });
	if (outcome.kind !== 'committed') throw new Error('QR history clear was not committed');
}

export function downloadQRCode(blob: Blob, filename: string): void {
	downloadBlob(blob, filename);
}

export async function copyImageToClipboard(dataUrl: string): Promise<boolean> {
	try {
		const response = await fetch(dataUrl);
		const blob = await response.blob();
		await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
		return true;
	} catch { return false; }
}

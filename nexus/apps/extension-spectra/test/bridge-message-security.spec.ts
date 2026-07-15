import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseYouTubeBridgeEvent } from '../src/content/logic/site-bridge/youtube-bridge';

const trustedWindow = {} as Window;
const foreignWindow = {} as Window;

function event(data: unknown, source: Window | null = trustedWindow): Pick<MessageEvent, 'source' | 'data'> {
	return { data, source };
}

function typescriptFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return typescriptFiles(path);
		return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
	});
}

describe('MAIN-to-content message boundaries', () => {
	test('accepts only exact, bounded YouTube adapter messages from the current window', () => {
		expect(parseYouTubeBridgeEvent(event({
			type: 'SPECTRA_YT_SYNC_BACK',
			volume: 42,
			muted: false,
		}), trustedWindow)).toEqual({ type: 'SPECTRA_YT_SYNC_BACK', volume: 42, muted: false });
		expect(parseYouTubeBridgeEvent(event({
			type: 'SPECTRA_YT_SYNC_BACK',
			speed: 1.25,
		}), trustedWindow)).toEqual({ type: 'SPECTRA_YT_SYNC_BACK', speed: 1.25 });
		expect(parseYouTubeBridgeEvent(event({
			type: 'SPECTRA_YT_FAIL',
			feature: 'volume',
			error: 'player unavailable',
		}), trustedWindow)).toEqual({
			type: 'SPECTRA_YT_FAIL',
			feature: 'volume',
			error: 'player unavailable',
		});

		expect(parseYouTubeBridgeEvent(event({
			type: 'SPECTRA_YT_SYNC_BACK',
			volume: 42,
			muted: false,
		}, foreignWindow), trustedWindow)).toBeNull();
		expect(parseYouTubeBridgeEvent(event({
			type: 'SPECTRA_YT_SYNC_BACK',
			volume: 42,
			muted: false,
			forged: true,
		}), trustedWindow)).toBeNull();
	});

	test('rejects malformed and out-of-range YouTube state', () => {
		const rejected = [
			null,
			[],
			{ type: 'SPECTRA_YT_SYNC_BACK', volume: -1, muted: false },
			{ type: 'SPECTRA_YT_SYNC_BACK', volume: 101, muted: false },
			{ type: 'SPECTRA_YT_SYNC_BACK', volume: Number.NaN, muted: false },
			{ type: 'SPECTRA_YT_SYNC_BACK', volume: 50, muted: 0 },
			{ type: 'SPECTRA_YT_SYNC_BACK', speed: 0.09 },
			{ type: 'SPECTRA_YT_SYNC_BACK', speed: 16.01 },
			{ type: 'SPECTRA_YT_SPEED_OK', speed: Number.POSITIVE_INFINITY },
			{ type: 'SPECTRA_YT_VOLUME_OK', volume: 50, muted: 'false' },
			{ type: 'SPECTRA_YT_FAIL', feature: 'all', error: 'nope' },
			{ type: 'SPECTRA_YT_FAIL', feature: 'speed', error: 'x'.repeat(501) },
		];
		for (const data of rejected) {
			expect(parseYouTubeBridgeEvent(event(data), trustedWindow)).toBeNull();
		}
	});

	test('does not emit or consume page-authored playback-rate configuration messages', () => {
		const sourceRoot = resolve(import.meta.dir, '../src');
		const consumers = typescriptFiles(sourceRoot).filter((file) =>
			readFileSync(file, 'utf8').includes('SPECTRA_RATE')
		);
		expect(consumers).toEqual([]);
	});
});

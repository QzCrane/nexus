import { describe, expect, test } from 'bun:test';
import { archiveLastCodec } from '../src/tools/archive/core';
import { colorPaletteCodec } from '../src/tools/color-palette/core';
import { imageToolsConfigCodec } from '../src/tools/image-tools/core';
import { DEFAULT_CONFIG as DEFAULT_PDF_CONFIG } from '../src/tools/pdf/config-panel';
import { pdfConfigCodec, pdfOperationCodec } from '../src/tools/pdf/state-codecs';
import { regexFlagsCodec } from '../src/tools/regex/core';
import { DEFAULT_FLAGS } from '../src/tools/regex/types';
import type { ToolStateCodec } from '../src/kernel/core/storage-codec';
import { fontInfoCodec } from '../src/tools/font-inspector/core';
import { hexChunksCodec } from '../src/tools/hex-dump/core';
import { ipInfoCodec } from '../src/tools/ip-lookup/core';
import { outlineSettingsCodec } from '../src/tools/outline/core';
import { qrcodeOptionsCodec } from '../src/tools/qrcode/core';
import { DEFAULT_OPTIONS as DEFAULT_QR_OPTIONS } from '../src/tools/qrcode/types';
import { articleContentCodec, DEFAULT_CONFIG as DEFAULT_READER_CONFIG, readerConfigCodec } from '../src/tools/reader-mode/core';
import { techDetectionCodec } from '../src/tools/tech-stack/core';

function expectLegacyRoundTrip<T>(codec: ToolStateCodec<T>, legacy: unknown): void {
	const adopted = codec.decode(legacy);
	expect(adopted.kind).toBe('valid');
	if (adopted.kind === 'valid') expect(codec.decode(codec.encode(adopted.value))).toEqual(adopted);
}

describe('heavy-tool domain codecs', () => {
	test('adopts valid legacy values and round-trips the versioned form', () => {
		const archive = { id: 'a', title: 'Title', url: 'https://example.test', savedAt: 1, size: 2 };
		const palette = [{ hex: '#112233', rgb: 'rgb(17, 34, 51)', count: 4, percentage: 100 }];
		expectLegacyRoundTrip(archiveLastCodec, archive);
		expectLegacyRoundTrip(colorPaletteCodec, palette);
		expectLegacyRoundTrip(imageToolsConfigCodec, { quality: 0.8, maxWidth: 0, maxHeight: 0, format: 'jpeg' });
		expectLegacyRoundTrip(pdfOperationCodec, 'merge');
		expectLegacyRoundTrip(pdfConfigCodec, DEFAULT_PDF_CONFIG);
		expectLegacyRoundTrip(regexFlagsCodec, DEFAULT_FLAGS);
	});

	test('rejects malformed and unsupported persisted values', () => {
		expect(archiveLastCodec.decode({ id: '', title: 1 })).toMatchObject({ kind: 'invalid' });
		expect(colorPaletteCodec.decode([{ hex: 'red', rgb: '', count: -1, percentage: 101 }])).toMatchObject({ kind: 'invalid' });
		expect(imageToolsConfigCodec.decode({ quality: 2, maxWidth: -1, maxHeight: 0, format: 'gif' })).toMatchObject({ kind: 'invalid' });
		expect(pdfOperationCodec.decode('pdf-to-images')).toMatchObject({ kind: 'invalid' });
		expect(pdfConfigCodec.decode({ ...DEFAULT_PDF_CONFIG, rotateDegrees: 45 })).toMatchObject({ kind: 'invalid' });
		expect(regexFlagsCodec.decode({ ...DEFAULT_FLAGS, global: 'yes' })).toMatchObject({ kind: 'invalid' });
	});

	test('validates structured scan, document, and settings state', () => {
		expectLegacyRoundTrip(fontInfoCodec, [{ family: 'Inter', weight: '400', size: '16px', lineHeight: '24px', color: 'rgb(0, 0, 0)', element: 'p' }]);
		expectLegacyRoundTrip(hexChunksCodec, [{ offset: '00000000', hex: '41', ascii: 'A' }]);
		expectLegacyRoundTrip(ipInfoCodec, { ip: '203.0.113.1', country: 'ZZ' });
		expectLegacyRoundTrip(outlineSettingsCodec, { minLevel: 1, maxLevel: 6, showNumbers: true });
		expectLegacyRoundTrip(qrcodeOptionsCodec, DEFAULT_QR_OPTIONS);
		expectLegacyRoundTrip(readerConfigCodec, DEFAULT_READER_CONFIG);
		expectLegacyRoundTrip(articleContentCodec, { title: 'Title', content: '<p>Body</p>', textContent: 'Body', siteName: 'Site', byline: '' });
		expectLegacyRoundTrip(techDetectionCodec, [{ name: 'React', category: 'framework', confidence: 1, icon: 'R' }]);
		expect(fontInfoCodec.decode([{ family: 1 }])).toMatchObject({ kind: 'invalid' });
		expect(hexChunksCodec.decode([{ offset: '../', hex: '', ascii: '' }])).toMatchObject({ kind: 'invalid' });
		expect(ipInfoCodec.decode({ ip: 123 })).toMatchObject({ kind: 'invalid' });
		expect(outlineSettingsCodec.decode({ minLevel: 6, maxLevel: 1, showNumbers: true })).toMatchObject({ kind: 'invalid' });
		expect(qrcodeOptionsCodec.decode({ ...DEFAULT_QR_OPTIONS, size: 10_000 })).toMatchObject({ kind: 'invalid' });
		expect(readerConfigCodec.decode({ ...DEFAULT_READER_CONFIG, theme: 'unknown' })).toMatchObject({ kind: 'invalid' });
		expect(articleContentCodec.decode({ title: 'missing fields' })).toMatchObject({ kind: 'invalid' });
		expect(techDetectionCodec.decode([{ name: 'X', category: 'unknown', confidence: 1 }])).toMatchObject({ kind: 'invalid' });
	});
});

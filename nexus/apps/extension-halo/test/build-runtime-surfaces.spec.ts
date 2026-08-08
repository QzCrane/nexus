import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	classifyContentStartupSurfaces,
	measureContentStartupSurfaces,
	type StaticClosure,
} from '../build-runtime-surfaces';

function readManifest(): unknown {
	return JSON.parse(readFileSync(resolve(import.meta.dir, '../public/manifest.json'), 'utf8'));
}

describe('HALO manifest-derived startup surfaces', () => {
	test('classifies the current physical content-script frame and phase ownership', () => {
		expect(classifyContentStartupSurfaces(readManifest())).toEqual({
		allFrameDocumentStart: ['content-frame-tools.js'],
		topFrameDocumentStart: [
			'content-frame-tools.js',
			'content-smooth-scroll.js',
			'content.js',
		],
		allFrameDocumentIdle: ['content-clipboard.js'],
		topFrameDocumentIdle: [
			'content-clipboard.js',
			'content-hover-zoom.js',
		],
	});
	});

	test('uses Chrome manifest defaults but rejects an unaccounted lifecycle phase', () => {
		expect(classifyContentStartupSurfaces({
			content_scripts: [{ js: ['idle.js'] }],
		})).toEqual({
			allFrameDocumentStart: [],
			topFrameDocumentStart: [],
			allFrameDocumentIdle: [],
			topFrameDocumentIdle: ['idle.js'],
		});

		expect(() => classifyContentStartupSurfaces({
			content_scripts: [{ js: ['end.js'], run_at: 'document_end' }],
		})).toThrow('unsupported run_at');
	});

	test('charges static closure bytes once and fails closed when a manifest output is missing', () => {
		const closures = new Map<string, StaticClosure>([
			['all.js', { outputBytes: new Map([['all.js', 8], ['shared.js', 3]]) }],
			['top.js', { outputBytes: new Map([['top.js', 5], ['shared.js', 3]]) }],
		]);
		const manifest = {
			content_scripts: [
				{ js: ['all.js'], run_at: 'document_start', all_frames: true },
				{ js: ['top.js'], run_at: 'document_start', all_frames: false },
			],
		};

		expect(measureContentStartupSurfaces(manifest, (output) => {
			const closure = closures.get(output);
			if (!closure) throw new Error(`missing output ${output}`);
			return closure;
		})).toEqual({
			allFrameDocumentStart: 11,
			topFrameDocumentStart: 16,
			allFrameDocumentIdle: 0,
			topFrameDocumentIdle: 0,
		});

		expect(() => measureContentStartupSurfaces(manifest, (output) => {
			if (output === 'all.js') return closures.get(output)!;
			throw new Error(`missing output ${output}`);
		})).toThrow('missing output top.js');
	});
});

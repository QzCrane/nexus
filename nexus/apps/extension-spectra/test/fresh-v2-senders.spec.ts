import { describe, expect, test } from 'bun:test';
import { NEXUS_ACTIONS } from '@nexus/contracts';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SOURCE_ROOT = join(import.meta.dir, '..', 'src');
const SMOKE_PATH = join(import.meta.dir, 'smoke.spec.ts');

function listTypeScriptFiles(root: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) files.push(...listTypeScriptFiles(path));
		else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path);
	}
	return files;
}

function portablePath(path: string): string {
	return relative(SOURCE_ROOT, path).replaceAll('\\', '/');
}

describe('SPECTRA runtime uses only the validated protocol', () => {
	test('production code does not load or register the retired kernel message router', () => {
		for (const path of listTypeScriptFiles(SOURCE_ROOT)) {
			const source = readFileSync(path, 'utf8');
			expect(source, portablePath(path)).not.toMatch(/\bcreateMessenger\b/u);
			expect(source, portablePath(path)).not.toMatch(/\bsendToTab\b/u);
			expect(source, portablePath(path)).not.toMatch(/\bmessenger\.send(?:ToTab)?\s*\(/u);
			expect(source, portablePath(path)).not.toMatch(/\bcreateRouter\b/u);
			expect(source, portablePath(path)).not.toMatch(/\brouter\.(?:on|listen)\s*\(/u);
		}
	});

	test('shared Nexus actions no longer publish a second SPECTRA protocol', () => {
		expect(NEXUS_ACTIONS).toEqual([
			'HALO_GET_STATUS',
			'HALO_TOOL_ACTIVATE',
			'HALO_TOOL_DEACTIVATE',
			'HALO_RULER_START',
			'HALO_RULER_CANCEL',
			'HALO_RULER_RESULT',
			'HALO_SCROLL_TO_HEADING',
			'HALO_CLIPBOARD_ADD',
		]);
	});

	test('production code contains no naked action-envelope sender', () => {
		const v1SendPattern = /(?:chrome\.)?(?:runtime|tabs)\.sendMessage\([^;]{0,800}?\baction\s*:/gu;
		for (const path of listTypeScriptFiles(SOURCE_ROOT)) {
			const source = readFileSync(path, 'utf8');
			expect(source, portablePath(path)).not.toMatch(v1SendPattern);
		}
	});

	test('Chrome smoke drives current v2 requests, not legacy actions', () => {
		const source = readFileSync(SMOKE_PATH, 'utf8');
		expect(source).not.toMatch(/\b(?:AUDIO_GET_STATUS|AUDIO_SET_CONFIG|CAPTURE_TOGGLE|TAB_GET_VISIBLE_TABS)\b/u);
		expect(source).not.toMatch(/(?:runtime\.sendMessage\(\s*\{\s*action|tabs\.sendMessage\([^,]+,\s*\{\s*action)/u);
	});

	test('popup status reads never inject or retry a content runtime', () => {
		const source = readFileSync(join(SOURCE_ROOT, 'popup', 'card', 'init.ts'), 'utf8');
		expect(source).not.toContain('spectra.content.inject');
		expect(source).not.toContain('INJECT_CONTENT_SCRIPT');
		expect(source).not.toMatch(/setTimeout\s*\([^,]+,\s*800\s*\)/u);
	});
});

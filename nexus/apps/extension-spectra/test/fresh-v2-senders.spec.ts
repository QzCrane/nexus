import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SOURCE_ROOT = join(import.meta.dir, '..', 'src');
const SMOKE_PATH = join(import.meta.dir, 'smoke.spec.ts');
const LEGACY_OUTBOUND_ADAPTERS = new Map([
	['background/handlers/audio.ts', 'broadcastLegacyUiSyncForOneRelease'],
	['background/handlers/capture.ts', 'broadcastLegacyCaptureStateForOneRelease'],
	['background/handlers/settings.ts', 'broadcastLegacyGlobalSettingsForOneRelease'],
]);

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

describe('fresh SPECTRA senders use protocol v2', () => {
	test('production clients do not use the unvalidated kernel messenger', () => {
		for (const path of listTypeScriptFiles(SOURCE_ROOT)) {
			const source = readFileSync(path, 'utf8');
			expect(source, portablePath(path)).not.toMatch(/\bcreateMessenger\b/u);
			expect(source, portablePath(path)).not.toMatch(/\bsendToTab\b/u);
			expect(source, portablePath(path)).not.toMatch(/\bmessenger\.send(?:ToTab)?\s*\(/u);
		}
	});

	test('naked action envelopes exist only inside named one-release adapters', () => {
		const v1SendPattern = /(?:chrome\.)?(?:runtime|tabs)\.sendMessage\([^;]{0,800}?\baction\s*:/gu;
		const seenAdapters = new Set<string>();
		for (const path of listTypeScriptFiles(SOURCE_ROOT)) {
			const source = readFileSync(path, 'utf8');
			const matches = [...source.matchAll(v1SendPattern)];
			const relativePath = portablePath(path);
			if (matches.length === 0) continue;
			const adapterName = LEGACY_OUTBOUND_ADAPTERS.get(relativePath);
			expect(adapterName, `${relativePath} has an unnamed v1 sender`).toBeDefined();
			expect(source, relativePath).toContain(`function ${adapterName}`);
			seenAdapters.add(relativePath);
		}
		expect([...seenAdapters].sort()).toEqual([...LEGACY_OUTBOUND_ADAPTERS.keys()].sort());
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

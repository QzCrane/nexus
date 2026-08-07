import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	assertReleaseEntryPaths,
	assertReleaseVersionParity,
	RELEASE_STEPS,
} from '../../../scripts/release-halo';

function readJson(relativePath: string): Record<string, unknown> {
	return JSON.parse(
		readFileSync(new URL(relativePath, import.meta.url), 'utf8'),
	) as Record<string, unknown>;
}

interface ContentScriptManifestEntry {
	js?: string[];
	run_at?: string;
	all_frames?: boolean;
}

describe('HALO release tooling', () => {
	test('requires one SemVer across package, source manifest, and built manifest', () => {
		expect(() => assertReleaseVersionParity('0.6.1', '0.6.1', '0.6.1'))
			.not.toThrow();
		expect(() => assertReleaseVersionParity('0.6', '0.6', '0.6'))
			.toThrow('must be SemVer x.y.z');
		expect(() => assertReleaseVersionParity('0.6.1', '0.6.0'))
			.toThrow('source manifest 0.6.0');
		expect(() => assertReleaseVersionParity('0.6.1', '0.6.1', '0.6.0'))
			.toThrow('built manifest 0.6.0');
	});

	test('rejects unsafe or private archive entries', () => {
		expect(() => assertReleaseEntryPaths([
			'manifest.json',
			'background.js',
			'assets/tool-a.js',
			'_locales/en/messages.json',
		])).not.toThrow();
		expect(() => assertReleaseEntryPaths(['background.js']))
			.toThrow('must contain manifest.json');
		expect(() => assertReleaseEntryPaths(['manifest.json', 'content.js.map']))
			.toThrow('Forbidden HALO release entry');
		expect(() => assertReleaseEntryPaths(['manifest.json', 'docs/private.md']))
			.toThrow('Forbidden HALO release entry');
		expect(() => assertReleaseEntryPaths(['manifest.json', '../secret.txt']))
			.toThrow('Unsafe HALO release path');
	});

	test('checks version parity before expensive release gates', () => {
		expect(RELEASE_STEPS[0]?.label).toBe('version parity');
		expect(RELEASE_STEPS.at(-1)?.label).toBe('staging ZIP');
	});

	test('keeps submitted permissions and public claims tied to implemented behavior', () => {
		const manifest = readJson('../public/manifest.json');
		const userScriptsManifest = readJson('../src/system/userscripts/manifest.json');
		const optionalPermissions = manifest.optional_permissions as string[];
		const description = manifest.description as string;
		const userScriptPermissions = userScriptsManifest.permissions as string[];

		expect(optionalPermissions).not.toContain('webNavigation');
		expect(optionalPermissions).not.toContain('topSites');
		expect(optionalPermissions).not.toContain('notifications');
		expect(description).not.toContain('Zero upload');
		expect(userScriptPermissions).toEqual(['userScripts', '*://*/*']);
	});

	test('locks content-script ownership to the smallest required frame and lifecycle scope', () => {
		const manifest = readJson('../public/manifest.json');
		const contentScripts = manifest.content_scripts as ContentScriptManifestEntry[];
		const byEntry = new Map(
			contentScripts.map((entry) => [entry.js?.[0], entry]),
		);

		expect([...byEntry.keys()]).toEqual([
			'content.js',
			'content-smooth-scroll.js',
			'content-frame-tools.js',
			'content-hover-zoom.js',
			'content-clipboard.js',
		]);
		expect(byEntry.get('content.js')).toMatchObject({
			run_at: 'document_start',
			all_frames: false,
		});
		expect(byEntry.get('content-smooth-scroll.js')).toMatchObject({
			run_at: 'document_start',
			all_frames: true,
		});
		expect(byEntry.get('content-frame-tools.js')).toMatchObject({
			run_at: 'document_start',
			all_frames: true,
		});
		expect(byEntry.get('content-hover-zoom.js')).toMatchObject({
			run_at: 'document_idle',
			all_frames: false,
		});
		expect(byEntry.get('content-clipboard.js')).toMatchObject({
			run_at: 'document_idle',
			all_frames: true,
		});
	});

	test('keeps the standard build production-grade and SidePanel lazy loading physical', () => {
		const packageJson = readJson('../package.json');
		const scripts = packageJson.scripts as Record<string, string>;
		const sidepanelHtml = readFileSync(
			new URL('../public/sidepanel.html', import.meta.url),
			'utf8',
		);

		expect(scripts.build).toBe('bun build.ts');
		expect(scripts['build:dev']).toBe('bun build.ts --dev');
		expect(sidepanelHtml).toContain('<script type="module" src="sidepanel.js"></script>');
	});
});

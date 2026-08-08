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
		expect(scripts.dev).toContain('generate-tool-registry.ts');
		expect(sidepanelHtml).toContain('<script type="module" src="sidepanel.js"></script>');
	});

	test('keeps install-only SaaT metadata out of the ordinary service-worker code graph', () => {
		const background = readFileSync(
			new URL('../src/entry/background.ts', import.meta.url),
			'utf8',
		);
		const generator = readFileSync(
			new URL('../../../scripts/generate-tool-registry.ts', import.meta.url),
			'utf8',
		);

		expect(background).not.toMatch(/import\s+\{[^}]*\bTOOL_REGISTRY\b[^}]*\}/u);
		expect(background).not.toContain('../kernel/registry/tool-registry');
		expect(background).not.toMatch(/from ['"]\.\.\/kernel['"]/u);
		expect(background).toContain('script-plugin-runtime.json');
		expect(generator).toContain('generateScriptRuntimeManifest');
	});

	test('keeps detailed background provenance out of the SidePanel startup projection', () => {
		const compactProjection = readFileSync(
			new URL('../src/kernel/registry/_generated-background-active.ts', import.meta.url),
			'utf8',
		);
		const generator = readFileSync(
			new URL('../../../scripts/registry-gen/gen-registry.ts', import.meta.url),
			'utf8',
		);
		const generateEntryStart = generator.indexOf('const generateEntry');
		const permissionMapStart = generator.indexOf('const permissionMap', generateEntryStart);
		const generatedPluginEntry = generator.slice(generateEntryStart, permissionMapStart);

		expect(compactProjection).toContain('BACKGROUND_ACTIVE_ONLY_MAP');
		expect(compactProjection).not.toContain('sourceFile');
		expect(compactProjection).not.toContain('sourceLine');
		expect(compactProjection).not.toContain('sourceDetail');
		expect(generator).toContain('generateBackgroundActiveProjection');
		expect(generatedPluginEntry).not.toContain('background:');
	});

	test('does not rebuild browser-persistent user-script registrations on every worker wake', () => {
		const background = readFileSync(
			new URL('../src/entry/background.ts', import.meta.url),
			'utf8',
		);
		const registry = readFileSync(
			new URL('../src/system/userscripts/registry.ts', import.meta.url),
			'utf8',
		);

		expect(background).toMatch(/onInstalled[\s\S]*syncRegisteredScripts\(\)/u);
		expect(registry).toContain('persistAcrossSessions: true');
		const initBody = registry.slice(registry.indexOf('export function initUserScriptsRegistry'));
		expect(initBody).not.toMatch(/syncRegisteredScripts\(\);/u);
	});
});

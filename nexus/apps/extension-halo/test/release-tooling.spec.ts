import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	assertReleaseEntryPaths,
	assertReleaseVersionParity,
	RELEASE_STEPS,
} from '../../../scripts/release-halo';
import {
	assertActivationClosureBudget,
	measureDynamicActivationClosures,
} from '../build-activation-closures';

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
	test('gates a complete multi-chunk lazy activation closure', () => {
		const root = process.cwd();
		const closures = measureDynamicActivationClosures({
			outputs: {
				'dist/sidepanel.js': {
					bytes: 10,
					imports: [{ path: 'chunks/tool.js', kind: 'dynamic-import' }],
				},
				'dist/chunks/tool.js': {
					bytes: 300 * 1024,
					entryPoint: 'src/tools/heavy/panel.tsx',
					imports: [{ path: 'shared.js', kind: 'import-statement' }],
				},
				'dist/chunks/shared.js': { bytes: 300 * 1024 },
			},
		}, root);
		expect(closures).toHaveLength(1);
		const closure = closures[0];
		if (!closure) throw new Error('fixture activation closure is missing');
		expect(closure.bytes).toBe(600 * 1024);
		expect(() => assertActivationClosureBudget(closures, 600)).not.toThrow();
		expect(() => assertActivationClosureBudget([
			{ ...closure, bytes: 600 * 1024 + 1 },
		], 600)).toThrow('activation budget exceeded');
	});

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
		expect(RELEASE_STEPS.find((step) => step.label === 'dependency audit')?.args).toEqual([
			'run',
			'audit:dependencies',
		]);
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
		expect(manifest.name).toBe('HALO - Local Utility SidePanel');
		expect(manifest.minimum_chrome_version).toBe('135');
		const engine = readFileSync(new URL('../src/system/userscripts/engine.ts', import.meta.url), 'utf8');
		expect(engine).toContain('chrome.userScripts.execute({');
		expect(engine).not.toContain('chrome.scripting.executeScript({');
	});

	test('locks content-script ownership to release-admitted frame and lifecycle scope', () => {
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
		]);
		expect(byEntry.get('content.js')).toMatchObject({
			run_at: 'document_start',
			all_frames: false,
		});
		expect(byEntry.get('content-smooth-scroll.js')).toMatchObject({
			run_at: 'document_start',
			all_frames: false,
		});
		expect(byEntry.get('content-frame-tools.js')).toMatchObject({
			run_at: 'document_start',
			all_frames: true,
		});
		expect(byEntry.get('content-hover-zoom.js')).toMatchObject({
			run_at: 'document_idle',
			all_frames: false,
		});
		expect(byEntry.has('content-clipboard.js')).toBe(false);
		expect(contentScripts.some((entry) => entry.run_at === 'document_idle' && entry.all_frames === true))
			.toBe(false);
	});

	test('keeps catalog-only modules out of production runtime projections', () => {
		const loader = readFileSync(
			new URL('../src/components/_generated-tool-loader.ts', import.meta.url),
			'utf8',
		);
		const backgroundProjection = readFileSync(
			new URL('../src/kernel/registry/_generated-background-active.ts', import.meta.url),
			'utf8',
		);
		const build = readFileSync(new URL('../build.ts', import.meta.url), 'utf8');
		const catalogOnlyIds = [
			'archive', 'base64', 'clipboard', 'pdf', 'regex', 'screenshot', 'sticky-notes', 'timer',
		];
		for (const id of catalogOnlyIds) {
			expect(loader).not.toContain(`'${id}': memoizePanelLoader`);
		}
		expect(backgroundProjection).not.toContain('"clipboard"');
		expect(backgroundProjection).not.toContain('"timer"');
		expect(build).not.toContain("out: 'content-clipboard.js'");
		expect(build).toContain('assertNoCatalogOnlySidepanelInputs');
	});

	test('keeps the standard build production-grade and SidePanel lazy loading physical', () => {
		const packageJson = readJson('../package.json');
		const scripts = packageJson.scripts as Record<string, string>;
		const sidepanelHtml = readFileSync(
			new URL('../public/sidepanel.html', import.meta.url),
			'utf8',
		);

		expect(scripts.build).toBe('bun build.ts');
		expect(scripts['build:prod']).toBe('bun build.ts');
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

	test('keeps startup background classification on the compact generated projection', () => {
		const compactProjection = readFileSync(
			new URL('../src/kernel/registry/_generated-background-active.ts', import.meta.url),
			'utf8',
		);
		const activeServices = readFileSync(
			new URL('../src/components/sidepanel/ActiveServicesContext.tsx', import.meta.url),
			'utf8',
		);
		const categorizedTools = readFileSync(
			new URL('../src/components/sidepanel/hooks/use-categorized-tools.ts', import.meta.url),
			'utf8',
		);
		const generator = readFileSync(
			new URL('../../../scripts/registry-gen/gen-registry.ts', import.meta.url),
			'utf8',
		);

		expect(compactProjection).toContain('BACKGROUND_ACTIVE_ONLY_MAP');
		expect(compactProjection).not.toContain('sourceFile');
		expect(compactProjection).not.toContain('sourceAnchor');
		expect(compactProjection).not.toContain('sourceDetail');
		expect(activeServices).toContain("from '../../kernel/registry/_generated-background-active'");
		expect(activeServices).not.toContain('BACKGROUND_PROFILES_MAP');
		expect(categorizedTools).toContain("from '../../../kernel/registry/_generated-background-active'");
		expect(categorizedTools).not.toContain('BACKGROUND_PROFILES_MAP');
		expect(generator).toContain('generateBackgroundActiveProjection');
		expect(generator).not.toContain('generateStartupRegistry');
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

	test('publishes context-menu entries only for implemented ready-tool activation protocols', () => {
		const background = readFileSync(
			new URL('../src/entry/background.ts', import.meta.url),
			'utf8',
		);
		const sidepanel = readFileSync(
			new URL('../src/components/sidepanel/use-sidepanel-state.ts', import.meta.url),
			'utf8',
		);
		expect(background).not.toContain('halo-pdf-link');
		expect(background).not.toContain('HALO_PREFILL_QR');
		expect(background).toContain("toolId: 'qrcode'");
		expect(background).toContain('chrome.storage.session.set');
		expect(sidepanel).toContain('parseSidepanelActivationDelivery(message)');
		expect(sidepanel).toContain('publishSidepanelActivation');
	});

	test('bounds global toast ownership and disposes every timer on provider retirement', () => {
		const overlay = readFileSync(
			new URL('../src/components/ui/overlay/OverlayProvider.tsx', import.meta.url),
			'utf8',
		);
		expect(overlay).toContain('const MAX_TOASTS = 4');
		expect(overlay).toContain('next.slice(-MAX_TOASTS)');
		expect(overlay).toContain('toastTimersRef.current.clear()');
		expect(overlay).toContain('config.duration ?? 3000');
	});
});

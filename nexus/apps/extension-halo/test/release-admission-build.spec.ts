import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function read(relativePath: string): string {
	return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('HALO release-admitted physical build graph', () => {
	test('builds executable entries only from the generated release projection', () => {
		const build = read('../build.ts');
		const projection = read('../src/kernel/registry/_generated-release-admission.ts');
		expect(build).toContain('RELEASE_CONTENT_SCRIPTS');
		expect(build).toContain('RELEASE_WEB_ACCESSIBLE_RUNTIME_ENTRIES');
		expect(build).toContain('RELEASE_SCRIPT_RUNTIME_IDS');
		expect(build).not.toContain("entry: 'src/entry/content-clipboard.ts'");
		expect(build).not.toContain("out: 'content-clipboard.js'");
		expect(projection).toContain('content-clipboard.js');
		expect(build).toContain('minimum_chrome_version');
		expect(build).not.toContain("target: ['chrome100']");
	});

	test('uses finalization as a zero-residue proof rather than a cleanup mechanism', () => {
		const finalizer = read('../finalize-release-payload.ts');
		expect(finalizer).toContain('verifyBuildEntryProjection');
		expect(finalizer).toContain('producer emitted zero catalog-only executable paths');
		expect(finalizer).not.toContain('removeTree(');
		expect(finalizer).not.toContain('unlinkSync(');
		expect(finalizer).not.toContain('pruneGeneratedPluginDirectories');
	});

	test('derives every retained active-service identity from admission, not provider hardcoding', () => {
		const provider = read('../src/components/sidepanel/ActiveServicesContext.tsx');
		const projection = read('../src/kernel/registry/_generated-release-admission.ts');
		expect(provider).toContain('RELEASE_ACTIVE_SERVICE_CONTRACTS');
		expect(provider).toContain('enabledById');
		expect(provider).not.toContain('clipboardEnabled');
		expect(provider).not.toContain('halo_tool_clipboard_settings');
		expect(provider).not.toContain('halo_hover_zoom_settings');
		expect(provider).not.toContain('HALO_SMOOTH_SCROLL_SETTINGS');
		expect(projection).toContain('halo_hover_zoom_settings');
		expect(projection).toContain('HALO_SMOOTH_SCROLL_SETTINGS');
		expect(projection).toContain('halo_tool_clipboard_settings');
	});
});

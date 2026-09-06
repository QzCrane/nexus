import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
	new URL('../../.github/workflows/dependency-update-evidence.yml', import.meta.url),
	'utf8',
);

describe('dependency update evidence workflow', () => {
	test('is scoped to the product lock plus evidence-owner changes, not every package metadata edit', () => {
		expect(workflow).toContain("- 'nexus/bun.lock'");
		expect(workflow).not.toContain("- 'nexus/package.json'");
		expect(workflow).toContain("- '.github/workflows/dependency-update-evidence.yml'");
	});

	test('builds the exact base in an isolated worktree with its own frozen lock', () => {
		expect(workflow).toContain('git worktree add --detach "$base_root" "$base_sha"');
		expect(workflow).toContain('bun install --cwd "$BASE_ROOT/nexus" --frozen-lockfile');
		expect(workflow).toContain('bun run --cwd "$BASE_ROOT/nexus" build');
		expect(workflow).toContain('bun install --cwd nexus --frozen-lockfile');
		expect(workflow).toContain('bun run --cwd nexus build');
		expect(workflow).toContain('test -s "$root/nexus/apps/extension-$product/dist/manifest.json"');
	});

	test('fails candidate governance before any production build or browser measurement', () => {
		const governance = workflow.indexOf('bun --cwd nexus check:governance');
		const build = workflow.indexOf('bun run --cwd "$BASE_ROOT/nexus" build');
		const browser = workflow.indexOf('bunx playwright install-deps chromium');
		expect(governance).toBeGreaterThan(0);
		expect(governance).toBeLessThan(build);
		expect(build).toBeLessThan(browser);
	});

	test('uses the candidate workload for both measured artifact directories and exact identities', () => {
		const baseMeasure = workflow.slice(
			workflow.indexOf('- name: Measure base artifacts with candidate workload'),
			workflow.indexOf('- name: Measure candidate artifacts with the same workload'),
		);
		const candidateMeasure = workflow.slice(
			workflow.indexOf('- name: Measure candidate artifacts with the same workload'),
			workflow.indexOf('- name: Build exact dependency-update delta evidence'),
		);
		for (const measure of [baseMeasure, candidateMeasure]) {
			expect(measure).toContain('bun run --cwd nexus/apps/extension-halo test:performance');
			expect(measure).toContain('bun run --cwd nexus/apps/extension-spectra test:performance');
			expect(measure).toContain('NEXUS_PERFORMANCE_TARGET_HEAD');
			expect(measure).toContain('NEXUS_PERFORMANCE_TARGET_TREE');
			expect(measure).toContain('NEXUS_PERFORMANCE_OUTPUT_DIR');
			expect(measure).toContain('HALO_EXTENSION_DIR');
			expect(measure).toContain('SPECTRA_EXTENSION_DIR');
		}
		expect(baseMeasure).toContain('$BASE_ROOT/nexus/apps/extension-halo/dist');
		expect(candidateMeasure).toContain('$GITHUB_WORKSPACE/nexus/apps/extension-halo/dist');
	});

	test('derives one canonical Chrome floor and uploads only immutable comparison evidence', () => {
		expect(workflow).toContain('bun nexus/scripts/browser-floor.ts github-env >> "$GITHUB_ENV"');
		expect(workflow).toContain('printf \'%s  %s\\n\' "$CHROME_FLOOR_SHA256" "$archive" | sha256sum --check --strict');
		expect(workflow).toContain('bun nexus/scripts/dependency-update-evidence.ts');
		expect(workflow).toContain('actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1');
		expect(workflow).toContain('if-no-files-found: error');
	});
});

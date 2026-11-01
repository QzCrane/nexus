import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { inspectWorkflowActions } from './check-workflow-actions';

const workflow = readFileSync(
	new URL('../../.github/workflows/dependency-update-evidence.yml', import.meta.url),
	'utf8',
);

const retainStep = workflow
	.split(/\r?\n/u)
	.find((line) => /^\s*(?:-\s*)?uses:\s*actions\/upload-artifact@/u.test(line));

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

	test('configures the matching sandbox without disabling browser or host protection', () => {
		const download = workflow.indexOf('"$CHROME_FLOOR_SHA256" "$archive" | sha256sum --check --strict');
		const install = workflow.indexOf('sudo install -o root -g root -m 4755');
		expect(download).toBeGreaterThan(0);
		expect(install).toBeGreaterThan(download);
		expect(workflow).toContain('CHROME_DEVEL_SANDBOX=$sandbox_helper');
		expect(workflow).toContain('cmp "$sandbox_source" "$sandbox_helper"');
		expect(workflow).not.toContain('--no-sandbox');
		expect(workflow).not.toContain('sysctl');
	});

	test('keeps candidate measurements and diagnostic evidence when the baseline fails without masking failure', () => {
		expect(workflow).toContain(`if: \${{ !cancelled() && steps.chrome_floor.outcome == 'success' }}`);
		expect(workflow).toContain("steps.base_measurement.outcome == 'success' && steps.candidate_measurement.outcome == 'success'");
		expect(workflow).toContain(`if: \${{ !cancelled() && env.EVIDENCE_ROOT != '' }}`);
		expect(workflow).toContain('tee -a "$EVIDENCE_ROOT/base/workload.log"');
		expect(workflow).toContain('tee -a "$EVIDENCE_ROOT/candidate/workload.log"');
		expect(workflow).not.toContain('continue-on-error');
	});

	test('derives one canonical Chrome floor and uploads only immutable comparison evidence', () => {
		expect(workflow).toContain('bun nexus/scripts/browser-floor.ts github-env >> "$GITHUB_ENV"');
		expect(workflow).toContain('printf \'%s  %s\\n\' "$CHROME_FLOOR_SHA256" "$archive" | sha256sum --check --strict');
		expect(workflow).toContain('bun nexus/scripts/dependency-update-evidence.ts');
		expect(retainStep).toBeDefined();
		// The pin rules belong to check-workflow-actions.ts. Asserting that the
		// retain step satisfies them keeps the immutability guarantee without
		// freezing one release here, so a legitimate bump needs no spec edit.
		expect(inspectWorkflowActions('dependency-update-evidence.yml', retainStep ?? '')).toEqual([]);
		expect(workflow).toContain('if-no-files-found: error');
	});
});

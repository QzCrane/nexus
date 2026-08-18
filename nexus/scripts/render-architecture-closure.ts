// goal: keep human backlog views as thin deterministic projections of architecture-closure.json
// inv: the JSON manifest is the only owner of task semantics; docs/Issue repeat only navigation/status metadata

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readArchitectureClosureManifest } from './check-architecture-closure.ts';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = resolve(workspaceDir, 'docs', 'architecture-closure.md');

function escapeCell(value: string): string {
	return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function renderArchitectureClosure(): string {
	const manifest = readArchitectureClosureManifest();
	const statusCounts = new Map<string, number>();
	for (const task of manifest.tasks) {
		statusCounts.set(task.status, (statusCounts.get(task.status) ?? 0) + 1);
	}
	const table = manifest.tasks.map((task) => (
		`| \`${escapeCell(task.id)}\` | ${task.priority} | ${escapeCell(task.area)} | ${escapeCell(task.owner)} | ${task.status} | ${task.acceptance.length} | ${task.evidence.length} |`
	)).join('\n');

	return `---
type: reference
status: active
audience: contributor
owner: repository-governance
generated_from: ../architecture-closure.json
issue: ${manifest.issue}
branch: ${manifest.branch}
---

# Architecture Closure Epoch

This is a generated **status/index projection** of [\`architecture-closure.json\`](../architecture-closure.json). Do not edit task semantics, acceptance clauses, evidence, blockers, or state here. The JSON manifest is the sole task authority; GitHub Issue #${manifest.issue} is another thin projection.

Priority is fixed at **P0 → P1 → P2**. Individual HALO feature internals remain P2 unless they block shared release correctness.

Current projection: ${manifest.tasks.length} retained tasks; ${['queued', 'active', 'blocked', 'done', 'rejected'].map((status) => `${status}=${statusCounts.get(status) ?? 0}`).join(', ')}.

| Task | Priority | Area | Owner | Status | Acceptance clauses | Evidence items |
| --- | --- | --- | --- | --- | ---: | ---: |
${table}
`;
}

export function checkArchitectureClosureProjection(): void {
	const expected = renderArchitectureClosure();
	const actual = readFileSync(outputPath, 'utf8');
	if (actual !== expected) {
		throw new Error('docs/architecture-closure.md is stale; run bun scripts/render-architecture-closure.ts --write');
	}
	console.log('✓ Architecture closure Markdown projection matches canonical JSON');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const mode = process.argv[2] ?? '--stdout';
	if (mode === '--write') {
		writeFileSync(outputPath, renderArchitectureClosure(), 'utf8');
		console.log('✓ Wrote docs/architecture-closure.md');
	} else if (mode === '--check') {
		checkArchitectureClosureProjection();
	} else if (mode === '--issue-body' || mode === '--stdout') {
		process.stdout.write(renderArchitectureClosure());
	} else {
		throw new Error(`Unknown render-architecture-closure mode: ${mode}`);
	}
}

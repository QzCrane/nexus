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

function projectionFacts(): {
	manifest: ReturnType<typeof readArchitectureClosureManifest>;
	counts: string;
	table: string;
} {
	const manifest = readArchitectureClosureManifest();
	const statusCounts = new Map<string, number>();
	for (const task of manifest.tasks) statusCounts.set(task.status, (statusCounts.get(task.status) ?? 0) + 1);
	return {
		manifest,
		counts: ['queued', 'active', 'blocked', 'done', 'rejected']
			.map((status) => `${status}=${statusCounts.get(status) ?? 0}`).join(', '),
		table: manifest.tasks.map((task) => (
			`| \`${escapeCell(task.id)}\` | ${task.priority} | ${escapeCell(task.area)} | ${escapeCell(task.owner)} | ${task.status} | ${task.acceptance.length} | ${task.evidence.length} |`
		)).join('\n'),
	};
}

function statusSection(canonicalLink: string): string {
	const { manifest, counts, table } = projectionFacts();
	return `# Architecture Closure Epoch

The canonical task owner is ${canonicalLink}. This is a generated **status/index projection** only. Do not edit task semantics, acceptance clauses, evidence, blockers, or state here.

Single execution branch: \`${manifest.branch}\`. Priority is fixed at **P0 → P1 → P2**. Individual HALO feature internals remain P2 unless they block shared release correctness.

Current projection: ${manifest.tasks.length} retained tasks; ${counts}.

| Task | Priority | Area | Owner | Status | Acceptance clauses | Evidence items |
| --- | --- | --- | --- | --- | ---: | ---: |
${table}
`;
}

export function renderArchitectureClosure(): string {
	const { manifest } = projectionFacts();
	return `---
type: reference
status: stable
audience: contributor
owner: repository-governance
generated_from: ../architecture-closure.json
issue: ${manifest.issue}
branch: ${manifest.branch}
---

${statusSection('[`architecture-closure.json`](../architecture-closure.json)')}`;
}

export function renderArchitectureClosureIssueBody(): string {
	const { manifest } = projectionFacts();
	return `<!-- generated from nexus/architecture-closure.json; do not hand-edit task state -->\n${statusSection(`[\`nexus/architecture-closure.json\`](../blob/${manifest.branch}/nexus/architecture-closure.json)`)}`;
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
	} else if (mode === '--issue-body') {
		process.stdout.write(renderArchitectureClosureIssueBody());
	} else if (mode === '--stdout') {
		process.stdout.write(renderArchitectureClosure());
	} else {
		throw new Error(`Unknown render-architecture-closure mode: ${mode}`);
	}
}

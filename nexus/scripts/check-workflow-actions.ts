// goal: make third-party GitHub Actions immutable and reviewable
// inv: external workflow actions use a full 40-char commit SHA plus a human-readable version comment

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = resolve(workspaceDir, '..');
const workflowsDir = resolve(repoRoot, '.github', 'workflows');

const USES_LINE = /^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s+#\s*(.+))?\s*$/u;
const EXTERNAL_ACTION = /^([^/\s]+)\/([^@\s]+)@([0-9a-f]{40})$/u;
const VERSION_COMMENT = /^(?:v?\d+\.\d+\.\d+|v?\d+(?:\.x){0,2})(?:\s|$)/u;

export interface WorkflowActionFinding {
	file: string;
	line: number;
	message: string;
}

export function inspectWorkflowActions(
	file: string,
	source: string,
): WorkflowActionFinding[] {
	const findings: WorkflowActionFinding[] = [];
	for (const [index, line] of source.split(/\r?\n/u).entries()) {
		const match = USES_LINE.exec(line);
		if (!match) continue;
		const [, reference, comment] = match;
		if (reference.startsWith('./')) continue;
		if (reference.startsWith('docker://')) {
			findings.push({
				file,
				line: index + 1,
				message: `docker action reference must be replaced by a digest-owned job/container boundary: ${reference}`,
			});
			continue;
		}
		if (!EXTERNAL_ACTION.test(reference)) {
			findings.push({
				file,
				line: index + 1,
				message: `external action is not pinned to a full commit SHA: ${reference}`,
			});
			continue;
		}
		if (!comment || !VERSION_COMMENT.test(comment.trim())) {
			findings.push({
				file,
				line: index + 1,
				message: `immutable action pin needs a version comment: ${reference}`,
			});
		}
	}
	return findings;
}

export function checkWorkflowActions(): void {
	const files = readdirSync(workflowsDir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && /\.ya?ml$/u.test(entry.name))
		.map((entry) => entry.name)
		.sort();
	const findings = files.flatMap((file) => inspectWorkflowActions(
		file,
		readFileSync(resolve(workflowsDir, file), 'utf8'),
	));
	if (findings.length > 0) {
		throw new Error(
			`Mutable GitHub Action references are forbidden:\n${findings
				.map((finding) => `- ${finding.file}:${finding.line}: ${finding.message}`)
				.join('\n')}`,
		);
	}
	console.log(`✓ Workflow actions: ${files.length} workflow file(s), external actions are immutable SHA pins`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	checkWorkflowActions();
}

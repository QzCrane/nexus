// goal: turn deterministic visual capture into an actual regression gate once a reviewed baseline is certified
// inv: baseline-required may emit review candidates but cannot claim equality; enforced must compare exact PNG SHA-256

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultWorkspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultPolicyPath = resolve(defaultWorkspaceDir, 'visual-regression-policy.json');
const SHA256 = /^[a-f0-9]{64}$/u;

export interface VisualRegressionState {
	id: string;
	baselinePath: string;
	baselineSha256: string | null;
}

export interface VisualRegressionPolicyView {
	phase: 'baseline-required' | 'enforced';
	comparison: 'exact-png-sha256';
	states: VisualRegressionState[];
}

export interface VisualCandidateVerification {
	mode: 'baseline-update' | 'candidate-only' | 'matched';
	sha256: string;
}

function readPolicy(): VisualRegressionPolicyView {
	return JSON.parse(readFileSync(defaultPolicyPath, 'utf8')) as VisualRegressionPolicyView;
}

function sha256(path: string): string {
	return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function verifyVisualRegressionCandidate(options: {
	stateId: string;
	candidatePath: string;
	baselinePath: string;
	updateBaseline: boolean;
	policy?: VisualRegressionPolicyView;
	workspaceDir?: string;
}): VisualCandidateVerification {
	const policy = options.policy ?? readPolicy();
	const workspaceDir = options.workspaceDir ?? defaultWorkspaceDir;
	if (policy.comparison !== 'exact-png-sha256') {
		throw new Error(`Visual candidate comparison is unsupported: ${String(policy.comparison)}`);
	}
	const state = policy.states.find((candidate) => candidate.id === options.stateId);
	if (!state) throw new Error(`Visual state is not owned by policy: ${options.stateId}`);

	const canonicalBaselinePath = resolve(workspaceDir, state.baselinePath);
	if (resolve(options.baselinePath) !== canonicalBaselinePath) {
		throw new Error(
			`${options.stateId}: capture baseline path ${resolve(options.baselinePath)} does not match policy ${canonicalBaselinePath}`,
		);
	}

	if (options.updateBaseline) {
		if (!existsSync(options.baselinePath)) {
			throw new Error(`${options.stateId}: explicit baseline update did not produce ${options.baselinePath}`);
		}
		return { mode: 'baseline-update', sha256: sha256(options.baselinePath) };
	}

	if (!existsSync(options.candidatePath)) {
		throw new Error(`${options.stateId}: visual candidate is missing: ${options.candidatePath}`);
	}
	const candidateSha256 = sha256(options.candidatePath);

	if (policy.phase === 'baseline-required') {
		if (state.baselineSha256 !== null) {
			throw new Error(`${options.stateId}: baseline-required policy cannot carry a certified digest`);
		}
		return { mode: 'candidate-only', sha256: candidateSha256 };
	}

	if (policy.phase !== 'enforced') {
		throw new Error(`${options.stateId}: unsupported visual policy phase ${String(policy.phase)}`);
	}
	if (!existsSync(options.baselinePath)) {
		throw new Error(`${options.stateId}: enforced baseline is missing: ${options.baselinePath}`);
	}
	if (typeof state.baselineSha256 !== 'string' || !SHA256.test(state.baselineSha256)) {
		throw new Error(`${options.stateId}: enforced visual state has no certified SHA-256`);
	}
	const baselineSha256 = sha256(options.baselinePath);
	if (baselineSha256 !== state.baselineSha256) {
		throw new Error(
			`${options.stateId}: certified baseline file drift ${baselineSha256} != ${state.baselineSha256}`,
		);
	}
	if (candidateSha256 !== state.baselineSha256) {
		throw new Error(
			`${options.stateId}: visual regression ${candidateSha256} != ${state.baselineSha256}`,
		);
	}
	return { mode: 'matched', sha256: candidateSha256 };
}

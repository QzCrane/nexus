// goal: make visual regression evidence explicit, pinned, executable and non-self-updating
// inv: baseline-required cannot claim visual success; enforced baselines are exact SHA-bound artifacts recorded only through pinned capture owners

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const policyPath = resolve(workspaceDir, 'visual-regression-policy.json');
const SHA256 = /^[a-f0-9]{64}$/u;
const STATE_ID = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/u;

interface VisualState {
	id: string;
	product: 'halo' | 'spectra';
	captureTest: string;
	verifyScript: string;
	updateScript: string;
	packagePath: string;
	baselinePath: string;
	width: number;
	height: number;
	locale: string;
	theme: 'dark' | 'light';
	reducedMotion: boolean;
	baselineSha256: string | null;
	provenance: string;
}

interface VisualPolicy {
	schemaVersion: 1;
	phase: 'baseline-required' | 'enforced';
	browserOwner: string;
	comparison: 'exact-png-sha256';
	verification: {
		workspacePackagePath: string;
		workspaceScript: string;
		workflowPath: string;
	};
	states: VisualState[];
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function sha256(path: string): string {
	return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function positiveInteger(value: unknown, label: string): number {
	if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 4096) {
		throw new Error(`${label} must be an integer from 1..4096`);
	}
	return Number(value);
}

function normalizeRelative(path: string): string {
	return path.replaceAll('\\', '/');
}

export function checkVisualRegressionPolicy(
	policy: VisualPolicy = readJson<VisualPolicy>(policyPath),
): void {
	if (policy.schemaVersion !== 1) throw new Error('visual regression policy schemaVersion must be 1');
	if (policy.phase !== 'baseline-required' && policy.phase !== 'enforced') {
		throw new Error(`visual regression policy phase is invalid: ${String(policy.phase)}`);
	}
	if (policy.comparison !== 'exact-png-sha256') {
		throw new Error('visual regression comparison must remain exact-png-sha256; fuzzy thresholds require a separate evidence-backed design');
	}
	const browserOwner = resolve(workspaceDir, policy.browserOwner);
	if (!existsSync(browserOwner)) throw new Error(`visual browser owner is missing: ${policy.browserOwner}`);
	const browserOwnerText = readFileSync(browserOwner, 'utf8');
	if (!browserOwnerText.includes('chromeForTestingVersion') || !browserOwnerText.includes('sha256')) {
		throw new Error('visual browser owner must pin Chrome-for-Testing version and digest');
	}

	if (!policy.verification
		|| typeof policy.verification.workspacePackagePath !== 'string'
		|| typeof policy.verification.workspaceScript !== 'string'
		|| typeof policy.verification.workflowPath !== 'string') {
		throw new Error('visual regression policy requires one explicit verification execution owner');
	}
	const workspacePackagePath = resolve(workspaceDir, policy.verification.workspacePackagePath);
	const verificationWorkflowPath = resolve(workspaceDir, policy.verification.workflowPath);
	if (!existsSync(workspacePackagePath)) {
		throw new Error(`visual verification workspace package is missing: ${policy.verification.workspacePackagePath}`);
	}
	if (!existsSync(verificationWorkflowPath)) {
		throw new Error(`visual verification workflow is missing: ${policy.verification.workflowPath}`);
	}
	const workspacePackage = readJson<{ scripts?: Record<string, string> }>(workspacePackagePath);
	const workspaceVerificationCommand = workspacePackage.scripts?.[policy.verification.workspaceScript];
	if (!workspaceVerificationCommand) {
		throw new Error(`visual verification workspace script is missing: ${policy.verification.workspaceScript}`);
	}
	const verificationWorkflow = readFileSync(verificationWorkflowPath, 'utf8');
	const workspaceName = basename(workspaceDir);
	const expectedWorkflowInvocation = `bun run --cwd ${workspaceName} ${policy.verification.workspaceScript}`;
	if (!verificationWorkflow.includes(expectedWorkflowInvocation)) {
		throw new Error(`visual verification workflow does not execute ${expectedWorkflowInvocation}`);
	}
	for (const marker of ['browser-floor.ts github-env', 'NEXUS_CHROME_EXECUTABLE', 'CHROME_FLOOR_SHA256']) {
		if (!verificationWorkflow.includes(marker)) {
			throw new Error(`visual verification workflow is missing pinned-browser marker ${marker}`);
		}
	}

	if (!Array.isArray(policy.states) || policy.states.length === 0) {
		throw new Error('visual regression policy has no critical states');
	}

	const ids = new Set<string>();
	for (const state of policy.states) {
		if (!state || !STATE_ID.test(state.id)) throw new Error(`invalid visual state id: ${String(state?.id)}`);
		if (ids.has(state.id)) throw new Error(`duplicate visual state id: ${state.id}`);
		ids.add(state.id);
		if (state.product !== 'halo' && state.product !== 'spectra') throw new Error(`${state.id}: invalid product`);
		positiveInteger(state.width, `${state.id}.width`);
		positiveInteger(state.height, `${state.id}.height`);
		if (!state.locale?.trim()) throw new Error(`${state.id}: locale is required`);
		if (state.theme !== 'dark' && state.theme !== 'light') throw new Error(`${state.id}: theme must be dark/light`);
		if (state.reducedMotion !== true) {
			throw new Error(`${state.id}: baseline capture must disable motion for deterministic evidence`);
		}
		if (!state.provenance || state.provenance.trim().length < 24) {
			throw new Error(`${state.id}: provenance must explain baseline trust state`);
		}

		const capturePath = resolve(workspaceDir, state.captureTest);
		const packagePath = resolve(workspaceDir, state.packagePath);
		const baselinePath = resolve(workspaceDir, state.baselinePath);
		if (!existsSync(capturePath)) throw new Error(`${state.id}: capture test is missing: ${state.captureTest}`);
		if (!existsSync(packagePath)) throw new Error(`${state.id}: package owner is missing: ${state.packagePath}`);
		const capture = readFileSync(capturePath, 'utf8');
		const pkg = readJson<{ scripts?: Record<string, string> }>(packagePath);
		const verifyCommand = pkg.scripts?.[state.verifyScript];
		if (!verifyCommand) {
			throw new Error(`${state.id}: package verification script ${state.verifyScript} is missing`);
		}
		if (!pkg.scripts?.[state.updateScript]) {
			throw new Error(`${state.id}: package script ${state.updateScript} is missing`);
		}
		const captureName = basename(state.captureTest);
		if (!verifyCommand.includes(captureName)) {
			throw new Error(`${state.id}: verification script ${state.verifyScript} does not execute ${captureName}`);
		}
		if (verifyCommand.includes('NEXUS_UPDATE_VISUAL_BASELINE')) {
			throw new Error(`${state.id}: verification script may not acquire baseline-update authority`);
		}
		const productDir = normalizeRelative(relative(workspaceDir, dirname(packagePath)));
		const expectedWorkspaceDelegation = `--cwd ${productDir} ${state.verifyScript}`;
		if (!workspaceVerificationCommand.includes(expectedWorkspaceDelegation)) {
			throw new Error(`${state.id}: workspace visual verification does not delegate to ${productDir} ${state.verifyScript}`);
		}
		if (!capture.includes('verifyVisualRegressionCandidate')) {
			throw new Error(`${state.id}: capture owner does not verify the candidate against visual-regression-policy.json`);
		}
		for (const marker of [
			'NEXUS_UPDATE_VISUAL_BASELINE',
			'NEXUS_CHROME_EXECUTABLE',
			'NEXUS_EXPECTED_CHROME_VERSION',
			String(state.width),
			String(state.height),
			state.theme,
		]) {
			if (!capture.includes(marker)) throw new Error(`${state.id}: capture owner is missing deterministic marker ${marker}`);
		}
		if (capture.includes("NEXUS_UPDATE_VISUAL_BASELINE === '1'") === false) {
			throw new Error(`${state.id}: baseline writes must require explicit update admission`);
		}

		if (policy.phase === 'baseline-required') {
			if (state.baselineSha256 !== null) {
				throw new Error(`${state.id}: baseline-required phase cannot publish a certified baseline digest`);
			}
			continue;
		}
		if (!existsSync(baselinePath)) throw new Error(`${state.id}: enforced baseline file is missing: ${state.baselinePath}`);
		if (typeof state.baselineSha256 !== 'string' || !SHA256.test(state.baselineSha256)) {
			throw new Error(`${state.id}: enforced baseline requires a SHA-256 digest`);
		}
		const actual = sha256(baselinePath);
		if (actual !== state.baselineSha256) {
			throw new Error(`${state.id}: baseline digest drift ${actual} != ${state.baselineSha256}`);
		}
	}

	console.log(
		`✓ Visual regression policy: phase=${policy.phase}; states=${policy.states.length}; comparison=${policy.comparison}; execution=${policy.verification.workspaceScript}`,
	);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	checkVisualRegressionPolicy();
}

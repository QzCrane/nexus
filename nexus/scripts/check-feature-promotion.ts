// goal: require each new HALO maturity promotion to cite a registered test owner and an exact local execution result
// inv: historical shipped modules remain admitted; a path or unexecuted declaration can never become promotion evidence

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	readReleaseTestOwnership,
	releaseTestDirtyClosurePaths,
	releaseTestEntryArgs,
	releaseTestMaterialPaths,
	type ReleaseTestOwnership,
} from './check-release-test-owners';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(workspaceDir);
const policyPath = resolve(workspaceDir, 'feature-promotion.json');
const admissionPath = resolve(workspaceDir, 'apps/extension-halo/release-admission.json');
const resultDirectory = resolve(repositoryRoot, 'artifacts/feature-promotion');

export const FROZEN_LEGACY_PROMOTION_BASELINE = Object.freeze([
	'bilibili-enhancer', 'color-picker', 'hover-zoom', 'json-formatter', 'outline', 'qrcode', 'ruler', 'settings',
] as const);

export const REQUIRED_PROMOTION_EVIDENCE = Object.freeze([
	'correctness', 'failureBoundary', 'lifecycleRestart', 'permissionPrivacy',
	'accessibility', 'runtimeResources', 'bundleClosure', 'browserCompatibility',
] as const);

type EvidenceDimension = (typeof REQUIRED_PROMOTION_EVIDENCE)[number];
export interface PromotionEvidenceReference { owner: string; testPath: string; entry: string }
export interface PromotionPolicy {
	schemaVersion: 2;
	legacyBaseline: string[];
	requirements: string[];
	evidence: Record<string, Partial<Record<EvidenceDimension, PromotionEvidenceReference[]>>>;
}
interface AdmissionModule { id?: unknown; stage?: unknown }
interface AdmissionDocument { modules?: AdmissionModule[] }
interface MaterialIdentity { path: string; sha256: string }
interface PromotionClaim extends PromotionEvidenceReference { module: string; dimension: EvidenceDimension }

export interface ReleaseTestResultBody {
	schemaVersion: 1;
	authority: 'local-execution-self-report';
	authentication: 'none';
	recordedAt: string;
	head: string;
	tree: string;
	status: 'PASS';
	entry: {
		id: string;
		releasePackagePath: string;
		releaseScript: string;
		coveragePackagePath: string;
		coverageScript: string;
		args: string[];
	};
	materials: MaterialIdentity[];
	owners: Array<{ owner: string; testPath: string; entry: string }>;
	claims: PromotionClaim[];
}

export interface ReleaseTestResultDocument {
	body: ReleaseTestResultBody;
	documentSha256: string;
}

function readJson<T>(path: string): T { return JSON.parse(readFileSync(path, 'utf8')) as T; }
function canonical(value: unknown): string { return JSON.stringify(value); }
function sha256(value: Uint8Array | string): string { return createHash('sha256').update(value).digest('hex'); }
function sha256File(path: string): string { return sha256(readFileSync(path)); }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value);
	return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function git(args: string[]): string {
	const result = spawnSync('git', args, { cwd: workspaceDir, encoding: 'utf8', shell: false });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`Git ${args[0] ?? 'command'} failed: ${String(result.stderr ?? '').trim()}`);
	return String(result.stdout ?? '').trim();
}

function promotedIds(admission: AdmissionDocument): string[] {
	if (!Array.isArray(admission.modules)) throw new Error('HALO release admission has no modules array');
	const ids = admission.modules.flatMap((module) => (
		typeof module.id === 'string' && (module.stage === 'ready' || module.stage === 'beta') ? [module.id] : []
	));
	if (new Set(ids).size !== ids.length) throw new Error('HALO promoted release ids must be unique');
	return ids;
}

function validateReference(
	module: string,
	dimension: EvidenceDimension,
	value: unknown,
	ownership: ReleaseTestOwnership,
): PromotionEvidenceReference {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| !hasExactKeys(value as Record<string, unknown>, ['owner', 'testPath', 'entry'])) {
		throw new Error(`${module}:${dimension}: promotion result reference is malformed`);
	}
	const reference = value as PromotionEvidenceReference;
	if (reference.owner !== module || typeof reference.testPath !== 'string' || typeof reference.entry !== 'string') {
		throw new Error(`${module}:${dimension}: promotion result reference must use the promoted module's test owner`);
	}
	const registered = ownership.owners[reference.owner]?.some(({ path, entry }) => (
		path === reference.testPath && entry === reference.entry
	));
	if (!registered) throw new Error(`${module}:${dimension}: promotion result reference is not registered to a default test entry`);
	return reference;
}

export function promotionClaims({
	policy,
	admission,
	ownership,
}: {
	policy: PromotionPolicy;
	admission: AdmissionDocument;
	ownership: ReleaseTestOwnership;
}): PromotionClaim[] {
	if (policy.schemaVersion !== 2) throw new Error('feature promotion policy must use schemaVersion 2');
	if (!Array.isArray(policy.legacyBaseline) || !Array.isArray(policy.requirements)
		|| !policy.evidence || typeof policy.evidence !== 'object' || Array.isArray(policy.evidence)) {
		throw new Error('feature promotion policy is malformed');
	}
	if ([...policy.legacyBaseline].sort().join('\0') !== [...FROZEN_LEGACY_PROMOTION_BASELINE].sort().join('\0')) {
		throw new Error('legacy promotion baseline is immutable and may not grow, shrink or be rewritten');
	}
	if ([...policy.requirements].sort().join('\0') !== [...REQUIRED_PROMOTION_EVIDENCE].sort().join('\0')) {
		throw new Error('feature promotion evidence dimensions drifted from the repository contract');
	}
	const promoted = promotedIds(admission);
	const promotedSet = new Set(promoted);
	const baseline = new Set(policy.legacyBaseline);
	const claims: PromotionClaim[] = [];
	for (const module of promoted) {
		if (baseline.has(module)) continue;
		const evidence = policy.evidence[module];
		if (!evidence) throw new Error(`${module}: new ready/beta promotion has no evidence record`);
		if (Object.keys(evidence).sort().join('\0') !== [...REQUIRED_PROMOTION_EVIDENCE].sort().join('\0')) {
			throw new Error(`${module}: promotion evidence dimensions are incomplete or unknown`);
		}
		for (const dimension of REQUIRED_PROMOTION_EVIDENCE) {
			const references = evidence[dimension];
			if (!Array.isArray(references) || references.length === 0) throw new Error(`${module}: promotion is missing ${dimension} evidence`);
			for (const value of references) claims.push({
				module,
				dimension,
				...validateReference(module, dimension, value, ownership),
			});
		}
	}
	for (const module of Object.keys(policy.evidence)) {
		if (!promotedSet.has(module)) throw new Error(`${module}: promotion evidence exists for a module that is not currently ready/beta admitted`);
		if (baseline.has(module)) throw new Error(`${module}: legacy baseline evidence must not masquerade as a new promotion transition`);
	}
	const identities = claims.map((claim) => canonical(claim));
	if (new Set(identities).size !== identities.length) throw new Error('feature promotion evidence contains duplicate result references');
	return claims.sort((left, right) => canonical(left).localeCompare(canonical(right)));
}

export function checkFeaturePromotion({
	policy = readJson<PromotionPolicy>(policyPath),
	admission = readJson<AdmissionDocument>(admissionPath),
	ownership = readReleaseTestOwnership({ admission }),
}: { policy?: PromotionPolicy; admission?: AdmissionDocument; ownership?: ReleaseTestOwnership } = {}): void {
	const claims = promotionClaims({ policy, admission, ownership });
	console.log(`✓ Feature promotion result references: ${claims.length}; paths and declarations alone carry no PASS authority`);
}

function materials(ownership: ReleaseTestOwnership): MaterialIdentity[] {
	return releaseTestMaterialPaths(ownership).map((path) => ({ path, sha256: sha256File(resolve(workspaceDir, path)) }));
}

function resultPath(head: string, entry: string, directory = resultDirectory): string {
	return resolve(directory, `halo.${head}.${entry}.json`);
}

function buildResultBody({
	entryId,
	policy,
	admission,
	ownership,
	runGit,
}: {
	entryId: string;
	policy: PromotionPolicy;
	admission: AdmissionDocument;
	ownership: ReleaseTestOwnership;
	runGit: (args: string[]) => string;
}): ReleaseTestResultBody {
	const entry = ownership.entries[entryId];
	if (!entry) throw new Error(`unknown HALO release test entry: ${entryId}`);
	const dirty = runGit([
		'status', '--porcelain=v1', '--untracked-files=all', '--', ...releaseTestDirtyClosurePaths(ownership),
	]);
	if (dirty) throw new Error(`HALO release test result refuses dirty material/test closure:\n${dirty}`);
	const head = runGit(['rev-parse', 'HEAD']);
	const tree = runGit(['rev-parse', 'HEAD^{tree}']);
	if (!/^[a-f0-9]{40,64}$/u.test(head) || !/^[a-f0-9]{40,64}$/u.test(tree)) throw new Error('HALO release test Git identity is malformed');
	const owners = Object.entries(ownership.owners).flatMap(([owner, registrations]) => registrations
		.filter(({ entry: candidate }) => candidate === entryId)
		.map(({ path }) => ({ owner, testPath: path, entry: entryId })))
		.sort((left, right) => canonical(left).localeCompare(canonical(right)));
	const claims = promotionClaims({ policy, admission, ownership }).filter(({ entry: candidate }) => candidate === entryId);
	return {
		schemaVersion: 1,
		authority: 'local-execution-self-report',
		authentication: 'none',
		recordedAt: runGit(['show', '-s', '--format=%cI', head]),
		head,
		tree,
		status: 'PASS',
		entry: { id: entryId, ...entry, args: releaseTestEntryArgs(entryId, ownership) },
		materials: materials(ownership),
		owners,
		claims,
	};
}

export function recordReleaseTestResult(entryId: string, {
	policy = readJson<PromotionPolicy>(policyPath),
	admission = readJson<AdmissionDocument>(admissionPath),
	ownership = readReleaseTestOwnership({ admission }),
	runGit = git,
	directory = resultDirectory,
}: {
	policy?: PromotionPolicy;
	admission?: AdmissionDocument;
	ownership?: ReleaseTestOwnership;
	runGit?: (args: string[]) => string;
	directory?: string;
} = {}): string {
	const body = buildResultBody({ entryId, policy, admission, ownership, runGit });
	const document: ReleaseTestResultDocument = { body, documentSha256: sha256(canonical(body)) };
	mkdirSync(directory, { recursive: true });
	const output = resultPath(body.head, entryId, directory);
	writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
	console.log(`✓ HALO ${entryId} local-execution self-report: PASS ${relative(repositoryRoot, output).replaceAll('\\', '/')}`);
	return output;
}

export function verifyFeaturePromotionResults({
	policy = readJson<PromotionPolicy>(policyPath),
	admission = readJson<AdmissionDocument>(admissionPath),
	ownership = readReleaseTestOwnership({ admission }),
	runGit = git,
	directory = resultDirectory,
}: {
	policy?: PromotionPolicy;
	admission?: AdmissionDocument;
	ownership?: ReleaseTestOwnership;
	runGit?: (args: string[]) => string;
	directory?: string;
} = {}): void {
	const claims = promotionClaims({ policy, admission, ownership });
	const entries = [...new Set(claims.map(({ entry }) => entry))];
	for (const entry of entries) {
		const expected = buildResultBody({ entryId: entry, policy, admission, ownership, runGit });
		const path = resultPath(expected.head, entry, directory);
		if (!existsSync(path)) throw new Error(`${entry}: feature promotion PASS result is missing`);
		const actual = readJson<ReleaseTestResultDocument>(path);
		if (actual.documentSha256 !== sha256(canonical(actual.body)) || canonical(actual.body) !== canonical(expected)) {
			throw new Error(`${entry}: feature promotion PASS result is stale or bound to different materials`);
		}
	}
	console.log(`✓ Feature promotion local execution results: ${claims.length} exact claim(s), ${entries.length} PASS receipt(s)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) checkFeaturePromotion();

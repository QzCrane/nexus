// goal: make ready/beta promotion a complete evidence transition rather than a manifest label edit
// inv: the historical shipped baseline can only shrink; every new ready/beta id owns every required evidence dimension

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const policyPath = resolve(workspaceDir, 'feature-promotion.json');
const admissionPath = resolve(workspaceDir, 'apps/extension-halo/release-admission.json');

export const FROZEN_LEGACY_PROMOTION_BASELINE = Object.freeze([
	'bilibili-enhancer',
	'color-picker',
	'hover-zoom',
	'json-formatter',
	'outline',
	'qrcode',
	'ruler',
	'settings',
] as const);

export const REQUIRED_PROMOTION_EVIDENCE = Object.freeze([
	'correctness',
	'failureBoundary',
	'lifecycleRestart',
	'permissionPrivacy',
	'accessibility',
	'runtimeResources',
	'bundleClosure',
	'browserCompatibility',
] as const);

type EvidenceDimension = (typeof REQUIRED_PROMOTION_EVIDENCE)[number];

interface PromotionPolicy {
	schemaVersion: 1;
	legacyBaseline: string[];
	requirements: string[];
	evidence: Record<string, Partial<Record<EvidenceDimension, string[]>>>;
}

interface AdmissionModule {
	id?: unknown;
	stage?: unknown;
}

interface AdmissionDocument {
	modules?: AdmissionModule[];
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function canonical(values: readonly string[]): string {
	return [...values].sort().join('\0');
}

function validateEvidencePath(id: string, dimension: string, path: string): void {
	if (!path || path.includes('..') || path.startsWith('/')) {
		throw new Error(`${id}:${dimension}: evidence path must be repository-relative`);
	}
	if (!existsSync(resolve(workspaceDir, path))) {
		throw new Error(`${id}:${dimension}: evidence path does not exist: ${path}`);
	}
}

export function checkFeaturePromotion({
	policy = readJson<PromotionPolicy>(policyPath),
	admission = readJson<AdmissionDocument>(admissionPath),
}: {
	policy?: PromotionPolicy;
	admission?: AdmissionDocument;
} = {}): void {
	if (policy.schemaVersion !== 1) throw new Error('feature promotion policy must use schemaVersion 1');
	if (canonical(policy.legacyBaseline) !== canonical(FROZEN_LEGACY_PROMOTION_BASELINE)) {
		throw new Error('legacy promotion baseline is immutable and may not grow, shrink or be rewritten');
	}
	if (canonical(policy.requirements) !== canonical(REQUIRED_PROMOTION_EVIDENCE)) {
		throw new Error('feature promotion evidence dimensions drifted from the repository contract');
	}
	if (!Array.isArray(admission.modules)) throw new Error('HALO release admission has no modules array');

	const promotedIds = admission.modules.flatMap((module) => {
		if (typeof module.id !== 'string') return [];
		return module.stage === 'ready' || module.stage === 'beta' ? [module.id] : [];
	});
	const promotedSet = new Set(promotedIds);
	if (promotedSet.size !== promotedIds.length) throw new Error('HALO promoted release ids must be unique');
	const baseline = new Set<string>(policy.legacyBaseline);

	for (const id of promotedIds) {
		if (baseline.has(id)) continue;
		const evidence = policy.evidence[id];
		if (!evidence) throw new Error(`${id}: new ready/beta promotion has no evidence record`);
		for (const dimension of REQUIRED_PROMOTION_EVIDENCE) {
			const paths = evidence[dimension];
			if (!Array.isArray(paths) || paths.length === 0 || paths.some((path) => typeof path !== 'string')) {
				throw new Error(`${id}: promotion is missing ${dimension} evidence`);
			}
			for (const path of new Set(paths)) validateEvidencePath(id, dimension, path);
		}
	}

	for (const id of Object.keys(policy.evidence)) {
		if (!promotedSet.has(id)) {
			throw new Error(`${id}: promotion evidence exists for a module that is not currently ready/beta admitted`);
		}
		if (baseline.has(id)) {
			throw new Error(`${id}: legacy baseline evidence must not masquerade as a new promotion transition`);
		}
	}
	console.log(`✓ Feature promotion gate: ${promotedIds.length} ready/beta admitted; ${promotedIds.filter((id) => !baseline.has(id)).length} post-baseline promotion(s)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	checkFeaturePromotion();
}

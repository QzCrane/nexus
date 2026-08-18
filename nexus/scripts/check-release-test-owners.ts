// goal: prevent high-risk HALO runtime surfaces from shipping without focused tests in the default gate
// inv: every admitted runtime-bearing module has at least one registered, executable focused test owner

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const haloDir = resolve(workspaceDir, 'apps/extension-halo');
const admissionPath = resolve(haloDir, 'release-admission.json');
const ownersPath = resolve(haloDir, 'release-test-owners.json');
const packagePath = resolve(haloDir, 'package.json');
const RISK_SURFACES = new Set(['script-runtime', 'content-runtime', 'background-runtime']);

interface AdmissionModule {
	id?: unknown;
	surfaces?: unknown;
}

interface AdmissionDocument {
	modules?: AdmissionModule[];
}

interface OwnersDocument {
	schemaVersion?: unknown;
	owners?: unknown;
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function highRiskIds(admission: AdmissionDocument): string[] {
	if (!Array.isArray(admission.modules)) throw new Error('HALO release admission has no modules array');
	return admission.modules.flatMap((module) => {
		if (typeof module.id !== 'string' || !Array.isArray(module.surfaces)) return [];
		return module.surfaces.some((surface) => typeof surface === 'string' && RISK_SURFACES.has(surface))
			? [module.id]
			: [];
	}).sort();
}

export function checkReleaseTestOwners({
	admission = readJson<AdmissionDocument>(admissionPath),
	ownersDocument = readJson<OwnersDocument>(ownersPath),
	packageDocument = readJson<{ scripts?: Record<string, string> }>(packagePath),
}: {
	admission?: AdmissionDocument;
	ownersDocument?: OwnersDocument;
	packageDocument?: { scripts?: Record<string, string> };
} = {}): void {
	if (ownersDocument.schemaVersion !== 1 || !ownersDocument.owners
		|| typeof ownersDocument.owners !== 'object' || Array.isArray(ownersDocument.owners)) {
		throw new Error('HALO release test owners must use schemaVersion 1 with an owners object');
	}
	const ownerMap = ownersDocument.owners as Record<string, unknown>;
	const risky = highRiskIds(admission);
	const ownerIds = Object.keys(ownerMap).sort();
	if (risky.join('\0') !== ownerIds.join('\0')) {
		throw new Error(`HALO risk-test ownership drift: runtime=${risky.join(',')} owners=${ownerIds.join(',')}`);
	}
	const testUnit = packageDocument.scripts?.['test:unit'] ?? '';
	const browserFast = packageDocument.scripts?.['test:browser-chromium:fast'] ?? '';
	for (const id of risky) {
		const paths = ownerMap[id];
		if (!Array.isArray(paths) || paths.length === 0 || paths.some((path) => typeof path !== 'string')) {
			throw new Error(`${id}: focused test owners must be a non-empty string array`);
		}
		if (new Set(paths).size !== paths.length) throw new Error(`${id}: focused test owners contain duplicates`);
		for (const path of paths) {
			if (path.includes('..') || path.startsWith('/') || !path.startsWith('test/')) {
				throw new Error(`${id}: invalid focused test path ${path}`);
			}
			if (!existsSync(resolve(haloDir, path))) throw new Error(`${id}: focused test is missing: ${path}`);
			if (!testUnit.includes(path) && !browserFast.includes(path)) {
				throw new Error(`${id}: focused test is not executed by a default release gate: ${path}`);
			}
		}
	}
	console.log(`✓ HALO risk-weighted test owners: ${risky.length} runtime-bearing release modules`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	checkReleaseTestOwners();
}

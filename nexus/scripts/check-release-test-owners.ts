// goal: prevent high-risk HALO runtime surfaces from shipping without focused tests in the default gate
// inv: every admitted runtime-bearing module has at least one registered, executable test that is physically anchored to its behavior owner

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

interface OwnerRegistration {
	path?: unknown;
	focusMarkers?: unknown;
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

function shellTokenizesPath(command: string, path: string): boolean {
	return command
		.split(/\s+/u)
		.map((token) => token.replace(/^["']|["']$/gu, ''))
		.includes(path);
}

function validateRegistration(id: string, value: unknown): { path: string; focusMarkers: string[] } {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${id}: focused test owner must be an object`);
	}
	const registration = value as OwnerRegistration;
	if (typeof registration.path !== 'string'
		|| registration.path.includes('..')
		|| registration.path.startsWith('/')
		|| !registration.path.startsWith('test/')) {
		throw new Error(`${id}: invalid focused test path ${String(registration.path)}`);
	}
	if (!Array.isArray(registration.focusMarkers)
		|| registration.focusMarkers.length === 0
		|| registration.focusMarkers.some((marker) => typeof marker !== 'string' || marker.length < 3)) {
		throw new Error(`${id}: ${registration.path} must register non-empty focus markers`);
	}
	const focusMarkers = registration.focusMarkers as string[];
	if (new Set(focusMarkers).size !== focusMarkers.length) {
		throw new Error(`${id}: ${registration.path} focus markers contain duplicates`);
	}
	return { path: registration.path, focusMarkers };
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
	if (ownersDocument.schemaVersion !== 2 || !ownersDocument.owners
		|| typeof ownersDocument.owners !== 'object' || Array.isArray(ownersDocument.owners)) {
		throw new Error('HALO release test owners must use schemaVersion 2 with an owners object');
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
		const registrations = ownerMap[id];
		if (!Array.isArray(registrations) || registrations.length === 0) {
			throw new Error(`${id}: focused test owners must be a non-empty array`);
		}
		const paths = new Set<string>();
		for (const rawRegistration of registrations) {
			const { path, focusMarkers } = validateRegistration(id, rawRegistration);
			if (paths.has(path)) throw new Error(`${id}: focused test owners contain duplicate path ${path}`);
			paths.add(path);
			const absolutePath = resolve(haloDir, path);
			if (!existsSync(absolutePath)) throw new Error(`${id}: focused test is missing: ${path}`);
			if (!shellTokenizesPath(testUnit, path) && !shellTokenizesPath(browserFast, path)) {
				throw new Error(`${id}: focused test is not executed by a default release gate: ${path}`);
			}
			const source = readFileSync(absolutePath, 'utf8');
			for (const marker of focusMarkers) {
				if (!source.includes(marker)) {
					throw new Error(`${id}: ${path} is not focused on registered behavior marker ${marker}`);
				}
			}
		}
	}
	console.log(`✓ HALO risk-weighted test owners: ${risky.length} runtime-bearing release modules`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	checkReleaseTestOwners();
}

// goal: register the default test entry that owns each HALO release surface
// inv: this registry proves ownership and default execution coverage only; behavioral sufficiency belongs to executed tests and promotion results

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const haloDir = resolve(workspaceDir, 'apps/extension-halo');
const admissionPath = resolve(haloDir, 'release-admission.json');
const ownersPath = resolve(haloDir, 'release-test-owners.json');
const RISK_SURFACES = new Set(['script-runtime', 'content-runtime', 'background-runtime', 'extension-worker']);

interface AdmissionModule { id?: unknown; surfaces?: unknown }
interface AdmissionDocument { modules?: AdmissionModule[] }

export interface ReleaseTestEntry {
	releasePackagePath: string;
	releaseScript: string;
	coveragePackagePath: string;
	coverageScript: string;
}

export interface ReleaseTestRegistration { path: string; entry: string }
export interface ReleaseTestOwnership {
	entries: Record<string, ReleaseTestEntry>;
	owners: Record<string, ReleaseTestRegistration[]>;
}
interface OwnersDocument { schemaVersion?: unknown; entries?: unknown; owners?: unknown }

function readJson<T>(path: string): T { return JSON.parse(readFileSync(path, 'utf8')) as T; }

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value);
	return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function safeRepositoryPath(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.includes('..')
		|| value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/u.test(value)) {
		throw new Error(`${label} must be a repository-relative path`);
	}
	return value;
}

function readPackageScript(packagePath: string, script: string): string {
	const document = readJson<{ scripts?: Record<string, unknown> }>(resolve(workspaceDir, packagePath));
	const command = document.scripts?.[script];
	if (typeof command !== 'string' || command.length === 0) {
		throw new Error(`${packagePath} has no executable ${script} script`);
	}
	return command;
}

export function packageScriptTokens(command: string): string[] {
	return command.split(/\s+/u).map((token) => token.replace(/^["']|["']$/gu, ''));
}

function validateEntry(id: string, value: unknown): ReleaseTestEntry {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| !hasExactKeys(value as Record<string, unknown>, [
			'releasePackagePath', 'releaseScript', 'coveragePackagePath', 'coverageScript',
		])) throw new Error(`${id}: release test entry is malformed`);
	const raw = value as Record<string, unknown>;
	const entry = {
		releasePackagePath: safeRepositoryPath(raw.releasePackagePath, `${id}: release package`),
		releaseScript: typeof raw.releaseScript === 'string' ? raw.releaseScript : '',
		coveragePackagePath: safeRepositoryPath(raw.coveragePackagePath, `${id}: coverage package`),
		coverageScript: typeof raw.coverageScript === 'string' ? raw.coverageScript : '',
	};
	if (!entry.releaseScript || !entry.coverageScript) throw new Error(`${id}: release test scripts are malformed`);
	const releaseCommand = readPackageScript(entry.releasePackagePath, entry.releaseScript);
	readPackageScript(entry.coveragePackagePath, entry.coverageScript);
	if ((entry.releasePackagePath !== entry.coveragePackagePath || entry.releaseScript !== entry.coverageScript)
		&& !packageScriptTokens(releaseCommand).includes(entry.coverageScript)) {
		throw new Error(`${id}: release script does not invoke its declared coverage script`);
	}
	return entry;
}

function validateRegistration(owner: string, value: unknown, entries: Record<string, ReleaseTestEntry>): ReleaseTestRegistration {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| !hasExactKeys(value as Record<string, unknown>, ['path', 'entry'])) {
		throw new Error(`${owner}: test owner registration must contain only path and entry`);
	}
	const raw = value as Record<string, unknown>;
	const path = safeRepositoryPath(raw.path, `${owner}: test path`);
	if (!path.startsWith('test/') || typeof raw.entry !== 'string' || !entries[raw.entry]) {
		throw new Error(`${owner}: invalid test owner registration`);
	}
	return { path, entry: raw.entry };
}

function highRiskIds(admission: AdmissionDocument): string[] {
	if (!Array.isArray(admission.modules)) throw new Error('HALO release admission has no modules array');
	return admission.modules.flatMap((module) => {
		if (typeof module.id !== 'string' || !Array.isArray(module.surfaces)) return [];
		return module.surfaces.some((surface) => typeof surface === 'string' && RISK_SURFACES.has(surface)) ? [module.id] : [];
	}).sort();
}

export function readReleaseTestOwnership({
	admission = readJson<AdmissionDocument>(admissionPath),
	ownersDocument = readJson<OwnersDocument>(ownersPath),
}: { admission?: AdmissionDocument; ownersDocument?: OwnersDocument } = {}): ReleaseTestOwnership {
	if (ownersDocument.schemaVersion !== 3
		|| !ownersDocument.entries || typeof ownersDocument.entries !== 'object' || Array.isArray(ownersDocument.entries)
		|| !ownersDocument.owners || typeof ownersDocument.owners !== 'object' || Array.isArray(ownersDocument.owners)) {
		throw new Error('HALO release test owners must use schemaVersion 3 with entries and owners objects');
	}
	const entries = Object.fromEntries(Object.entries(ownersDocument.entries as Record<string, unknown>)
		.map(([id, value]) => [id, validateEntry(id, value)]));
	if (Object.keys(entries).length === 0) throw new Error('HALO release test ownership has no default execution entries');
	const admittedIds = new Set((admission.modules ?? []).flatMap((module) => typeof module.id === 'string' ? [module.id] : []));
	const owners: Record<string, ReleaseTestRegistration[]> = {};
	for (const [owner, value] of Object.entries(ownersDocument.owners as Record<string, unknown>)) {
		if (!admittedIds.has(owner)) throw new Error(`${owner}: test owner is not an admitted HALO module`);
		if (!Array.isArray(value) || value.length === 0) throw new Error(`${owner}: test owners must be a non-empty array`);
		const registrations = value.map((registration) => validateRegistration(owner, registration, entries));
		const identities = registrations.map(({ path, entry }) => `${entry}\0${path}`);
		if (new Set(identities).size !== identities.length) throw new Error(`${owner}: test owner registrations contain duplicates`);
		for (const registration of registrations) {
			if (!existsSync(resolve(haloDir, registration.path))) throw new Error(`${owner}: focused test is missing: ${registration.path}`);
			const entry = entries[registration.entry];
			if (!entry) throw new Error(`${owner}: unknown release test entry ${registration.entry}`);
			if (!packageScriptTokens(readPackageScript(entry.coveragePackagePath, entry.coverageScript)).includes(registration.path)) {
				throw new Error(`${owner}: focused test is not executed by declared default entry ${registration.entry}: ${registration.path}`);
			}
		}
		owners[owner] = registrations;
	}
	const missingRiskOwners = highRiskIds(admission).filter((id) => !owners[id]);
	if (missingRiskOwners.length > 0) throw new Error(`HALO risk-test ownership drift: missing=${missingRiskOwners.join(',')}`);
	return { entries, owners };
}

export function releaseTestEntryArgs(entryId: string, ownership = readReleaseTestOwnership()): string[] {
	const entry = ownership.entries[entryId];
	if (!entry) throw new Error(`unknown HALO release test entry: ${entryId}`);
	if (entry.releasePackagePath === 'package.json') return ['run', entry.releaseScript];
	return ['run', '--cwd', dirname(entry.releasePackagePath).replaceAll('\\', '/'), entry.releaseScript];
}

export function releaseTestMaterialPaths(ownership = readReleaseTestOwnership()): string[] {
	const paths = new Set<string>([
		'../bun.lock',
		'apps/extension-halo/release-admission.json',
		'apps/extension-halo/release-test-owners.json',
		'bun.lock',
		'feature-promotion.json',
		'scripts/check-feature-promotion.ts',
		'scripts/check-release-test-owners.ts',
		'scripts/release-halo.ts',
	]);
	for (const entry of Object.values(ownership.entries)) {
		paths.add(entry.releasePackagePath);
		paths.add(entry.coveragePackagePath);
	}
	for (const registrations of Object.values(ownership.owners)) {
		for (const registration of registrations) paths.add(`apps/extension-halo/${registration.path}`);
	}
	return [...paths].sort();
}

export function releaseTestDirtyClosurePaths(ownership = readReleaseTestOwnership()): string[] {
	return [...new Set([
		...releaseTestMaterialPaths(ownership),
		'apps/extension-halo',
		'packages/contracts',
		'packages/nexus-kernel',
		'packages/ui-kit',
	])].sort();
}

export function checkReleaseTestOwners(options: Parameters<typeof readReleaseTestOwnership>[0] = {}): void {
	const ownership = readReleaseTestOwnership(options);
	const registrations = Object.values(ownership.owners).reduce((total, value) => total + value.length, 0);
	console.log(`✓ HALO release test ownership/default execution: ${Object.keys(ownership.owners).length} module(s), ${registrations} registration(s); behavior requires executed result evidence`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) checkReleaseTestOwners();

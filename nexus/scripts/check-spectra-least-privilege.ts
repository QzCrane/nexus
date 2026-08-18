// goal: prove every SPECTRA permission has an explicit least-privilege decision and live code owner
// inv: manifest required/optional grants are exact projections of policy decisions; evidence is source anchored

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = resolve(workspaceDir, 'apps/extension-spectra/public/manifest.json');
const policyPath = resolve(workspaceDir, 'apps/extension-spectra/permission-policy.json');

interface EvidenceOwner {
	path: string;
	marker: string;
}

interface PermissionDecision {
	decision: 'required' | 'optional' | 'optionalization-candidate';
	capability: string;
	evidence: EvidenceOwner[];
	narrowing: string;
	migrationTask?: string;
}

interface PermissionPolicy {
	schemaVersion: 1;
	app: 'spectra';
	permissions: Record<string, PermissionDecision>;
	hostPermissions: Record<string, PermissionDecision>;
}

interface ManifestLike {
	permissions?: unknown;
	optional_permissions?: unknown;
	host_permissions?: unknown;
	optional_host_permissions?: unknown;
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function stringArray(value: unknown, field: string): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
		throw new Error(`SPECTRA ${field} must be an array of strings`);
	}
	if (new Set(value).size !== value.length) throw new Error(`SPECTRA ${field} contains duplicates`);
	return [...value].sort();
}

function canonical(values: readonly string[]): string {
	return [...values].sort().join('\0');
}

function validateDecision(id: string, decision: PermissionDecision): void {
	if (!decision || typeof decision !== 'object') throw new Error(`${id}: policy entry must be an object`);
	if (decision.decision !== 'required'
		&& decision.decision !== 'optional'
		&& decision.decision !== 'optionalization-candidate') {
		throw new Error(`${id}: unknown permission decision ${String(decision.decision)}`);
	}
	for (const [field, value] of [
		['capability', decision.capability],
		['narrowing', decision.narrowing],
	] as const) {
		if (typeof value !== 'string' || value.trim().length < 24) {
			throw new Error(`${id}: ${field} must contain a concrete mechanism/rationale`);
		}
	}
	if (!Array.isArray(decision.evidence) || decision.evidence.length === 0) {
		throw new Error(`${id}: at least one evidence owner is required`);
	}
	for (const evidence of decision.evidence) {
		if (!evidence || typeof evidence.path !== 'string' || typeof evidence.marker !== 'string'
			|| evidence.path.includes('..') || evidence.marker.length === 0) {
			throw new Error(`${id}: malformed evidence owner`);
		}
		const path = resolve(workspaceDir, evidence.path);
		if (!existsSync(path)) throw new Error(`${id}: evidence path does not exist: ${evidence.path}`);
		const source = readFileSync(path, 'utf8');
		if (!source.includes(evidence.marker)) {
			throw new Error(`${id}: ${evidence.path} does not contain runtime marker ${evidence.marker}`);
		}
	}
	if (decision.decision === 'optionalization-candidate') {
		if (decision.migrationTask !== 'LEAST-PRIVILEGE-PROOF') {
			throw new Error(`${id}: optionalization candidate must remain owned by LEAST-PRIVILEGE-PROOF`);
		}
	} else if (decision.migrationTask !== undefined) {
		throw new Error(`${id}: only optionalization candidates may carry a migration task`);
	}
}

function projection(
	decisions: Readonly<Record<string, PermissionDecision>>,
	kind: 'required' | 'optional',
): string[] {
	return Object.entries(decisions).flatMap(([id, decision]) => {
		if (kind === 'required') {
			return decision.decision === 'required' || decision.decision === 'optionalization-candidate' ? [id] : [];
		}
		return decision.decision === 'optional' ? [id] : [];
	}).sort();
}

export function checkSpectraLeastPrivilege({
	manifest = readJson<ManifestLike>(manifestPath),
	policy = readJson<PermissionPolicy>(policyPath),
}: {
	manifest?: ManifestLike;
	policy?: PermissionPolicy;
} = {}): void {
	if (policy.schemaVersion !== 1 || policy.app !== 'spectra') {
		throw new Error('SPECTRA permission policy must use schemaVersion 1 and app=spectra');
	}
	const manifestPermissions = stringArray(manifest.permissions, 'manifest.permissions');
	const manifestOptionalPermissions = stringArray(manifest.optional_permissions, 'manifest.optional_permissions');
	const manifestHosts = stringArray(manifest.host_permissions, 'manifest.host_permissions');
	const manifestOptionalHosts = stringArray(manifest.optional_host_permissions, 'manifest.optional_host_permissions');
	const requiredPermissions = projection(policy.permissions, 'required');
	const optionalPermissions = projection(policy.permissions, 'optional');
	const requiredHosts = projection(policy.hostPermissions, 'required');
	const optionalHosts = projection(policy.hostPermissions, 'optional');
	if (canonical(manifestPermissions) !== canonical(requiredPermissions)) {
		throw new Error(`SPECTRA required permission policy drift: manifest=${manifestPermissions.join(',')} policy=${requiredPermissions.join(',')}`);
	}
	if (canonical(manifestOptionalPermissions) !== canonical(optionalPermissions)) {
		throw new Error(`SPECTRA optional permission policy drift: manifest=${manifestOptionalPermissions.join(',')} policy=${optionalPermissions.join(',')}`);
	}
	if (canonical(manifestHosts) !== canonical(requiredHosts)) {
		throw new Error(`SPECTRA required host policy drift: manifest=${manifestHosts.join(',')} policy=${requiredHosts.join(',')}`);
	}
	if (canonical(manifestOptionalHosts) !== canonical(optionalHosts)) {
		throw new Error(`SPECTRA optional host policy drift: manifest=${manifestOptionalHosts.join(',')} policy=${optionalHosts.join(',')}`);
	}
	for (const [id, decision] of Object.entries(policy.permissions)) validateDecision(id, decision);
	for (const [id, decision] of Object.entries(policy.hostPermissions)) validateDecision(`host:${id}`, decision);
	console.log(`✓ SPECTRA least-privilege policy: required=${requiredPermissions.length}, optional=${optionalPermissions.length}, hosts=${requiredHosts.length + optionalHosts.length}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	checkSpectraLeastPrivilege();
}

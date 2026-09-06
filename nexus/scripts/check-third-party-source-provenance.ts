// goal: make release-admitted non-npm third-party source provenance fail-closed
// inv: a source marker is only a discovery hint; shipping requires exact upstream/license/notice ownership

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const policyPath = resolve(workspaceDir, 'third-party-source-policy.json');
const haloAdmissionPath = resolve(workspaceDir, 'apps/extension-halo/release-admission.json');
const SOURCE_MARKER = /(?:^|\n)\s*\/\/\s*(?:Source|Based on|Upstream):\s*([^\n]+)\s*/giu;
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SPDX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.+-]*(?:\s+(?:AND|OR)\s+[A-Za-z0-9][A-Za-z0-9.+-]*)*$/u;

interface UpstreamFile {
	path?: unknown;
	blobSha?: unknown;
}

interface PolicyEntry {
	product?: unknown;
	moduleId?: unknown;
	localPath?: unknown;
	relationship?: unknown;
	sourceMarker?: unknown;
	upstream?: unknown;
	modifications?: unknown;
	noticePath?: unknown;
	verifiedAt?: unknown;
}

interface PolicyDocument {
	schemaVersion?: unknown;
	policy?: unknown;
	entries?: unknown;
}

interface AdmissionModule {
	id?: unknown;
	surfaces?: unknown;
}

interface AdmissionDocument {
	modules?: unknown;
}

export interface ThirdPartySourceIssue {
	code: string;
	message: string;
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectedScriptPaths(moduleId: string): string[] {
	return [
		`apps/extension-halo/src/scripts/${moduleId}/script.ts`,
		`apps/extension-halo/src/scripts/${moduleId}/script.js`,
		`apps/extension-halo/src/tools/${moduleId}/script.ts`,
		`apps/extension-halo/src/tools/${moduleId}/script.js`,
	];
}

function readSourceMarkers(path: string): string[] {
	const source = readFileSync(resolve(workspaceDir, path), 'utf8');
	return [...source.matchAll(SOURCE_MARKER)].map((match) => match[1]?.trim() ?? '').filter(Boolean);
}

function validateEntry(entry: PolicyEntry, issues: ThirdPartySourceIssue[]): void {
	if (entry.product !== 'halo') {
		issues.push({ code: 'product-invalid', message: 'third-party source entry product must currently be halo' });
		return;
	}
	if (typeof entry.moduleId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.moduleId)) {
		issues.push({ code: 'module-invalid', message: 'third-party source entry moduleId is invalid' });
		return;
	}
	if (typeof entry.localPath !== 'string'
		|| !expectedScriptPaths(entry.moduleId).includes(entry.localPath)
		|| !existsSync(resolve(workspaceDir, entry.localPath))) {
		issues.push({ code: 'local-path-invalid', message: `${entry.moduleId}: local source path is missing or not the admitted module script` });
		return;
	}
	if (entry.relationship !== 'derived-reimplementation'
		&& entry.relationship !== 'modified-copy'
		&& entry.relationship !== 'vendored') {
		issues.push({ code: 'relationship-invalid', message: `${entry.moduleId}: relationship must describe redistributed/derived code` });
	}
	if (typeof entry.sourceMarker !== 'string' || entry.sourceMarker.trim().length < 8) {
		issues.push({ code: 'marker-invalid', message: `${entry.moduleId}: sourceMarker is missing` });
	} else if (!readFileSync(resolve(workspaceDir, entry.localPath), 'utf8').includes(entry.sourceMarker)) {
		issues.push({ code: 'marker-drift', message: `${entry.moduleId}: local source no longer contains its provenance marker` });
	}
	if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(entry.verifiedAt ?? ''))) {
		issues.push({ code: 'verification-date-invalid', message: `${entry.moduleId}: verifiedAt must be an ISO date` });
	}
	if (!Array.isArray(entry.modifications) || entry.modifications.length < 2
		|| entry.modifications.some((item) => typeof item !== 'string' || item.trim().length < 40)) {
		issues.push({ code: 'modifications-weak', message: `${entry.moduleId}: modification rationale is incomplete` });
	}

	if (!isRecord(entry.upstream)) {
		issues.push({ code: 'upstream-invalid', message: `${entry.moduleId}: upstream is missing` });
		return;
	}
	const repository = entry.upstream.repository;
	const commit = entry.upstream.commit;
	const files = entry.upstream.files;
	const license = entry.upstream.license;
	if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
		issues.push({ code: 'upstream-repository-invalid', message: `${entry.moduleId}: upstream repository is not owner/name` });
	}
	if (typeof commit !== 'string' || !SHA_PATTERN.test(commit)) {
		issues.push({ code: 'upstream-commit-invalid', message: `${entry.moduleId}: upstream commit must be an exact SHA` });
	}
	if (!Array.isArray(files) || files.length === 0) {
		issues.push({ code: 'upstream-files-missing', message: `${entry.moduleId}: reviewed upstream files are missing` });
	} else {
		const paths = new Set<string>();
		for (const raw of files as UpstreamFile[]) {
			if (typeof raw.path !== 'string' || !raw.path || raw.path.startsWith('/') || raw.path.includes('..')
				|| typeof raw.blobSha !== 'string' || !SHA_PATTERN.test(raw.blobSha)) {
				issues.push({ code: 'upstream-file-invalid', message: `${entry.moduleId}: upstream file requires safe path + exact blob SHA` });
				continue;
			}
			if (paths.has(raw.path)) issues.push({ code: 'upstream-file-duplicate', message: `${entry.moduleId}: duplicate upstream path ${raw.path}` });
			paths.add(raw.path);
		}
	}
	if (!isRecord(license)
		|| typeof license.spdx !== 'string' || !SPDX_PATTERN.test(license.spdx)
		|| typeof license.path !== 'string' || !license.path || license.path.includes('..')
		|| typeof license.blobSha !== 'string' || !SHA_PATTERN.test(license.blobSha)
		|| typeof license.copyright !== 'string' || license.copyright.trim().length < 12) {
		issues.push({ code: 'license-invalid', message: `${entry.moduleId}: upstream license evidence is incomplete` });
	}

	if (typeof entry.noticePath !== 'string' || !entry.noticePath.startsWith('apps/extension-halo/public/')
		|| !existsSync(resolve(workspaceDir, entry.noticePath))) {
		issues.push({ code: 'notice-missing', message: `${entry.moduleId}: shipped third-party notice is missing` });
	} else {
		const notice = readFileSync(resolve(workspaceDir, entry.noticePath), 'utf8');
		for (const expected of [String(repository ?? ''), String(commit ?? ''), String(isRecord(license) ? license.spdx ?? '' : ''), String(isRecord(license) ? license.copyright ?? '' : '')]) {
			if (!expected || !notice.includes(expected)) {
				issues.push({ code: 'notice-drift', message: `${entry.moduleId}: shipped notice does not bind ${expected || '<missing policy fact>'}` });
			}
		}
	}
}

export function analyzeThirdPartySourceProvenance({
	policy = readJson<PolicyDocument>(policyPath),
	admission = readJson<AdmissionDocument>(haloAdmissionPath),
}: {
	policy?: PolicyDocument;
	admission?: AdmissionDocument;
} = {}): ThirdPartySourceIssue[] {
	const issues: ThirdPartySourceIssue[] = [];
	if (policy.schemaVersion !== 1 || typeof policy.policy !== 'string' || policy.policy.trim().length < 120 || !Array.isArray(policy.entries)) {
		return [{ code: 'policy-invalid', message: 'third-party source policy must be schema 1 with a concrete policy and entries array' }];
	}
	if (!Array.isArray(admission.modules)) {
		return [{ code: 'admission-invalid', message: 'HALO release admission modules are missing' }];
	}
	const admittedScripts = new Set<string>();
	for (const raw of admission.modules as AdmissionModule[]) {
		if (typeof raw.id !== 'string' || !Array.isArray(raw.surfaces)) continue;
		if (raw.surfaces.includes('script-runtime')) admittedScripts.add(raw.id);
	}

	const entryByModule = new Map<string, PolicyEntry>();
	const localPaths = new Set<string>();
	for (const entry of policy.entries as PolicyEntry[]) {
		validateEntry(entry, issues);
		if (typeof entry.moduleId !== 'string' || typeof entry.localPath !== 'string') continue;
		if (entryByModule.has(entry.moduleId)) issues.push({ code: 'module-duplicate', message: `${entry.moduleId}: duplicate third-party provenance owner` });
		if (localPaths.has(entry.localPath)) issues.push({ code: 'local-path-duplicate', message: `${entry.localPath}: duplicate third-party provenance path` });
		entryByModule.set(entry.moduleId, entry);
		localPaths.add(entry.localPath);
		if (!admittedScripts.has(entry.moduleId)) {
			issues.push({ code: 'not-release-admitted', message: `${entry.moduleId}: provenance entry is not an admitted script-runtime module` });
		}
	}

	for (const moduleId of admittedScripts) {
		const sourcePaths = expectedScriptPaths(moduleId).filter((path) => existsSync(resolve(workspaceDir, path)));
		for (const path of sourcePaths) {
			const markers = readSourceMarkers(path);
			if (markers.length === 0) continue;
			if (!entryByModule.has(moduleId)) {
				issues.push({ code: 'unowned-source-marker', message: `${moduleId}: ${path} declares third-party source provenance but has no policy owner` });
			}
		}
	}
	return issues;
}

export function checkThirdPartySourceProvenance(): void {
	const issues = analyzeThirdPartySourceProvenance();
	if (issues.length > 0) throw new Error(`Third-party source provenance failed:\n- ${issues.map(({ code, message }) => `${code}: ${message}`).join('\n- ')}`);
	console.log('✓ Third-party source provenance: every release-admitted source marker has exact upstream/license/notice ownership');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	checkThirdPartySourceProvenance();
}

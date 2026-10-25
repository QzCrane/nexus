// goal: make non-npm source-derived third-party release provenance explicit and fail-closed
// inv: exact upstream commit/license/notice must exist for every declared shipped derived source owner

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const policyPath = resolve(workspaceDir, 'source-derived-third-party.json');

interface SourceDerivedEntry {
	product: 'halo' | 'spectra';
	id: string;
	localPath: string;
	localMarker: string;
	releaseEntry: string;
	upstreamRepository: string;
	upstreamCommit: string;
	upstreamFiles: string[];
	licenseExpression: string;
	noticePath: string;
	noticeMarkers: string[];
}

interface SourceDerivedPolicy {
	schemaVersion: 1;
	policy: string;
	entries: SourceDerivedEntry[];
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function safeRelative(value: string): boolean {
	return value.length > 0
		&& !value.startsWith('/')
		&& !value.includes('\\')
		&& value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function assertPathUnderProduct(entry: SourceDerivedEntry, path: string, owner: string): void {
	const prefix = `apps/extension-${entry.product}/`;
	if (!path.startsWith(prefix) || !safeRelative(path)) {
		throw new Error(`${entry.id}: ${owner} must stay inside ${prefix}`);
	}
}

function haloReleaseScriptIds(): Set<string> {
	const runtime = readJson<unknown>(resolve(workspaceDir, 'apps/extension-halo/public/script-plugin-runtime.json'));
	if (!Array.isArray(runtime)) throw new Error('HALO script-plugin-runtime.json must be an array');
	return new Set(runtime.map((value) => {
		if (!value || typeof value !== 'object' || Array.isArray(value)
			|| typeof (value as { id?: unknown }).id !== 'string') {
			throw new Error('HALO script-plugin-runtime.json contains malformed descriptor');
		}
		return (value as { id: string }).id;
	}));
}

export function checkSourceDerivedThirdParty(
	policy: SourceDerivedPolicy = readJson<SourceDerivedPolicy>(policyPath),
): void {
	if (policy.schemaVersion !== 1 || policy.policy.trim().length < 100) {
		throw new Error('source-derived third-party policy is incomplete');
	}
	if (!Array.isArray(policy.entries)) throw new Error('source-derived third-party entries must be an array');
	const haloRuntimeIds = haloReleaseScriptIds();
	const seen = new Set<string>();
	let previous = '';
	for (const entry of policy.entries) {
		const key = `${entry.product}:${entry.id}`;
		if (!/^[a-z0-9][a-z0-9-]*$/u.test(entry.id)) throw new Error(`${key}: invalid source-derived owner id`);
		if (seen.has(key)) throw new Error(`duplicate source-derived owner ${key}`);
		if (previous && previous.localeCompare(key) > 0) throw new Error('source-derived entries must be sorted by product:id');
		seen.add(key);
		previous = key;
		assertPathUnderProduct(entry, entry.localPath, 'localPath');
		assertPathUnderProduct(entry, entry.noticePath, 'noticePath');
		if (!entry.noticePath.startsWith(`apps/extension-${entry.product}/public/`)) {
			throw new Error(`${key}: noticePath must live under apps/extension-${entry.product}/public/ so the build copies it into the release`);
		}
		if (!safeRelative(entry.releaseEntry)) throw new Error(`${key}: releaseEntry must be a safe relative path`);
		if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(entry.upstreamRepository)) {
			throw new Error(`${key}: upstreamRepository must be a canonical GitHub repository URL`);
		}
		if (!/^[a-f0-9]{40}$/u.test(entry.upstreamCommit)) throw new Error(`${key}: upstreamCommit must be an exact commit SHA`);
		if (!entry.licenseExpression.trim() || entry.licenseExpression.length > 128) {
			throw new Error(`${key}: licenseExpression is invalid`);
		}
		if (!Array.isArray(entry.upstreamFiles) || entry.upstreamFiles.length === 0
			|| new Set(entry.upstreamFiles).size !== entry.upstreamFiles.length
			|| entry.upstreamFiles.some((path) => !safeRelative(path))) {
			throw new Error(`${key}: upstreamFiles must be unique safe relative paths`);
		}
		if (!Array.isArray(entry.noticeMarkers) || entry.noticeMarkers.length < 3
			|| new Set(entry.noticeMarkers).size !== entry.noticeMarkers.length) {
			throw new Error(`${key}: noticeMarkers are incomplete or duplicated`);
		}

		const local = resolve(workspaceDir, entry.localPath);
		const notice = resolve(workspaceDir, entry.noticePath);
		if (!existsSync(local) || !existsSync(notice)) throw new Error(`${key}: local source or shipped notice is missing`);
		const localText = readFileSync(local, 'utf8');
		if (!entry.localMarker.trim() || !localText.includes(entry.localMarker)) {
			throw new Error(`${key}: local source provenance marker is stale`);
		}
		const noticeText = readFileSync(notice, 'utf8');
		for (const marker of [
			entry.upstreamRepository.replace('https://github.com/', ''),
			entry.upstreamCommit,
			entry.licenseExpression,
			...entry.noticeMarkers,
		]) {
			if (!marker.trim() || !noticeText.includes(marker)) throw new Error(`${key}: shipped notice is missing ${JSON.stringify(marker)}`);
		}

		if (entry.product === 'halo') {
			if (!haloRuntimeIds.has(entry.id)) throw new Error(`${key}: declared derived source is not in the admitted script runtime projection`);
			if (entry.releaseEntry !== `scripts/${entry.id}/script.js`) {
				throw new Error(`${key}: HALO derived script releaseEntry must match generated SaaT output`);
			}
		}
	}
	console.log(`✓ Source-derived third-party provenance: ${policy.entries.length} exact owner(s)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	checkSourceDerivedThirdParty();
}

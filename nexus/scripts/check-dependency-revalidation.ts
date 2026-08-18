// goal: bind the checked-in upstream dependency revalidation snapshot to the exact current package/lock state
// inv: online freshness observation is explicit evidence; deterministic governance never reaches the network

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const policyPath = resolve(workspaceDir, 'dependency-revalidation.json');
const lockPath = resolve(workspaceDir, 'bun.lock');

interface RevalidationEntry {
	dependency: string;
	packagePaths: string[];
	lockedVersion: string;
	observedLatest: string;
	source: string;
	lane: string;
	risk: 'medium' | 'high' | 'epoch';
	reason: string;
}

interface RevalidationPolicy {
	schemaVersion: 1;
	observedAt: string;
	policy: string;
	entries: RevalidationEntry[];
}

interface PackageDocument {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
}

const REQUIRED_DEPENDENCIES = [
	'@biomejs/biome',
	'@playwright/test',
	'darkreader',
	'esbuild',
	'jose',
	'pinyin-pro',
	'playwright',
	'terser',
	'turbo',
	'typescript',
] as const;

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function dependencyValue(document: PackageDocument, dependency: string): string | undefined {
	return document.dependencies?.[dependency]
		?? document.devDependencies?.[dependency]
		?? document.peerDependencies?.[dependency];
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function lockedPackageVersion(lockText: string, dependency: string): string | null {
	const escaped = escapeRegExp(dependency);
	const match = new RegExp(`"${escaped}"\\s*:\\s*\\["${escaped}@([^"\\]]+)"`, 'u').exec(lockText);
	return match?.[1] ?? null;
}

function validSemver(value: string): boolean {
	return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(value);
}

export function checkDependencyRevalidation({
	policy = readJson<RevalidationPolicy>(policyPath),
}: {
	policy?: RevalidationPolicy;
} = {}): void {
	if (policy.schemaVersion !== 1 || !/^\d{4}-\d{2}-\d{2}$/u.test(policy.observedAt)) {
		throw new Error('Dependency revalidation must use schemaVersion 1 and an ISO observation date');
	}
	if (policy.policy.trim().length < 80) {
		throw new Error('Dependency revalidation policy must preserve the exact-lock replay boundary');
	}
	if (!Array.isArray(policy.entries) || policy.entries.length === 0) {
		throw new Error('Dependency revalidation entries are missing');
	}
	const ids = policy.entries.map(({ dependency }) => dependency);
	if (new Set(ids).size !== ids.length) throw new Error('Dependency revalidation contains duplicate dependencies');
	for (const required of REQUIRED_DEPENDENCIES) {
		if (!ids.includes(required)) throw new Error(`Dependency revalidation omitted required direct dependency ${required}`);
	}

	const lockText = readFileSync(lockPath, 'utf8');
	for (const entry of policy.entries) {
		if (!entry.dependency || !validSemver(entry.lockedVersion) || !validSemver(entry.observedLatest)) {
			throw new Error(`${entry.dependency || '<unknown>'}: revalidation versions must be concrete semver observations`);
		}
		if (!entry.source.startsWith('https://www.npmjs.com/package/')) {
			throw new Error(`${entry.dependency}: upstream observation must point at the canonical npm package page`);
		}
		if (!['medium', 'high', 'epoch'].includes(entry.risk) || entry.reason.trim().length < 40 || entry.lane.trim().length < 4) {
			throw new Error(`${entry.dependency}: migration lane/risk/rationale is incomplete`);
		}
		if (!Array.isArray(entry.packagePaths) || entry.packagePaths.length === 0
			|| new Set(entry.packagePaths).size !== entry.packagePaths.length) {
			throw new Error(`${entry.dependency}: package owners must be a unique non-empty list`);
		}
		for (const packagePath of entry.packagePaths) {
			const absolute = resolve(workspaceDir, packagePath);
			if (!existsSync(absolute)) throw new Error(`${entry.dependency}: package owner is missing: ${packagePath}`);
			const manifest = readJson<PackageDocument>(absolute);
			if (!dependencyValue(manifest, entry.dependency)) {
				throw new Error(`${entry.dependency}: ${packagePath} no longer declares the dependency`);
			}
		}
		const locked = lockedPackageVersion(lockText, entry.dependency);
		if (locked !== entry.lockedVersion) {
			throw new Error(`${entry.dependency}: revalidation lock drifted; snapshot=${entry.lockedVersion}, lock=${locked ?? 'missing'}`);
		}
	}
	console.log(`✓ Dependency revalidation: ${policy.entries.length} observed direct dependencies remain bound to the exact lock`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	checkDependencyRevalidation();
}

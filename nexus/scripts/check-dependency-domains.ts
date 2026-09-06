// goal: make the two Bun resolution universes intentional and independently frozen
// inv: both declared domains exist, share the pinned Bun version and execute in closeout evidence

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const policyPath = resolve(workspaceDir, 'dependency-domains.json');
const closeoutPath = resolve(workspaceDir, 'closeout-policy.json');
const EXPECTED_DOMAIN_IDS = ['repository-governance', 'product-workspace'] as const;

interface DependencyDomain {
	id: string;
	root: string;
	packageJson: string;
	lockfile: string;
	purpose: string;
	frozenInstall: string[];
}

interface DomainPolicy {
	schemaVersion: 1;
	domains: DependencyDomain[];
}

interface PackageDocument {
	packageManager?: unknown;
	workspaces?: unknown;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
}

interface CloseoutPolicy {
	platform?: { lanes?: unknown };
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function commandIdentity(args: readonly string[]): string {
	return args.join('\0');
}

export function checkDependencyDomains({
	policy = readJson<DomainPolicy>(policyPath),
	closeout = readJson<CloseoutPolicy>(closeoutPath),
}: {
	policy?: DomainPolicy;
	closeout?: CloseoutPolicy;
} = {}): void {
	if (policy.schemaVersion !== 1 || !Array.isArray(policy.domains)) {
		throw new Error('dependency domains must use schemaVersion 1 with a domains array');
	}
	const ids = policy.domains.map((domain) => domain.id);
	if (ids.join('\0') !== EXPECTED_DOMAIN_IDS.join('\0')) {
		throw new Error(`dependency domain identities must be exactly ${EXPECTED_DOMAIN_IDS.join(', ')}`);
	}
	const packageManagers = new Set<string>();
	const installIdentities = new Set<string>();
	for (const domain of policy.domains) {
		if (!domain.purpose || domain.purpose.trim().length < 40) {
			throw new Error(`${domain.id}: purpose must explain the isolation mechanism`);
		}
		if (!Array.isArray(domain.frozenInstall) || domain.frozenInstall.length < 2
			|| domain.frozenInstall[0] !== 'install' || !domain.frozenInstall.includes('--frozen-lockfile')) {
			throw new Error(`${domain.id}: frozenInstall must be an exact Bun frozen install command`);
		}
		const packagePath = resolve(workspaceDir, domain.packageJson);
		const lockPath = resolve(workspaceDir, domain.lockfile);
		if (!existsSync(packagePath) || !existsSync(lockPath)) {
			throw new Error(`${domain.id}: package/lock authority is missing`);
		}
		const packageDocument = readJson<PackageDocument>(packagePath);
		if (typeof packageDocument.packageManager !== 'string') {
			throw new Error(`${domain.id}: packageManager must be pinned explicitly`);
		}
		packageManagers.add(packageDocument.packageManager);
		const install = commandIdentity(domain.frozenInstall);
		if (installIdentities.has(install)) throw new Error(`${domain.id}: frozen install command duplicates another domain`);
		installIdentities.add(install);
	}
	const expectedManager = readJson<PackageDocument>(resolve(workspaceDir, 'package.json')).packageManager;
	if (typeof expectedManager !== 'string' || !/^bun@\d+\.\d+\.\d+$/u.test(expectedManager)
		|| packageManagers.size !== 1 || !packageManagers.has(expectedManager)) {
		throw new Error(`dependency domains must share the exact workspace Bun version; found ${[...packageManagers].join(', ')}`);
	}

	const rootPackage = readJson<PackageDocument>(resolve(workspaceDir, '../package.json'));
	if (rootPackage.workspaces !== undefined || rootPackage.dependencies !== undefined) {
		throw new Error('repository-governance domain must not become a product workspace or runtime dependency owner');
	}
	const rootDevDependencies = Object.keys(rootPackage.devDependencies ?? {});
	if (rootDevDependencies.some((name) => name.startsWith('@nexus/'))) {
		throw new Error('repository-governance domain may not depend on @nexus product packages');
	}

	const lanes = closeout.platform?.lanes;
	if (!Array.isArray(lanes)) throw new Error('closeout platform lanes are missing');
	const closeoutLanes = new Set(
		lanes.flatMap((lane) => Array.isArray(lane)
			&& lane.every((part) => typeof part === 'string') ? [commandIdentity(lane as string[])] : []),
	);
	for (const domain of policy.domains) {
		if (!closeoutLanes.has(commandIdentity(domain.frozenInstall))) {
			throw new Error(`${domain.id}: closeout evidence does not execute its frozen dependency universe`);
		}
	}
	console.log('✓ Dependency domains: repository-governance + product-workspace are independently frozen and closeout-owned');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	checkDependencyDomains();
}

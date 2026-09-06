// goal: make exact-lockfile Bun audit authoritative across every executable repository dependency domain
// inv: advisories fail immediately; transport failures retry finitely; repository + product domains both pass before SBOM evidence exists

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSbom } from './generate-sbom.ts';

interface AuditProcessResult {
	status: number | null;
	stdout: string;
	stderr: string;
	error?: Error;
}

export type AuditClassification =
	| { kind: 'PASS' }
	| { kind: 'VULNERABLE'; report: Record<string, unknown>; detail: string }
	| { kind: 'TRANSIENT_FAILURE'; detail: string };

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(workspaceDir);
const MAX_ATTEMPTS = 6;

export const DEPENDENCY_AUDIT_DOMAINS = Object.freeze([
	{ id: 'repository', cwd: repositoryRoot },
	{ id: 'product', cwd: workspaceDir },
] as const);

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function classifyAuditResult(result: AuditProcessResult): AuditClassification {
	if (result.error) {
		return { kind: 'TRANSIENT_FAILURE', detail: result.error.message };
	}
	let report: unknown;
	try {
		report = JSON.parse(result.stdout.trim());
	} catch {
		return {
			kind: 'TRANSIENT_FAILURE',
			detail: result.stderr.trim() || result.stdout.trim() || `Bun audit exited ${result.status ?? 'without status'}`,
		};
	}
	if (!isRecord(report)) {
		return { kind: 'TRANSIENT_FAILURE', detail: 'Bun audit returned a non-object JSON report' };
	}
	const vulnerablePackages = Object.keys(report);
	if (vulnerablePackages.length > 0) {
		return {
			kind: 'VULNERABLE',
			report,
			detail: `Bun audit found advisories for: ${vulnerablePackages.sort().join(', ')}`,
		};
	}
	if (result.status !== 0) {
		return {
			kind: 'TRANSIENT_FAILURE',
			detail: result.stderr.trim() || `Bun audit returned an empty report with exit ${result.status ?? 'without status'}`,
		};
	}
	return { kind: 'PASS' };
}

function executeBunAudit(cwd: string): AuditProcessResult {
	const result = spawnSync(process.execPath, ['audit', '--json'], {
		cwd,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
		shell: false,
	});
	return {
		status: result.status,
		stdout: String(result.stdout ?? ''),
		stderr: String(result.stderr ?? ''),
		error: result.error,
	};
}

export async function runDependencyAudit({
	execute = () => executeBunAudit(workspaceDir),
	wait = (milliseconds: number) => Bun.sleep(milliseconds),
	attempts = MAX_ATTEMPTS,
	domain = 'product',
}: {
	execute?: () => AuditProcessResult;
	wait?: (milliseconds: number) => Promise<unknown>;
	attempts?: number;
	domain?: string;
} = {}): Promise<void> {
	if (!Number.isInteger(attempts) || attempts < 1 || attempts > MAX_ATTEMPTS) {
		throw new Error(`dependency audit attempts must be 1..${MAX_ATTEMPTS}`);
	}
	let lastFailure = 'unknown audit transport failure';
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		const classification = classifyAuditResult(execute());
		if (classification.kind === 'PASS') {
			console.log(`✓ Dependency audit [${domain}]: no advisories (attempt ${attempt}/${attempts})`);
			return;
		}
		if (classification.kind === 'VULNERABLE') {
			throw new Error(`[${domain}] ${classification.detail}\n${JSON.stringify(classification.report, null, 2)}`);
		}
		lastFailure = classification.detail;
		if (attempt < attempts) await wait(Math.min(1_000 * 2 ** (attempt - 1), 8_000));
	}
	throw new Error(`Dependency audit [${domain}] infrastructure failed after ${attempts} attempts: ${lastFailure}`);
}

export async function runAllDependencyAudits({
	executeDomain = (_domain: string, cwd: string) => executeBunAudit(cwd),
	wait = (milliseconds: number) => Bun.sleep(milliseconds),
	attempts = MAX_ATTEMPTS,
}: {
	executeDomain?: (domain: string, cwd: string) => AuditProcessResult;
	wait?: (milliseconds: number) => Promise<unknown>;
	attempts?: number;
} = {}): Promise<void> {
	for (const domain of DEPENDENCY_AUDIT_DOMAINS) {
		await runDependencyAudit({
			domain: domain.id,
			execute: () => executeDomain(domain.id, domain.cwd),
			wait,
			attempts,
		});
	}
}

export async function runDependencyAuditWithEvidence(
	auditOptions: Parameters<typeof runDependencyAudit>[0] = {},
	generateEvidence: () => string = generateSbom,
): Promise<string> {
	// Focused tests may inject a single synthetic audit process. Production/release
	// calls provide no execute override and therefore must audit both lock domains.
	if (auditOptions.execute) await runDependencyAudit(auditOptions);
	else await runAllDependencyAudits({ wait: auditOptions.wait, attempts: auditOptions.attempts });
	return generateEvidence();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await runDependencyAuditWithEvidence();
}

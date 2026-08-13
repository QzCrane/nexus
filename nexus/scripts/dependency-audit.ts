// goal: make one exact-lockfile Bun audit authoritative across release lanes
// inv: advisories fail immediately; transport failures retry finitely and never become PASS

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const MAX_ATTEMPTS = 6;

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

export async function runDependencyAudit({
	execute = () => {
		const result = spawnSync(process.execPath, ['audit', '--json'], {
			cwd: workspaceDir,
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
	},
	wait = (milliseconds: number) => Bun.sleep(milliseconds),
	attempts = MAX_ATTEMPTS,
}: {
	execute?: () => AuditProcessResult;
	wait?: (milliseconds: number) => Promise<unknown>;
	attempts?: number;
} = {}): Promise<void> {
	if (!Number.isInteger(attempts) || attempts < 1 || attempts > MAX_ATTEMPTS) {
		throw new Error(`dependency audit attempts must be 1..${MAX_ATTEMPTS}`);
	}
	let lastFailure = 'unknown audit transport failure';
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		const classification = classifyAuditResult(execute());
		if (classification.kind === 'PASS') {
			console.log(`✓ Dependency audit: no advisories (attempt ${attempt}/${attempts})`);
			return;
		}
		if (classification.kind === 'VULNERABLE') {
			throw new Error(`${classification.detail}\n${JSON.stringify(classification.report, null, 2)}`);
		}
		lastFailure = classification.detail;
		if (attempt < attempts) await wait(Math.min(1_000 * 2 ** (attempt - 1), 8_000));
	}
	throw new Error(`Dependency audit infrastructure failed after ${attempts} attempts: ${lastFailure}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await runDependencyAudit();
}

// goal: keep the Architecture Closure Epoch machine-owned instead of relying on prose checklists
// inv: retained tasks cannot disappear; priority, terminal evidence and HALO feature ordering fail closed

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = resolve(workspaceDir, 'architecture-closure.json');

const PRIORITIES = ['P0', 'P1', 'P2'] as const;
const STATUSES = ['queued', 'active', 'blocked', 'done', 'rejected'] as const;
const REQUIRED_TASK_IDS = Object.freeze([
	'SPECTRA-MEDIA-TAB-INVENTORY',
	'HALO-RELEASE-ADMISSION',
	'HALO-EXPLICIT-RELEASE-STAGE',
	'HALO-GENERATED-RESOURCE-SURFACES',
	'BACKLOG-SSOT',
	'ARCHITECTURE-CLOSURE-MANIFEST',
	'CONTINUOUS-GREEN-REPLAY',
	'MINIMUM-CHROME-EVIDENCE',
	'RUNTIME-PERFORMANCE-SLOS',
	'FEATURE-PROMOTION-GATE',
	'DEPENDENCY-DEAD-DIRECTS',
	'DEPENDENCY-LIFECYCLE-POLICY',
	'DEPENDENCY-UPDATE-AUTOMATION',
	'TYPESCRIPT-7-EPOCH',
	'DIRECT-DEPENDENCY-REVALIDATION',
	'LOCK-DOMAIN-AUTHORITY',
	'IMMUTABLE-ACTIONS',
	'SBOM-LICENSE-PROVENANCE',
	'LEAST-PRIVILEGE-PROOF',
	'LOCAL-DIAGNOSTIC-BUNDLE',
	'ACCESSIBILITY-GATE',
	'VISUAL-REGRESSION-GATE',
	'PROPERTY-MUTATION-TESTING',
	'RISK-WEIGHTED-TEST-OWNERSHIP',
	'HALO-GENERATED-CONTENT-ENTRY',
	'HALO-GENERATED-ACTIVE-SERVICES',
	'HALO-BACKGROUND-DEADLINES',
	'HALO-PDF-CLOSURE',
	'HALO-FEATURE-TAIL-AUDIT',
] as const);

interface ClosureTask {
	id: string;
	priority: typeof PRIORITIES[number];
	area: string;
	owner: string;
	status: typeof STATUSES[number];
	acceptance: string[];
	evidence: string[];
	blocker?: string;
	counterEvidence?: string[];
}

interface ClosureManifest {
	schemaVersion: number;
	issue: number;
	branch: string;
	priorityPolicy: {
		order: string[];
		haloFeatureInternals: string;
		rule: string;
	};
	tasks: ClosureTask[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function stringList(value: unknown, field: string, errors: string[], allowEmpty: boolean): string[] | null {
	if (!Array.isArray(value) || value.some((item) => !isNonEmptyString(item))) {
		errors.push(`${field} must be an array of non-empty strings`);
		return null;
	}
	if (!allowEmpty && value.length === 0) errors.push(`${field} must not be empty`);
	if (new Set(value).size !== value.length) errors.push(`${field} contains duplicate entries`);
	return value as string[];
}

export function validateArchitectureClosure(value: unknown): string[] {
	const errors: string[] = [];
	if (!isRecord(value)) return ['architecture closure manifest must be an object'];
	if (value.schemaVersion !== 1) errors.push('schemaVersion must be 1');
	if (value.issue !== 32) errors.push('issue must remain bound to #32 for this epoch');
	if (typeof value.branch !== 'string' || !/^codex\/nexus-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value.branch)) {
		errors.push('branch must name one explicit Nexus execution branch');
	}

	if (!isRecord(value.priorityPolicy)) {
		errors.push('priorityPolicy must be an object');
	} else {
		const order = stringList(value.priorityPolicy.order, 'priorityPolicy.order', errors, false);
		if (order && order.join(',') !== PRIORITIES.join(',')) {
			errors.push('priorityPolicy.order must be exactly P0,P1,P2');
		}
		if (value.priorityPolicy.haloFeatureInternals !== 'P2') {
			errors.push('priorityPolicy.haloFeatureInternals must be P2');
		}
		if (!isNonEmptyString(value.priorityPolicy.rule)) errors.push('priorityPolicy.rule must be non-empty');
	}

	if (!Array.isArray(value.tasks) || value.tasks.length === 0 || value.tasks.length > 200) {
		errors.push('tasks must contain 1..200 items');
		return errors;
	}

	const ids = new Set<string>();
	let previousPriority = -1;
	for (const [index, rawTask] of value.tasks.entries()) {
		const prefix = `tasks[${index}]`;
		if (!isRecord(rawTask)) {
			errors.push(`${prefix} must be an object`);
			continue;
		}
		const id = rawTask.id;
		if (!isNonEmptyString(id) || !/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/u.test(id)) {
			errors.push(`${prefix}.id must be an uppercase stable identifier`);
		} else if (ids.has(id)) {
			errors.push(`duplicate task id ${id}`);
		} else {
			ids.add(id);
		}

		const priority = rawTask.priority;
		const priorityIndex = PRIORITIES.indexOf(priority as typeof PRIORITIES[number]);
		if (priorityIndex < 0) {
			errors.push(`${prefix}.priority must be P0, P1 or P2`);
		} else {
			if (priorityIndex < previousPriority) errors.push(`${prefix}.priority breaks P0 -> P1 -> P2 ordering`);
			previousPriority = Math.max(previousPriority, priorityIndex);
		}

		if (!isNonEmptyString(rawTask.area)) errors.push(`${prefix}.area must be non-empty`);
		if (!isNonEmptyString(rawTask.owner)) errors.push(`${prefix}.owner must be non-empty`);
		if (!STATUSES.includes(rawTask.status as typeof STATUSES[number])) {
			errors.push(`${prefix}.status is invalid`);
		}
		const acceptance = stringList(rawTask.acceptance, `${prefix}.acceptance`, errors, false);
		const evidence = stringList(rawTask.evidence, `${prefix}.evidence`, errors, true);
		void acceptance;

		if (rawTask.area === 'halo-feature' && rawTask.priority !== 'P2') {
			errors.push(`${id || prefix}: individual HALO feature work must remain P2`);
		}
		if (rawTask.status === 'done' && evidence?.length === 0) {
			errors.push(`${id || prefix}: done requires retained evidence`);
		}
		if (rawTask.status === 'blocked' && !isNonEmptyString(rawTask.blocker)) {
			errors.push(`${id || prefix}: blocked requires blocker`);
		}
		if (rawTask.status === 'rejected') {
			const counterEvidence = stringList(
				rawTask.counterEvidence,
				`${prefix}.counterEvidence`,
				errors,
				false,
			);
			if (!counterEvidence?.length) errors.push(`${id || prefix}: rejected requires counter-evidence`);
		}
	}

	for (const requiredId of REQUIRED_TASK_IDS) {
		if (!ids.has(requiredId)) errors.push(`required retained task disappeared: ${requiredId}`);
	}
	if (ids.size !== REQUIRED_TASK_IDS.length) {
		const unexpected = [...ids].filter((id) => !REQUIRED_TASK_IDS.includes(id as typeof REQUIRED_TASK_IDS[number]));
		if (unexpected.length > 0) {
			errors.push(`new task ids must be deliberately added to the checker owner: ${unexpected.join(', ')}`);
		}
	}
	return errors;
}

export function readArchitectureClosureManifest(): ClosureManifest {
	return JSON.parse(readFileSync(manifestPath, 'utf8')) as ClosureManifest;
}

export function checkArchitectureClosure(): void {
	const manifest = readArchitectureClosureManifest();
	const errors = validateArchitectureClosure(manifest);
	if (errors.length > 0) {
		throw new Error(`Architecture closure manifest invalid:\n- ${errors.join('\n- ')}`);
	}
	const counts = new Map<string, number>();
	for (const task of manifest.tasks) counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
	console.log(
		`✓ Architecture closure #${manifest.issue}: ${manifest.tasks.length} retained tasks; `
		+ STATUSES.map((status) => `${status}=${counts.get(status) ?? 0}`).join(', '),
	);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	checkArchitectureClosure();
}

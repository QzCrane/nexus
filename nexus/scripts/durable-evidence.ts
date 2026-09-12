// Durable closeout evidence is stored as one immutable note per candidate.
// The closeout owner validates product evidence before calling this storage boundary.
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { validateHostedObservation, type HostedEvidence } from './closeout-hosted';

export const DURABLE_CLOSEOUT_NOTES_REF = 'refs/notes/nexus-closeout';
const EMPTY_OID = '0'.repeat(40);
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
const PUBLICATION_ATTEMPTS = 4;
const REQUIRED_PENDING = [
	'atomic-main-promotion',
	'provider-projection-readback',
	'local-settlement',
] as const;

type JsonObject = { [key: string]: JsonValue };
type JsonValue = boolean | number | string | null | JsonObject | JsonValue[];

export interface DurableCandidateIdentity {
	head: string;
	tree: string;
	base: string;
	pr: number;
	headRef: string;
	baseRef: string;
}

export interface DeliverySnapshotV1 {
	authority: 'git-remote-and-github-rest-observation';
	asOf: string;
	refs: {
		main: { ref: string; head: string };
		candidate: { ref: string; head: string };
	};
	pullRequest: {
		number: number;
		state: 'open';
		draft: false;
		head: string;
		base: string;
		headRef: string;
		baseRef: string;
	};
	receipts: Array<{ attempt: number; sha256: string }>;
	hosted: HostedEvidence;
	result: 'VERIFIED_PENDING_PROMOTION';
	pending: typeof REQUIRED_PENDING;
}

export interface DurableCloseoutBundleV1 {
	schemaVersion: 1;
	authority: 'nexus-closeout-durable-evidence';
	repository: string;
	notesRef: typeof DURABLE_CLOSEOUT_NOTES_REF;
	candidate: DurableCandidateIdentity;
	receipts: JsonObject[];
	platform: JsonObject;
	deliverySnapshot: DeliverySnapshotV1;
	bundleSha256: string;
}

export interface FinalDeliveryReadback {
	asOf: string;
	main: { ref: string; head: string; tree: string };
	candidate: { ref: string; head: string | null };
	pullRequest: {
		number: number;
		state: 'open' | 'closed';
		head: string;
		baseRef: string;
		mergedAt: string | null;
		mergeCommitSha: string | null;
	};
	pending: string[];
}

export interface FinalDeliveryProjectionV1 {
	schemaVersion: 1;
	authority: 'nexus-closeout-delivery-projection';
	sourceBundleSha256: string;
	asOf: string;
	candidate: DurableCandidateIdentity;
	refs: FinalDeliveryReadback['main'] & { candidateRef: string; candidateHead: string | null };
	pullRequest: FinalDeliveryReadback['pullRequest'];
	receipts: DeliverySnapshotV1['receipts'];
	hostedRuns: HostedEvidence['runs'];
	result: 'COMPLETE' | 'PENDING';
	pending: string[];
}

interface GitResult {
	status: number;
	stdout: string;
	stderr: string;
}

export type GitRunner = (args: readonly string[], input?: string) => GitResult;

export interface DurableEvidenceGitOptions {
	repositoryDir: string;
	remote?: string;
	runGit?: GitRunner;
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function assertKeys(value: object, expected: readonly string[], label: string): void {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	if (canonical(actual) !== canonical(wanted)) throw new Error(`${label} keys are invalid`);
}

function assertTimestamp(value: unknown, label: string): asserts value is string {
	if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))
		|| new Date(value).toISOString() !== value) throw new Error(`${label} is invalid`);
}

function assertJson(value: unknown, label: string): asserts value is JsonValue {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite number`);
		return;
	}
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) assertJson(item, `${label}[${index}]`);
		return;
	}
	if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
		for (const [key, item] of Object.entries(value)) assertJson(item, `${label}.${key}`);
		return;
	}
	throw new Error(`${label} is not canonical JSON`);
}

function assertRef(value: unknown, label: string): asserts value is string {
	if (typeof value !== 'string' || !value.startsWith('refs/heads/') || value.includes('..') || /[\s~^:?*[\\]/u.test(value)) {
		throw new Error(`${label} is invalid`);
	}
}

function assertReceipt(receipt: JsonObject, attempt: number, candidate: DurableCandidateIdentity): void {
	if (receipt.schemaVersion !== 1 || receipt.attempt !== attempt
		|| receipt.head !== candidate.head || receipt.tree !== candidate.tree || receipt.base !== candidate.base
		|| typeof receipt.receiptSha256 !== 'string' || !SHA256_PATTERN.test(receipt.receiptSha256)) {
		throw new Error(`durable receipt attempt ${attempt} has invalid identity`);
	}
	const { receiptSha256, ...body } = receipt;
	if (sha256(canonical(body)) !== receiptSha256) throw new Error(`durable receipt attempt ${attempt} digest mismatch`);
}

function assertHosted(hosted: HostedEvidence, candidate: DurableCandidateIdentity): void {
	validateHostedObservation(hosted, candidate);
}

export function validateDurableCloseoutBundle(
	bundle: DurableCloseoutBundleV1,
	expected?: DurableCandidateIdentity,
): void {
	assertJson(bundle, 'durable closeout bundle');
	assertKeys(bundle, [
		'schemaVersion', 'authority', 'repository', 'notesRef', 'candidate', 'receipts',
		'platform', 'deliverySnapshot', 'bundleSha256',
	], 'durable closeout bundle');
	if (bundle.schemaVersion !== 1 || bundle.authority !== 'nexus-closeout-durable-evidence'
		|| !REPOSITORY_PATTERN.test(bundle.repository) || bundle.notesRef !== DURABLE_CLOSEOUT_NOTES_REF) {
		throw new Error('durable closeout bundle identity is invalid');
	}
	const candidate = bundle.candidate;
	assertKeys(candidate, ['head', 'tree', 'base', 'pr', 'headRef', 'baseRef'], 'candidate identity');
	if (![candidate.head, candidate.tree, candidate.base].every((value) => SHA_PATTERN.test(value))
		|| !Number.isSafeInteger(candidate.pr) || candidate.pr < 1) throw new Error('candidate identity is invalid');
	assertRef(candidate.headRef, 'candidate head ref');
	assertRef(candidate.baseRef, 'candidate base ref');
	if (candidate.headRef === candidate.baseRef) throw new Error('candidate and base refs must differ');
	if (expected && canonical(candidate) !== canonical(expected)) throw new Error('durable candidate differs from expected identity');
	if (!Array.isArray(bundle.receipts) || bundle.receipts.length !== 2) throw new Error('durable evidence requires two receipts');
	for (const [index, receipt] of bundle.receipts.entries()) assertReceipt(receipt, index + 1, candidate);
	if (!bundle.platform || typeof bundle.platform !== 'object'
		|| bundle.platform.head !== candidate.head || bundle.platform.tree !== candidate.tree
		|| typeof bundle.platform.evidenceSha256 !== 'string' || !SHA256_PATTERN.test(bundle.platform.evidenceSha256)) {
		throw new Error('durable platform evidence identity is invalid');
	}
	const { evidenceSha256, ...platformBody } = bundle.platform;
	if (sha256(canonical(platformBody)) !== evidenceSha256) throw new Error('durable platform evidence digest mismatch');
	if (canonical(bundle.receipts[0]?.platform) !== canonical(bundle.platform)
		|| canonical(bundle.receipts[1]?.platform) !== canonical(bundle.platform)) {
		throw new Error('durable platform evidence differs from receipt snapshots');
	}
	const snapshot = bundle.deliverySnapshot;
	assertKeys(snapshot, ['authority', 'asOf', 'refs', 'pullRequest', 'receipts', 'hosted', 'result', 'pending'], 'delivery snapshot');
	assertTimestamp(snapshot.asOf, 'delivery snapshot asOf');
	if (snapshot.authority !== 'git-remote-and-github-rest-observation'
		|| snapshot.result !== 'VERIFIED_PENDING_PROMOTION' || canonical(snapshot.pending) !== canonical(REQUIRED_PENDING)) {
		throw new Error('delivery snapshot state is invalid');
	}
	assertKeys(snapshot.refs, ['main', 'candidate'], 'delivery refs');
	assertKeys(snapshot.refs.main, ['ref', 'head'], 'delivery main ref');
	assertKeys(snapshot.refs.candidate, ['ref', 'head'], 'delivery candidate ref');
	if (snapshot.refs.main.ref !== candidate.baseRef || snapshot.refs.main.head !== candidate.base
		|| snapshot.refs.candidate.ref !== candidate.headRef || snapshot.refs.candidate.head !== candidate.head) {
		throw new Error('delivery refs are not at the verified pre-promotion boundary');
	}
	assertKeys(snapshot.pullRequest, ['number', 'state', 'draft', 'head', 'base', 'headRef', 'baseRef'], 'delivery pull request');
	if (snapshot.pullRequest.number !== candidate.pr || snapshot.pullRequest.state !== 'open' || snapshot.pullRequest.draft !== false
		|| snapshot.pullRequest.head !== candidate.head || snapshot.pullRequest.base !== candidate.base
		|| snapshot.pullRequest.headRef !== candidate.headRef || snapshot.pullRequest.baseRef !== candidate.baseRef) {
		throw new Error('delivery pull request is not the ready exact candidate');
	}
	const receiptProjection = bundle.receipts.map((receipt) => ({ attempt: Number(receipt.attempt), sha256: String(receipt.receiptSha256) }));
	if (canonical(snapshot.receipts) !== canonical(receiptProjection)) throw new Error('delivery receipt projection differs from full receipts');
	assertHosted(snapshot.hosted, candidate);
	const { bundleSha256, ...body } = bundle;
	if (!SHA256_PATTERN.test(bundleSha256) || sha256(canonical(body)) !== bundleSha256) {
		throw new Error('durable closeout bundle digest mismatch');
	}
}

export function createDurableCloseoutBundle(input: {
	repository: string;
	candidate: DurableCandidateIdentity;
	receipts: unknown[];
	platform: unknown;
	deliverySnapshot: DeliverySnapshotV1;
}): DurableCloseoutBundleV1 {
	assertJson(input.receipts, 'closeout receipts');
	assertJson(input.platform, 'platform evidence');
	const body = {
		schemaVersion: 1 as const,
		authority: 'nexus-closeout-durable-evidence' as const,
		repository: input.repository,
		notesRef: DURABLE_CLOSEOUT_NOTES_REF,
		candidate: input.candidate,
		receipts: input.receipts as JsonObject[],
		platform: input.platform as JsonObject,
		deliverySnapshot: input.deliverySnapshot,
	};
	const bundle = { ...body, bundleSha256: sha256(canonical(body)) };
	validateDurableCloseoutBundle(bundle);
	return bundle;
}

export function serializeDurableCloseoutBundle(bundle: DurableCloseoutBundleV1): string {
	validateDurableCloseoutBundle(bundle);
	const value = `${canonical(bundle)}\n`;
	if (Buffer.byteLength(value) > MAX_BUNDLE_BYTES) throw new Error('durable closeout bundle exceeds the size limit');
	return value;
}

export function parseDurableCloseoutBundle(value: string, expected?: DurableCandidateIdentity): DurableCloseoutBundleV1 {
	if (Buffer.byteLength(value) > MAX_BUNDLE_BYTES) throw new Error('durable closeout bundle exceeds the size limit');
	let bundle: DurableCloseoutBundleV1;
	try { bundle = JSON.parse(value) as DurableCloseoutBundleV1; }
	catch { throw new Error('durable closeout bundle is not valid JSON'); }
	validateDurableCloseoutBundle(bundle, expected);
	return bundle;
}

function defaultGitRunner(repositoryDir: string): GitRunner {
	return (args, input) => {
		const result = spawnSync('git', [...args], {
			cwd: repositoryDir,
			encoding: 'utf8',
			input,
			shell: false,
			timeout: 120_000,
		});
		if (result.error) throw result.error;
		return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
	};
}

function requireGit(result: GitResult, label: string): string {
	if (result.status !== 0) throw new Error(`${label}: ${result.stderr.trim() || `exit ${result.status}`}`);
	return result.stdout;
}

function remoteNotesOid(runGit: GitRunner, remote: string): string | null {
	const output = requireGit(runGit(['ls-remote', '--refs', remote, DURABLE_CLOSEOUT_NOTES_REF]), 'remote notes read');
	const lines = output.trim() ? output.trim().split(/\r?\n/u) : [];
	if (lines.length === 0) return null;
	if (lines.length !== 1) throw new Error('remote notes ref is ambiguous');
	const [oid, ref, ...rest] = lines[0].split(/\s+/u);
	if (rest.length || ref !== DURABLE_CLOSEOUT_NOTES_REF || !oid || !SHA_PATTERN.test(oid)) {
		throw new Error('remote notes ref identity is invalid');
	}
	return oid;
}

function deleteTemporaryRef(runGit: GitRunner, ref: string): void {
	const result = runGit(['update-ref', '-d', ref]);
	if (result.status !== 0) throw new Error(`temporary notes ref cleanup failed: ${result.stderr.trim()}`);
}

function readNoteAtRemoteTip(
	head: string,
	options: DurableEvidenceGitOptions,
): { value: string | null; remoteNotesOid: string | null } {
	if (!SHA_PATTERN.test(head)) throw new Error('durable note read requires an exact candidate SHA');
	const remote = options.remote ?? 'origin';
	const runGit = options.runGit ?? defaultGitRunner(options.repositoryDir);
	const oid = remoteNotesOid(runGit, remote);
	if (!oid) return { value: null, remoteNotesOid: null };
	const temporaryRef = `refs/notes/nexus-closeout-read/${randomUUID()}`;
	try {
		requireGit(runGit(['fetch', '--quiet', '--force', remote, `${DURABLE_CLOSEOUT_NOTES_REF}:${temporaryRef}`]), 'remote notes fetch');
		const note = runGit(['notes', `--ref=${temporaryRef}`, 'show', head]);
		if (note.status !== 0) {
			if (note.status === 1) return { value: null, remoteNotesOid: oid };
			throw new Error(`remote note read failed: ${note.stderr.trim()}`);
		}
		return { value: note.stdout, remoteNotesOid: oid };
	} finally {
		deleteTemporaryRef(runGit, temporaryRef);
	}
}

export function readRemoteDurableCloseoutEvidence(
	head: string,
	options: DurableEvidenceGitOptions,
): { bundle: DurableCloseoutBundleV1 | null; remoteNotesOid: string | null } {
	const result = readNoteAtRemoteTip(head, options);
	const bundle = result.value === null ? null : parseDurableCloseoutBundle(result.value);
	if (bundle && bundle.candidate.head !== head) throw new Error('remote durable note is stored under a different candidate');
	return {
		bundle,
		remoteNotesOid: result.remoteNotesOid,
	};
}

export function publishDurableCloseoutEvidence(
	bundle: DurableCloseoutBundleV1,
	options: DurableEvidenceGitOptions,
): { status: 'created' | 'existing'; remoteNotesOid: string; bundleSha256: string } {
	const serialized = serializeDurableCloseoutBundle(bundle);
	const remote = options.remote ?? 'origin';
	const runGit = options.runGit ?? defaultGitRunner(options.repositoryDir);
	for (let attempt = 1; attempt <= PUBLICATION_ATTEMPTS; attempt += 1) {
		const before = readNoteAtRemoteTip(bundle.candidate.head, { ...options, remote, runGit });
		if (before.value !== null) {
			const existing = parseDurableCloseoutBundle(before.value, bundle.candidate);
			if (serializeDurableCloseoutBundle(existing) !== serialized) throw new Error('candidate already has different durable closeout evidence');
			if (!before.remoteNotesOid) throw new Error('existing durable evidence has no remote notes identity');
			return { status: 'existing', remoteNotesOid: before.remoteNotesOid, bundleSha256: bundle.bundleSha256 };
		}
		const expectedOld = before.remoteNotesOid ?? EMPTY_OID;
		const temporaryRef = `refs/notes/nexus-closeout-write/${randomUUID()}`;
		try {
			if (before.remoteNotesOid) {
				requireGit(runGit(['fetch', '--quiet', '--force', remote, `${DURABLE_CLOSEOUT_NOTES_REF}:${temporaryRef}`]), 'remote notes fetch');
			}
			requireGit(runGit(['notes', `--ref=${temporaryRef}`, 'add', '-F', '-', bundle.candidate.head], serialized), 'durable note creation');
			const push = runGit([
				'push', '--porcelain', `--force-with-lease=${DURABLE_CLOSEOUT_NOTES_REF}:${expectedOld}`,
				remote, `${temporaryRef}:${DURABLE_CLOSEOUT_NOTES_REF}`,
			]);
			const after = readNoteAtRemoteTip(bundle.candidate.head, { ...options, remote, runGit });
			if (after.value !== null) {
				const published = parseDurableCloseoutBundle(after.value, bundle.candidate);
				if (serializeDurableCloseoutBundle(published) !== serialized) throw new Error('remote durable evidence conflicts with this candidate');
				if (!after.remoteNotesOid) throw new Error('published durable evidence has no remote notes identity');
				return { status: 'created', remoteNotesOid: after.remoteNotesOid, bundleSha256: bundle.bundleSha256 };
			}
			if (after.remoteNotesOid === before.remoteNotesOid) {
				throw new Error(`durable evidence push failed: ${push.stderr.trim() || `exit ${push.status}`}`);
			}
		} finally {
			deleteTemporaryRef(runGit, temporaryRef);
		}
		if (attempt === PUBLICATION_ATTEMPTS) throw new Error('durable evidence CAS did not settle after bounded retries');
	}
	throw new Error('durable evidence publication did not run');
}

export function projectFinalDelivery(
	bundle: DurableCloseoutBundleV1,
	live: FinalDeliveryReadback,
): FinalDeliveryProjectionV1 {
	validateDurableCloseoutBundle(bundle);
	assertTimestamp(live.asOf, 'final delivery asOf');
	const candidate = bundle.candidate;
	if (live.main.ref !== candidate.baseRef || ![candidate.base, candidate.head].includes(live.main.head)
		|| !SHA_PATTERN.test(live.main.tree) || live.candidate.ref !== candidate.headRef
		|| (live.candidate.head !== null && live.candidate.head !== candidate.head)) {
		throw new Error('final delivery refs are inconsistent with the candidate');
	}
	if (live.main.head === candidate.head && live.main.tree !== candidate.tree) throw new Error('promoted main tree differs from the candidate');
	if (live.pullRequest.number !== candidate.pr || live.pullRequest.head !== candidate.head
		|| live.pullRequest.baseRef !== candidate.baseRef) throw new Error('final delivery pull request differs from the candidate');
	if (live.pullRequest.mergedAt !== null) {
		assertTimestamp(live.pullRequest.mergedAt, 'provider mergedAt');
		if (live.pullRequest.state !== 'closed' || live.pullRequest.mergeCommitSha !== candidate.head) {
			throw new Error('provider merged projection differs from the candidate');
		}
	}
	if (!Array.isArray(live.pending) || live.pending.some((item) => typeof item !== 'string' || !item)) {
		throw new Error('final delivery pending items are invalid');
	}
	const pending = [...live.pending];
	if (live.main.head !== candidate.head) pending.unshift('atomic-main-promotion');
	if (live.candidate.head !== null) pending.push('candidate-ref-deletion');
	if (live.pullRequest.state !== 'closed') pending.push('provider-projection-readback');
	const uniquePending = [...new Set(pending)];
	return {
		schemaVersion: 1,
		authority: 'nexus-closeout-delivery-projection',
		sourceBundleSha256: bundle.bundleSha256,
		asOf: live.asOf,
		candidate,
		refs: { ...live.main, candidateRef: live.candidate.ref, candidateHead: live.candidate.head },
		pullRequest: live.pullRequest,
		receipts: bundle.deliverySnapshot.receipts,
		hostedRuns: bundle.deliverySnapshot.hosted.runs,
		result: uniquePending.length === 0 ? 'COMPLETE' : 'PENDING',
		pending: uniquePending,
	};
}

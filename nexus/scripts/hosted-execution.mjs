// The provider event identifies the intended source; Git identifies what ran.
// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: GitHub invokes this uncached workflow entrypoint directly with provider-owned execution context.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const phase = process.argv[2];
if (phase !== 'start' && phase !== 'end') throw new Error('Hosted execution identity requires an explicit start or end phase');

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const advertisedHead = event.pull_request?.head?.sha ?? process.env.GITHUB_SHA;
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
const parents = execFileSync('git', ['cat-file', '-p', 'HEAD'], { encoding: 'utf8' }).split('\n').filter((line) => line.startsWith('parent ')).map((line) => line.slice(7));
const base = event.pull_request?.base?.sha ?? parents[0];
const verifierPath = fileURLToPath(import.meta.url);
const verifierBytes = readFileSync(verifierPath);
const verifierBlob = execFileSync('git', ['hash-object', '--', verifierPath], { encoding: 'utf8' }).trim();
const verifierSha256 = createHash('sha256').update(verifierBytes).digest('hex');
if (!/^[a-f0-9]{40}$/u.test(advertisedHead ?? '') || commit !== advertisedHead) {
	throw new Error(`Hosted checkout mismatch: advertised=${advertisedHead} executed=${commit}`);
}
if (event.pull_request && (parents.length !== 1 || parents[0] !== base)) {
	throw new Error('Hosted candidate is not based directly on the advertised PR base');
}
console.log(JSON.stringify({
	schemaVersion: 1, authority: 'github-actions-execution',
	phase,
	repository: process.env.GITHUB_REPOSITORY,
	runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
	job: process.env.GITHUB_JOB, os: process.env.RUNNER_OS,
	advertisedHead, executedCommit: commit, executedTree: tree, base,
	verifierBlob, verifierSha256,
}));

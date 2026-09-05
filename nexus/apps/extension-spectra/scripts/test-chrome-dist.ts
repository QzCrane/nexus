// goal: run production Chrome smoke only against a receipt-bound dist
// inv: stale, development, dirty-tree, or modified production output cannot pass

import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	createCandidateReceipt,
	currentCandidateFacts,
	RELEASE_CANDIDATE_RECEIPT_CAPABILITY_ENV,
	RELEASE_CANDIDATE_RECEIPT_PATH_ENV,
	readReleaseTreeIdentity,
	validateCandidateReceipt,
} from '../../../scripts/release-spectra.ts';

const projectDir = resolve(import.meta.dir, '..');
const distDir = resolve(projectDir, 'dist');

function run(command: string, args: string[], env = process.env): void {
	const result = spawnSync(process.execPath, args, {
		cwd: projectDir,
		env,
		stdio: 'inherit',
		shell: false,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		const reason = result.signal ? `signal ${result.signal}` : `exit code ${result.status ?? 'unknown'}`;
		throw new Error(`${command} failed: ${reason}`);
	}
}

let temporaryReceipt: ReturnType<typeof createCandidateReceipt> | undefined;
try {
	let receiptPath = process.env[RELEASE_CANDIDATE_RECEIPT_PATH_ENV];
	let capability = process.env[RELEASE_CANDIDATE_RECEIPT_CAPABILITY_ENV];
	if (!receiptPath || !capability) {
		// Standalone production smoke is still self-contained, but it must first
		// freeze a clean tree and build production output. Release orchestration
		// supplies the receipt after its one production build, so it does not build
		// again in that path.
		readReleaseTreeIdentity();
		run('production build', ['run', 'build:prod']);
		temporaryReceipt = createCandidateReceipt({ distDir });
		receiptPath = temporaryReceipt.receiptPath;
		capability = temporaryReceipt.capability;
	}

	const expectedFacts = currentCandidateFacts(readReleaseTreeIdentity(), distDir);
	validateCandidateReceipt({ receiptPath, capability, expectedFacts });
	run('production Chrome smoke', ['test', 'test/smoke.spec.ts']);

	// The source tree and dist must remain the exact candidate after Chrome has
	// exited. This catches changes made by a test helper or an external process.
	validateCandidateReceipt({
		receiptPath,
		capability,
		expectedFacts: currentCandidateFacts(readReleaseTreeIdentity(), distDir),
	});
} finally {
	if (temporaryReceipt) {
		rmSync(temporaryReceipt.directory, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
	}
}

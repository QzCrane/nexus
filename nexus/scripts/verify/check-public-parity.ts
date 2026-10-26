// goal: keep the published checkout from silently drifting away from this repository
//
// The public repository is what users read and what store review sees. Nothing
// ties it to this one, so the only way it stays honest is a gate that runs here.
//
// A hard "must be identical" rule cannot work: the published tree is a release
// snapshot, and a release is a deliberate act rather than a side effect of a
// commit. So the gate uses a recorded baseline and enforces *direction*:
//
//   - a file that is missing beyond the baseline is an error (drift grew);
//   - a version the baseline does not name is an error (the release moved
//     without anyone updating what "published" means);
//   - content drift may shrink but not grow;
//   - anything that shrank is reported, so the baseline can only tighten.
//
// When the public checkout is absent (CI, a fresh clone) the gate skips: it has
// nothing to compare, and pretending otherwise would either fail every build or
// silently pass.

import fs from 'node:fs';
import path from 'node:path';
import { error, ok, scanDir, section, warn } from './utils.ts';

const APP_PATH = 'apps/extension-spectra';
const PUBLIC_REPO_ENV = 'NEXUS_PUBLIC_REPO';
const PUBLIC_REPO_DEFAULT = 'spectra-public';
const BASELINE_FILE = 'scripts/verify/public-parity-baseline.json';
const REPORTED_SAMPLES = 5;

interface PublicParityBaseline {
	reason: string;
	/** The private version this baseline was recorded against. */
	version: string;
	/** The public version that was accepted while recording it. */
	publishedVersion: string;
	maxDiffering: number;
	knownMissing: string[];
}

function readVersion(file: string): string | null {
	if (!fs.existsSync(file)) return null;
	try {
		const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: unknown };
		return typeof parsed.version === 'string' ? parsed.version : null;
	} catch {
		return null;
	}
}

function readBaseline(root: string): PublicParityBaseline | null {
	const file = path.join(root, BASELINE_FILE);
	if (!fs.existsSync(file)) return null;
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8')) as PublicParityBaseline;
	} catch {
		return null;
	}
}

/** Every shipped TypeScript file, relative to the app root. */
function shippedSources(appRoot: string): string[] {
	const files: string[] = [];
	scanDir(path.join(appRoot, 'src'), (fullPath: string) => {
		if (!fullPath.endsWith('.ts') && !fullPath.endsWith('.tsx')) return;
		if (fullPath.includes('.spec.')) return;
		files.push(path.relative(appRoot, fullPath).replaceAll('\\', '/'));
	});
	return files.sort();
}

export function checkPublicParity(root: string): void {
	section('检查公开发布仓库与当前仓库的一致性...');
	const appRoot = path.join(root, APP_PATH);
	const publicRoot = path.resolve(root, process.env[PUBLIC_REPO_ENV] ?? path.join('..', PUBLIC_REPO_DEFAULT));
	if (!fs.existsSync(publicRoot)) {
		ok(`${PUBLIC_REPO_DEFAULT} is not checked out here; parity gate skipped`);
		return;
	}

	const baseline = readBaseline(root);
	if (!baseline) {
		error(`PUBLIC-PARITY-000: ${BASELINE_FILE} is missing, so no direction is enforced`);
		return;
	}

	const version = readVersion(path.join(appRoot, 'package.json'));
	const publicVersion = readVersion(path.join(publicRoot, APP_PATH, 'package.json'));
	if (!version || !publicVersion) {
		error('PUBLIC-PARITY-001: both checkouts must declare an extension version');
		return;
	}
	// The baseline records a gap, not an equality: the published tree is a release
	// snapshot and this branch is ahead of it. What must hold is that the recorded
	// pair still describes reality — any version movement in either tree means the
	// baseline is stale and has to be re-recorded deliberately.
	if (baseline.version !== version || baseline.publishedVersion !== publicVersion) {
		error(`PUBLIC-PARITY-001: baseline recorded ${baseline.version}/${baseline.publishedVersion} but the trees are ${version}/${publicVersion}`);
	}

	const knownMissing = new Set(baseline.knownMissing);
	const missing: string[] = [];
	const differing: string[] = [];
	for (const relative of shippedSources(appRoot)) {
		const here = path.join(appRoot, relative);
		const there = path.join(publicRoot, APP_PATH, relative);
		if (!fs.existsSync(there)) {
			missing.push(relative);
			continue;
		}
		if (!fs.readFileSync(there).equals(fs.readFileSync(here))) differing.push(relative);
	}

	const grown = missing.filter((relative) => !knownMissing.has(relative));
	if (grown.length > 0) {
		error(`PUBLIC-PARITY-002: ${grown.length} files are missing beyond the baseline (${grown.slice(0, REPORTED_SAMPLES).join(', ')})`);
	}
	if (differing.length > baseline.maxDiffering) {
		error(`PUBLIC-PARITY-003: content drift grew to ${differing.length} files (baseline ${baseline.maxDiffering})`);
	}

	const nowPresent = baseline.knownMissing.filter((relative) => !missing.includes(relative));
	if (nowPresent.length > 0) {
		warn(`PUBLIC-PARITY-004: ${nowPresent.length} previously missing files now exist; lower the baseline`, true);
	}
	if (differing.length < baseline.maxDiffering) {
		warn(`PUBLIC-PARITY-005: content drift shrank to ${differing.length}; lower the baseline`, true);
	}

	if (grown.length === 0 && differing.length <= baseline.maxDiffering) {
		ok(`published tree accepted: ${differing.length} differing, ${missing.length} missing (baseline ${baseline.maxDiffering}/${baseline.knownMissing.length})`);
	}
}

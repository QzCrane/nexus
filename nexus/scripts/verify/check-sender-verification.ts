// goal: a message that cannot prove who sent it must not be acted upon (INV-11)
//
// SP-34 fixed eighteen sender checks and this gate is why that number stayed
// eighteen for exactly one round. Two more were found afterwards, both invisible
// to a text sweep for `sender.id &&`:
//
//   - content/input/hotkey-listener.ts rewrote the live hotkey bindings from a
//     `spectra.hotkeys.changed` event and never looked at the sender at all;
//   - content/core/lifecycle/popup-connection.ts trusted a port *name*, which is
//     a public string, to set `isPopupOpen`.
//
// Both classes are machine-checkable. This gate therefore enforces two rules:
//
//   1. no fail-open form of the comparison anywhere in shipped code;
//   2. every file that registers a message or port listener inside the two
//      authority contexts (Background, Content) must perform a strict comparison
//      in that same file, or be recorded here as delegating it.

import fs from 'node:fs';
import path from 'node:path';
import { error, ok, section, warn } from './utils.ts';

/**
 * Background is the authority and Content runs inside a page the extension does
 * not control. Popup, Options and Offscreen are extension-origin pages, so they
 * are not part of the attack surface this gate describes.
 */
const ENTRY_ROOTS = [
	'apps/extension-spectra/src/background',
	'apps/extension-spectra/src/content',
] as const;

/** Every shipped tree, for the fail-open rule, which admits no exceptions. */
const ALL_ROOTS = [
	...ENTRY_ROOTS,
	'apps/extension-spectra/src/offscreen',
	'apps/extension-spectra/src/popup',
	'apps/extension-spectra/src/remote',
	'apps/extension-spectra/src/shared',
	'packages/contracts/src',
] as const;

const BASELINE_PATH = path.join('scripts', 'verify', 'sender-verification-baseline.json');

const LISTENER = /\b(?:onMessage|onMessageExternal|onConnect)\.addListener\b/u;
const STRICT = /_?sender\??\.id\s*(?:!==|===)/u;
const FAIL_OPEN = /_?sender\??\.id\s*(?:&&|\?)/u;

interface BaselineEntry {
	readonly owner: string;
	readonly reason: string;
}

interface Baseline {
	readonly delegates: Record<string, BaselineEntry>;
}

function listSources(root: string, target: string): string[] {
	const absolute = path.join(root, target);
	if (!fs.existsSync(absolute)) return [];
	if (fs.statSync(absolute).isFile()) return [absolute];
	const found: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === 'node_modules' || entry.name === 'dist') continue;
				walk(full);
				continue;
			}
			if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) continue;
			found.push(full);
		}
	};
	walk(absolute);
	return found;
}

function normalize(file: string): string {
	return file.split(path.sep).join('/');
}

/**
 * A hit inside a comment is not code. The first false positive this rule
 * produced was the comment explaining the rule.
 */
function codeLines(text: string): string[] {
	return text.split('\n').filter((line) => {
		const trimmed = line.trim();
		return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
	});
}

function readBaseline(): Baseline {
	if (!fs.existsSync(BASELINE_PATH)) return { delegates: {} };
	const parsed: unknown = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
	const delegates = (parsed as Baseline).delegates ?? {};
	return { delegates };
}

export function checkSenderVerification(ROOT: string): void {
	section('检查发送方校验（G6 / INV-11）...');

	const baseline = readBaseline();
	let failOpenCount = 0;

	for (const relative of ALL_ROOTS) {
		for (const file of listSources(ROOT, relative)) {
			const rel = normalize(path.relative(ROOT, file));
			codeLines(fs.readFileSync(file, 'utf8')).forEach((line) => {
				if (!FAIL_OPEN.test(line)) return;
				failOpenCount += 1;
				error(`SENDER-001: fail-open sender check in ${rel}: ${line.trim()}`);
			});
		}
	}

	const seen = new Set<string>();
	for (const relative of ENTRY_ROOTS) {
		for (const file of listSources(ROOT, relative)) {
			const rel = normalize(path.relative(ROOT, file));
			const text = fs.readFileSync(file, 'utf8');
			if (!LISTENER.test(text)) continue;
			seen.add(rel);
			if (STRICT.test(text)) continue;
			const delegate = baseline.delegates[rel];
			if (!delegate) {
				error(`SENDER-002: ${rel} registers a listener without a strict sender check`);
				continue;
			}
			if (!delegate.owner.trim() || !delegate.reason.trim()) {
				error(`SENDER-002: ${rel} is recorded as delegating without naming its owner and reason`);
			}
		}
	}

	for (const [rel] of Object.entries(baseline.delegates)) {
		if (seen.has(rel)) continue;
		warn(`SENDER-003: baseline names ${rel}, which no longer registers a listener`, true);
	}

	if (failOpenCount === 0) ok('no fail-open sender comparison in any shipped tree');
	ok(`sender verification checked across ${seen.size} listener hosts`);
}

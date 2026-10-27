// goal: UI presentation must not become a second authority for control state
//
// Two classes of hole are machine-checkable here:
//
//   1. a popup gesture reading `slider.value` to compute the next value. The
//      DOM is presentation; once it feeds arithmetic it is a second source of
//      truth, and a render that has not caught up can silently win.
//   2. a surface painting the Capture color from anything other than the
//      acknowledged active lifecycle. `resolveAudioVolumeState` is the single
//      semantic owner; pure renderers that receive its verdict may be recorded
//      below, but nothing may invent the verdict locally.
//   3. one projection element written from two different modules inside the same
//      surface. Whichever writer runs last wins silently, which is exactly how a
//      bar ends up trailing the thumb it is meant to describe.

import fs from 'node:fs';
import path from 'node:path';
import { error, ok, section, warn } from './utils.ts';

const SOURCE_ROOT = 'apps/extension-spectra/src';
const BASELINE_PATH = path.join('scripts', 'verify', 'ui-authority-baseline.json');

// Matches both `ui.slider.value` and a bare `slider.value`: a local variable is
// the common shape in the side panel, and narrowing this to the property-forming
// member expression let a real DOM readback through unnoticed.
const DOM_READBACK = /\b(?:parseInt|parseFloat|Number)\s*\(\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)*slider\s*\.\s*value/u;
const CAPTURE_COLOR = /\b(?:COLORS|BADGE_COLORS|UI_COLORS)\.CAPTURE\b/u;
const CENTRAL_VERDICT = /\b(?:resolveAudioVolumeState|isActiveCaptureLifecycle)\s*\(/u;
// The card's volume projection: fill width, readout text and native thumb.
const PROJECTION_WRITE = /\b[A-Za-z_$][\w$]*\s*\.\s*(fill\s*\.\s*style\s*\.\s*width|val\s*\.\s*(?:innerText|textContent)|slider\s*\.\s*value)\s*=/u;

interface BaselineEntry {
	readonly owner: string;
	readonly reason: string;
}

interface Baseline {
	readonly captureRenderers: Record<string, BaselineEntry>;
}

function listSources(root: string): string[] {
	const absolute = path.join(root, SOURCE_ROOT);
	const found: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === 'dist' || entry.name === 'node_modules') continue;
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

function codeLines(text: string): string[] {
	return text.split('\n').filter((line) => {
		const trimmed = line.trim();
		return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
	});
}

function readBaseline(): Baseline {
	if (!fs.existsSync(BASELINE_PATH)) return { captureRenderers: {} };
	const parsed: unknown = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
	const captureRenderers = (parsed as Baseline).captureRenderers ?? {};
	return { captureRenderers };
}

export function checkUiAuthority(ROOT: string): void {
	section('检查 UI 状态权威（DOM 读回 / Capture 颜色）...');

	const baseline = readBaseline();
	let domReadbacks = 0;
	const captureRenderers = new Set<string>();
	// `surface -> projection element -> writing modules`. Scoped per surface so
	// the card's volume bar and the side panel's speed slider are not conflated:
	// the invariant is one writer per element *within* a projection surface.
	const projectionWriters = new Map<string, Set<string>>();

	for (const file of listSources(ROOT)) {
		const rel = normalize(path.relative(ROOT, file));
		const lines = codeLines(fs.readFileSync(file, 'utf8'));
		const surface = rel.split('/').slice(2, 4).join('/');

		for (const line of lines) {
			if (DOM_READBACK.test(line)) {
				domReadbacks += 1;
				error(`UI-001: popup state must not be computed from DOM slider value in ${rel}: ${line.trim()}`);
			}
			const projection = PROJECTION_WRITE.exec(line);
			if (projection?.[1]) {
				const target = `${surface}:${projection[1].replace(/\s+/gu, '')}`;
				const writers = projectionWriters.get(target) ?? new Set<string>();
				writers.add(rel);
				projectionWriters.set(target, writers);
			}
			if (!CAPTURE_COLOR.test(line)) continue;
			captureRenderers.add(rel);
			if (CENTRAL_VERDICT.test(lines.join('\n'))) continue;
			const renderer = baseline.captureRenderers[rel];
			if (!renderer) {
				error(`UI-002: ${rel} paints the Capture color without the central lifecycle verdict`);
				continue;
			}
			if (!renderer.owner.trim() || !renderer.reason.trim()) {
				error(`UI-002: ${rel} is recorded as a Capture renderer without an owner and reason`);
			}
		}
	}

	for (const rel of Object.keys(baseline.captureRenderers)) {
		if (captureRenderers.has(rel)) continue;
		warn(`UI-003: baseline names ${rel}, which no longer paints the Capture color`, true);
	}

	let projectionViolations = 0;
	for (const [target, writers] of projectionWriters) {
		if (writers.size <= 1) continue;
		projectionViolations += 1;
		error(`UI-004: ${target} is written by ${writers.size} modules (${[...writers].join(', ')}) — a projection element must have exactly one writer`);
	}

	if (domReadbacks === 0) ok('no popup control value is computed from a DOM readback');
	if (projectionViolations === 0) {
		ok(`every projection element has a single writer across ${projectionWriters.size} surfaces`);
	}
	ok(`Capture color authority checked across ${captureRenderers.size} rendering sites`);
}

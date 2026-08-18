// goal: turn HALO release admission into a physical dist boundary
// inv: catalog-only plugin implementation bytes cannot survive into the release artifact

import {
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	RELEASE_ADMITTED_PLUGIN_IDS,
	RELEASE_CONTENT_RUNTIME_IDS,
	RELEASE_PANEL_IDS,
	RELEASE_SCRIPT_RUNTIME_IDS,
} from './src/kernel/registry/_generated-release-admission';

const __filename = fileURLToPath(import.meta.url);
const appRoot = path.dirname(__filename);
const distDir = path.join(appRoot, 'dist');
const analysisPath = path.join(distDir, 'build-analysis.json');

const admittedPluginIds = new Set<string>(RELEASE_ADMITTED_PLUGIN_IDS);
const admittedPanelIds = new Set<string>(RELEASE_PANEL_IDS);
const admittedScriptRuntimeIds = new Set<string>(RELEASE_SCRIPT_RUNTIME_IDS);
const admittedContentRuntimeIds = new Set<string>(RELEASE_CONTENT_RUNTIME_IDS);

function removeTree(directory: string): number {
	if (!existsSync(directory)) return 0;
	let bytes = 0;
	const stack = [directory];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) continue;
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const candidate = path.join(current, entry.name);
			if (entry.isDirectory()) stack.push(candidate);
			else if (entry.isFile()) bytes += statSync(candidate).size;
		}
	}
	rmSync(directory, {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 100,
	});
	return bytes;
}

function pruneGeneratedPluginDirectories(): { bytes: number; paths: string[] } {
	let bytes = 0;
	const paths: string[] = [];
	const roots = [
		{
			directory: path.join(distDir, 'tools'),
			allowed: (id: string) => admittedPluginIds.has(id)
				|| id.startsWith('_') && admittedContentRuntimeIds.size > 0,
		},
		{
			directory: path.join(distDir, 'scripts'),
			allowed: (id: string) => admittedScriptRuntimeIds.has(id),
		},
	];

	for (const root of roots) {
		if (!existsSync(root.directory)) continue;
		for (const entry of readdirSync(root.directory, { withFileTypes: true })) {
			if (!entry.isDirectory() || root.allowed(entry.name)) continue;
			const candidate = path.join(root.directory, entry.name);
			bytes += removeTree(candidate);
			paths.push(path.relative(distDir, candidate).replaceAll('\\', '/'));
		}
	}
	return { bytes, paths: paths.sort() };
}

interface ActivationClosure {
	entryPoint?: unknown;
	target?: unknown;
}

interface BuildAnalysis {
	sidepanelActivationClosures?: ActivationClosure[];
}

function pluginIdFromEntryPoint(entryPoint: string): string | null {
	const normalized = entryPoint.replaceAll('\\', '/');
	const match = /(?:^|\/)src\/(?:tools|scripts|system)\/([^/]+)(?:\/|$)/u.exec(normalized);
	return match?.[1] ?? null;
}

function verifyActivationClosures(): void {
	if (!existsSync(analysisPath)) {
		throw new Error('HALO release payload requires build-analysis.json from production --analyze build');
	}
	const analysis = JSON.parse(readFileSync(analysisPath, 'utf8')) as BuildAnalysis;
	if (!Array.isArray(analysis.sidepanelActivationClosures)
		|| analysis.sidepanelActivationClosures.length === 0) {
		throw new Error('HALO release payload has no measured SidePanel activation closures');
	}
	const violations: string[] = [];
	for (const closure of analysis.sidepanelActivationClosures) {
		if (typeof closure.entryPoint !== 'string') continue;
		const pluginId = pluginIdFromEntryPoint(closure.entryPoint);
		if (!pluginId || admittedPanelIds.has(pluginId)) continue;
		violations.push(`${pluginId}:${closure.entryPoint}`);
	}
	if (violations.length > 0) {
		throw new Error(
			`HALO catalog-only implementation entered SidePanel production closures: ${violations.sort().join(', ')}`,
		);
	}
}

function verifyPackagedScriptRuntime(): void {
	const runtimePath = path.join(distDir, 'script-plugin-runtime.json');
	const descriptors = JSON.parse(readFileSync(runtimePath, 'utf8')) as unknown;
	if (!Array.isArray(descriptors)) throw new Error('HALO packaged script runtime must be an array');
	const ids: string[] = [];
	for (const descriptor of descriptors) {
		if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
			throw new Error('HALO packaged script runtime contains a malformed descriptor');
		}
		const id = (descriptor as { id?: unknown }).id;
		if (typeof id !== 'string' || !admittedScriptRuntimeIds.has(id)) {
			throw new Error(`HALO unadmitted packaged script runtime: ${String(id)}`);
		}
		ids.push(id);
	}
	const expected = [...admittedScriptRuntimeIds].sort();
	const actual = [...new Set(ids)].sort();
	if (actual.length !== ids.length || actual.join('\0') !== expected.join('\0')) {
		throw new Error(
			`HALO packaged script runtime projection mismatch: expected ${expected.join(', ')}, got ${actual.join(', ')}`,
		);
	}
}

function verifyGeneratedExecutableDirectories(): void {
	const scriptsDir = path.join(distDir, 'scripts');
	const actualScripts = existsSync(scriptsDir)
		? readdirSync(scriptsDir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort()
		: [];
	const unexpectedScripts = actualScripts.filter((id) => !admittedScriptRuntimeIds.has(id));
	if (unexpectedScripts.length > 0) {
		throw new Error(`HALO unadmitted dist/scripts directories survived: ${unexpectedScripts.join(', ')}`);
	}

	const toolsDir = path.join(distDir, 'tools');
	const unexpectedTools = existsSync(toolsDir)
		? readdirSync(toolsDir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.filter((id) => !admittedPluginIds.has(id) && !id.startsWith('_'))
			.sort()
		: [];
	if (unexpectedTools.length > 0) {
		throw new Error(`HALO unadmitted dist/tools directories survived: ${unexpectedTools.join(', ')}`);
	}
}

export function finalizeReleasePayload(): void {
	if (!existsSync(distDir)) throw new Error('HALO dist/ is missing; build before finalizing release payload');
	verifyActivationClosures();
	verifyPackagedScriptRuntime();
	const pruned = pruneGeneratedPluginDirectories();
	verifyGeneratedExecutableDirectories();

	// The analysis file is exact-head build evidence for the verifier, not a user
	// release asset. Do not inflate or expose the production extension with it.
	rmSync(analysisPath, { force: true });
	const detail = pruned.paths.length > 0
		? `; retired ${pruned.paths.length} catalog-only generated path(s), ${pruned.bytes} byte(s)`
		: '; producer already emitted zero catalog-only generated paths';
	console.log(`✓ HALO release payload: ${admittedPluginIds.size} admitted modules${detail}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
	finalizeReleasePayload();
}

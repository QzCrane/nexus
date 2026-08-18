// goal: turn HALO release admission into a physical dist boundary
// inv: catalog-only plugin implementation bytes cannot survive into the release artifact

import {
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	RELEASE_ADMITTED_PLUGIN_IDS,
	RELEASE_CONTENT_SCRIPTS,
	RELEASE_PANEL_IDS,
	RELEASE_SCRIPT_RUNTIME_IDS,
	RELEASE_WEB_ACCESSIBLE_RESOURCES,
} from './src/kernel/registry/_generated-release-admission';

const __filename = fileURLToPath(import.meta.url);
const appRoot = path.dirname(__filename);
const distDir = path.join(appRoot, 'dist');
const analysisPath = path.join(distDir, 'build-analysis.json');

const admittedPluginIds = new Set<string>(RELEASE_ADMITTED_PLUGIN_IDS);
const admittedPanelIds = new Set<string>(RELEASE_PANEL_IDS);
const admittedScriptRuntimeIds = new Set<string>(RELEASE_SCRIPT_RUNTIME_IDS);
const admittedContentOutputs = new Set<string>([
	'content.js',
	...RELEASE_CONTENT_SCRIPTS.map((entry) => entry.js),
]);
const admittedToolRuntimeDirectories = new Set(
	RELEASE_WEB_ACCESSIBLE_RESOURCES
		.filter((resource) => resource.startsWith('tools/'))
		.map((resource) => resource.split('/')[1])
		.filter((segment): segment is string => Boolean(segment)),
);

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

function removeFile(file: string): number {
	if (!existsSync(file)) return 0;
	const bytes = statSync(file).size;
	unlinkSync(file);
	return bytes;
}

function pruneGeneratedExecutableSurfaces(): { bytes: number; paths: string[] } {
	let bytes = 0;
	const paths: string[] = [];
	const roots = [
		{
			directory: path.join(distDir, 'tools'),
			allowed: (id: string) => admittedScriptRuntimeIds.has(id) || admittedToolRuntimeDirectories.has(id),
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

	for (const entry of readdirSync(distDir, { withFileTypes: true })) {
		if (!entry.isFile() || !/^content-[A-Za-z0-9_-]+\.js$/u.test(entry.name)) continue;
		if (admittedContentOutputs.has(entry.name)) continue;
		const candidate = path.join(distDir, entry.name);
		bytes += removeFile(candidate);
		paths.push(entry.name);
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

function verifyBuiltManifest(): void {
	const manifestPath = path.join(distDir, 'manifest.json');
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
		content_scripts?: Array<{
			matches?: unknown;
			js?: unknown;
			run_at?: unknown;
			all_frames?: unknown;
		}>;
		web_accessible_resources?: Array<{
			resources?: unknown;
			matches?: unknown;
			use_dynamic_url?: unknown;
		}>;
	};
	if (!Array.isArray(manifest.content_scripts)) throw new Error('HALO built manifest has no content_scripts');
	const actualContent = manifest.content_scripts.map((entry) => ({
		matches: entry.matches,
		js: entry.js,
		runAt: entry.run_at,
		allFrames: entry.all_frames,
	}));
	const expectedContent = [
		{ matches: ['<all_urls>'], js: ['content.js'], runAt: 'document_start', allFrames: false },
		...RELEASE_CONTENT_SCRIPTS.map((entry) => ({
			matches: ['<all_urls>'],
			js: [entry.js],
			runAt: entry.runAt,
			allFrames: entry.allFrames,
		})),
	];
	if (JSON.stringify(actualContent) !== JSON.stringify(expectedContent)) {
		throw new Error('HALO built manifest content_scripts differ from release admission');
	}

	const resources = manifest.web_accessible_resources;
	if (!Array.isArray(resources) || resources.length !== 1) {
		throw new Error('HALO built manifest must have one exact web-accessible resource owner');
	}
	const [resourceOwner] = resources;
	if (!resourceOwner
		|| JSON.stringify(resourceOwner.resources) !== JSON.stringify([...RELEASE_WEB_ACCESSIBLE_RESOURCES])
		|| JSON.stringify(resourceOwner.matches) !== JSON.stringify(['<all_urls>'])
		|| resourceOwner.use_dynamic_url !== true) {
		throw new Error('HALO built manifest web-accessible resources differ from release admission');
	}
}

function verifyGeneratedExecutableSurfaces(): void {
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
			.filter((id) => !admittedScriptRuntimeIds.has(id) && !admittedToolRuntimeDirectories.has(id))
			.sort()
		: [];
	if (unexpectedTools.length > 0) {
		throw new Error(`HALO unadmitted dist/tools directories survived: ${unexpectedTools.join(', ')}`);
	}
	const unexpectedContent = readdirSync(distDir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && /^content-[A-Za-z0-9_-]+\.js$/u.test(entry.name))
		.map((entry) => entry.name)
		.filter((output) => !admittedContentOutputs.has(output))
		.sort();
	if (unexpectedContent.length > 0) {
		throw new Error(`HALO unadmitted content outputs survived: ${unexpectedContent.join(', ')}`);
	}
	for (const resource of RELEASE_WEB_ACCESSIBLE_RESOURCES) {
		if (!existsSync(path.join(distDir, resource))) {
			throw new Error(`HALO admitted web-accessible resource is missing: ${resource}`);
		}
	}
}

export function finalizeReleasePayload(): void {
	if (!existsSync(distDir)) throw new Error('HALO dist/ is missing; build before finalizing release payload');
	verifyActivationClosures();
	verifyPackagedScriptRuntime();
	verifyBuiltManifest();
	const pruned = pruneGeneratedExecutableSurfaces();
	verifyGeneratedExecutableSurfaces();

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

// goal: prove HALO release admission is already the physical dist boundary
// inv: the producer emits zero catalog-only executable bytes; finalization verifies and never cleans them up

import {
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	RELEASE_ADMITTED_PLUGIN_IDS,
	RELEASE_CONTENT_SCRIPTS,
	RELEASE_PANEL_IDS,
	RELEASE_SCRIPT_RUNTIME_IDS,
	RELEASE_WEB_ACCESSIBLE_RESOURCES,
	RELEASE_WEB_ACCESSIBLE_RUNTIME_ENTRIES,
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

interface ActivationClosure {
	entryPoint?: unknown;
	target?: unknown;
}

interface BuildOutputDetail {
	entryPoint?: string;
}

interface BuildAnalysis {
	sidepanelActivationClosures?: ActivationClosure[];
	entries?: Array<{
		entry?: unknown;
		outputs?: Record<string, BuildOutputDetail>;
	}>;
}

function readBuildAnalysis(): BuildAnalysis {
	if (!existsSync(analysisPath)) {
		throw new Error('HALO release payload requires build-analysis.json from production --analyze build');
	}
	return JSON.parse(readFileSync(analysisPath, 'utf8')) as BuildAnalysis;
}

function pluginIdFromEntryPoint(entryPoint: string): string | null {
	const normalized = entryPoint.replaceAll('\\', '/');
	const match = /(?:^|\/)src\/(?:tools|scripts|system)\/([^/]+)(?:\/|$)/u.exec(normalized);
	return match?.[1] ?? null;
}

function verifyActivationClosures(analysis: BuildAnalysis): void {
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

function normalizedOutputIdentity(value: string): string {
	return value.replaceAll('\\', '/').replace(/^\.\//u, '');
}

function verifyBuildEntryProjection(analysis: BuildAnalysis): void {
	if (!Array.isArray(analysis.entries)) throw new Error('HALO build analysis has no entry projection');
	const expected = new Map<string, string>([
		['content.js', 'src/entry/content.ts'],
		...RELEASE_CONTENT_SCRIPTS.map((entry) => [entry.js, entry.entry] as const),
		...RELEASE_WEB_ACCESSIBLE_RUNTIME_ENTRIES.map((entry) => [entry.output, entry.entry] as const),
		['background.js', 'src/entry/background.ts'],
		['sidepanel.js', 'src/entry/sidepanel.tsx'],
		['sidepanel-init.js', 'src/entry/sidepanel-init.ts'],
	]);
	const actual = new Map<string, string>();

	for (const entry of analysis.entries) {
		if (typeof entry.entry !== 'string' || !entry.outputs || typeof entry.outputs !== 'object') continue;
		const output = normalizedOutputIdentity(entry.entry);
		const matchingOutputs = Object.entries(entry.outputs).filter(([candidate]) => {
			const normalized = normalizedOutputIdentity(candidate);
			return normalized === output || normalized.endsWith(`/${output}`);
		});
		if (matchingOutputs.length !== 1) {
			throw new Error(
				`HALO build output ${output} must have exactly one primary metafile output; found ${matchingOutputs.length}`,
			);
		}
		const detail = matchingOutputs[0]?.[1];
		if (!detail || typeof detail.entryPoint !== 'string') {
			throw new Error(`HALO build output ${output} has no primary source entrypoint`);
		}
		actual.set(output, detail.entryPoint.replaceAll('\\', '/'));
	}

	if (actual.size !== expected.size) {
		throw new Error(`HALO build entry projection count mismatch: expected ${expected.size}, got ${actual.size}`);
	}
	for (const [output, source] of expected) {
		if (actual.get(output) !== source) {
			throw new Error(
				`HALO build entry projection mismatch for ${output}: expected ${source}, got ${String(actual.get(output))}`,
			);
		}
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
	const analysis = readBuildAnalysis();
	verifyActivationClosures(analysis);
	verifyBuildEntryProjection(analysis);
	verifyPackagedScriptRuntime();
	verifyBuiltManifest();
	verifyGeneratedExecutableSurfaces();

	// The analysis file is exact-head build evidence for the verifier, not a user
	// release asset. Do not inflate or expose the production extension with it.
	rmSync(analysisPath, { force: true });
	console.log(`✓ HALO release payload: ${admittedPluginIds.size} admitted modules; producer emitted zero catalog-only executable paths`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
	finalizeReleasePayload();
}

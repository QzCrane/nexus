import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SPECTRA_PRODUCTION_BUDGETS = Object.freeze({
	serviceWorkerWake: 256 * 1024,
	documentStart: 24 * 1024,
	contentBootstrap: 14 * 1024,
	contentSiteHotkeys: 11 * 1024,
	offscreenCapture: 28 * 1024,
	offscreenRemote: 72 * 1024,
	popupStatic: 144 * 1024,
	popupPossibleScript: 152 * 1024,
	contentRuntimePossibleScript: 177 * 1024,
	contentVideoEffectsPossibleScript: 12 * 1024,
	optionsPossibleScript: 40 * 1024,
	javascriptTotal: 680 * 1024,
	distTotal: 780 * 1024,
});

export const PRODUCTION_HEADROOM_CRITICAL_RATIO = 0.05;
export const PRODUCTION_HEADROOM_ADVISORY_RATIO = 0.15;

function productionBudgetMeasurements(report) {
	const entries = new Map(report.entrypoints.map((entry) => [entry.name, entry]));
	return [
		['service-worker wake', report.serviceWorkerWake?.scriptBytes ?? 0, SPECTRA_PRODUCTION_BUDGETS.serviceWorkerWake],
		['document_start', report.documentStart?.scriptBytes ?? 0, SPECTRA_PRODUCTION_BUDGETS.documentStart],
		['content-bootstrap.js static script closure', entries.get('content-bootstrap.js')?.static.scriptBytes ?? 0, SPECTRA_PRODUCTION_BUDGETS.contentBootstrap],
		['content-site-hotkeys.js static script closure', entries.get('content-site-hotkeys.js')?.static.scriptBytes ?? 0, SPECTRA_PRODUCTION_BUDGETS.contentSiteHotkeys],
		['offscreen Capture-only closure', report.offscreenAudioOnly?.scriptBytes ?? 0, SPECTRA_PRODUCTION_BUDGETS.offscreenCapture],
		['offscreen Remote possible script closure', report.offscreenRemote?.scriptBytes ?? 0, SPECTRA_PRODUCTION_BUDGETS.offscreenRemote],
		['popup.js static script closure', entries.get('popup.js')?.static.scriptBytes ?? 0, SPECTRA_PRODUCTION_BUDGETS.popupStatic],
		['popup.js possible script closure', entries.get('popup.js')?.possible.scriptBytes ?? 0, SPECTRA_PRODUCTION_BUDGETS.popupPossibleScript],
		['content-runtime.js possible script closure', entries.get('content-runtime.js')?.possible.scriptBytes ?? 0, SPECTRA_PRODUCTION_BUDGETS.contentRuntimePossibleScript],
		['content-video-effects.js possible script closure', entries.get('content-video-effects.js')?.possible.scriptBytes ?? 0, SPECTRA_PRODUCTION_BUDGETS.contentVideoEffectsPossibleScript],
		['options.js possible script closure', entries.get('options.js')?.possible.scriptBytes ?? 0, SPECTRA_PRODUCTION_BUDGETS.optionsPossibleScript],
		['total production JavaScript', report.javascript ?? 0, SPECTRA_PRODUCTION_BUDGETS.javascriptTotal],
		['total production artifact', report.total ?? 0, SPECTRA_PRODUCTION_BUDGETS.distTotal],
	] as const;
}

export function productionBudgetFailures(report) {
	const failures = [];
	for (const [label, actual, ceiling] of productionBudgetMeasurements(report)) {
		if (actual > ceiling) failures.push(`${label}: ${actual} bytes exceeds production budget ${ceiling}`);
	}
	return failures;
}

export interface ProductionHeadroomAdvisory {
	code: 'headroom-low' | 'headroom-critical';
	label: string;
	actualBytes: number;
	ceilingBytes: number;
	utilization: number;
	targetMaxBytes: number;
	deficitBytes: number;
	message: string;
}

/**
 * Headroom is planning evidence only. Release integrity remains governed by
 * the absolute ceilings in SPECTRA_PRODUCTION_BUDGETS; an advisory is never a
 * promotion blocker and is deliberately absent from signed candidate facts.
 */
export function productionHeadroomAdvisories(report): ProductionHeadroomAdvisory[] {
	return productionBudgetMeasurements(report)
		.filter(([, actual, ceiling]) => actual > ceiling * (1 - PRODUCTION_HEADROOM_ADVISORY_RATIO))
		.map(([label, actual, ceiling]) => {
			const targetMaxBytes = Math.floor(ceiling * (1 - PRODUCTION_HEADROOM_ADVISORY_RATIO));
			const deficitBytes = Math.max(0, actual - targetMaxBytes);
			const utilization = actual / ceiling;
			const code = utilization >= 1 - PRODUCTION_HEADROOM_CRITICAL_RATIO
				? 'headroom-critical'
				: 'headroom-low';
			const disposition = code === 'headroom-critical'
				? 'HEADROOM_CRITICAL'
				: 'HEADROOM_LOW';
			const message = `${disposition}/${label}: ${actual}/${ceiling} bytes (${(utilization * 100).toFixed(1)}%); `
				+ `optimization target ${targetMaxBytes} bytes (15% headroom), deficit ${deficitBytes} bytes; `
				+ 'release remains governed by the absolute production ceiling';
			return {
				code,
				label,
				actualBytes: actual,
				ceilingBytes: ceiling,
				utilization,
				targetMaxBytes,
				deficitBytes,
				message,
			};
		});
}

const KiB = 1024;
const REMOTE_RUNTIME_ASSET = 'peerjs-vendor.js';
const IMPORT_PATTERN = /(?:\bimport\s*(?:[^"'()]*?from\s*)?|\bimport\s*\()\s*["']([^"']+)["']/gu;
const STATIC_MODULE_REFERENCE_PATTERN = /\b(?:import\s*(?:[^"'()]*?\bfrom\s*)?|export\s+(?:[^"']*?\bfrom\s*))["']([^"']+)["']/gu;
const DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu;
const RUNTIME_MODULE_IMPORT_PATTERN = /\bimport\s*\(\s*chrome\.runtime\.getURL\(\s*["']([^"']+)["']\s*\)\s*\)/gu;
const SCRIPTING_FILES_PATTERN = /\bchrome\.scripting\.executeScript\(\s*\{[\s\S]*?\bfiles\s*:\s*\[\s*["']([^"']+)["']/gu;
const SCRIPTING_BOUND_FILES_PATTERN = /\bchrome\.scripting\.executeScript\(\s*\{[\s\S]*?\bfiles\s*:\s*\[\s*([A-Za-z_$][A-Za-z0-9_$]*)/gu;
const STATIC_STRING_BINDING_PATTERN = /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*["']([^"']+)["']/gu;
const STATIC_STRING_ASSIGNMENT_PATTERN = /(?:^|[;,])\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*["']([^"']+)["']/gu;
const HTML_TAG_PATTERN = /<(script|link|img|source|video|audio)\b[^>]*>/giu;
const RUNTIME_ASSET_PATTERN = /\bchrome\.runtime\.getURL\(\s*["']([^"']+)["']\s*\)/gu;
const RUNTIME_FETCH_ASSET_PATTERN = /\bfetch\s*\(\s*chrome\.runtime\.getURL\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*)\1\s*\)\s*\)/gu;
const OFFSCREEN_DOCUMENT_URL_PATTERN = /\bchrome\.offscreen\.createDocument\(\s*\{[^}]*\burl\s*:\s*["']([^"']+)["']/gu;
const OFFSCREEN_DOCUMENT_URL_BINDING_PATTERN = /\bchrome\.offscreen\.createDocument\(\s*\{[^}]*\burl\s*:\s*([A-Za-z_$][A-Za-z0-9_$]*)/gu;
const CSS_REFERENCE_PATTERN = /(?:@import\s+(?:url\()?|url\()\s*["']?([^"')\s]+)["']?\s*\)?/giu;
const SOURCE_MAP_REFERENCE_PATTERN = /[#@]\s*sourceMappingURL=/u;
const DIAGNOSTIC_CALL_PATTERN = /\bconsole\.(?:debug|info|log)\s*\(/u;
const URL_SCHEME_PATTERN = /^(?:blob:|chrome:|data:|https?:|javascript:|mailto:)/iu;

export const FORBIDDEN_PRODUCTION_ARTIFACT_PATTERNS = Object.freeze([
	/(?:^|\/)(?:\.git|\.turbo|coverage|node_modules|test|tests|__tests__)(?:\/|$)/iu,
	/(?:^|\/)(?:\.DS_Store|Thumbs\.db)$/iu,
	/(?:^|\/)(?:build-analysis|metafile|stats)(?:\.[^/]*)?$/iu,
	/(?:^|\/)[^/]+\.(?:log|map|md|ts|tsx|tsbuildinfo)$/iu,
	/(?:^|\/)[^/]+(?:^|\.)(?:spec|test)\.[^/]+$/iu,
]);

function format(bytes) {
	return `${(bytes / KiB).toFixed(1)}KiB`;
}

function artifactName(root, path) {
	return relative(root, path).replaceAll('\\', '/');
}

function walkArtifacts(directory, root = resolve(directory), failures = []) {
	const paths = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = resolve(directory, entry.name);
		if (entry.isSymbolicLink()) {
			failures.push(`${artifactName(root, path)}: symbolic links are forbidden`);
			continue;
		}
		if (entry.isDirectory()) {
			paths.push(...walkArtifacts(path, root, failures));
			continue;
		}
		if (!entry.isFile()) {
			failures.push(`${artifactName(root, path)}: unsupported filesystem entry`);
			continue;
		}
		paths.push(path);
	}
	return paths.sort((left, right) => artifactName(root, left).localeCompare(artifactName(root, right)));
}

function globPattern(value) {
	return new RegExp(`^${value
		.split(/([*?])/u)
		.map((part) => part === '*' ? '.*' : part === '?' ? '.' : part.replace(/[\\^$+?.()|[\]{}]/gu, '\\$&'))
		.join('')}$`, 'u');
}

function cleanSpecifier(specifier) {
	return specifier.trim().replace(/[?#].*$/u, '').replaceAll('\\', '/');
}

function candidateNames(fromName, specifier) {
	const cleaned = cleanSpecifier(specifier);
	if (!cleaned || cleaned.startsWith('#') || URL_SCHEME_PATTERN.test(cleaned)) return [];
	const names = cleaned.startsWith('/')
		? [cleaned.slice(1)]
		: cleaned.startsWith('.')
			? [posix.join(posix.dirname(fromName), cleaned)]
			: [cleaned, posix.join(posix.dirname(fromName), cleaned)];
	return [...new Set(names.map((name) => posix.normalize(name).replace(/^\.\//u, '')))]
		.filter((name) => name !== '..' && !name.startsWith('../'));
}

function resolveReference(index, fromName, specifier, { required = false } = {}) {
	const cleaned = cleanSpecifier(specifier);
	if (!cleaned || cleaned.startsWith('#') || URL_SCHEME_PATTERN.test(cleaned)) return [];
	const dynamic = /\$\{[^}]+\}/u.test(specifier);
	const candidates = candidateNames(fromName, dynamic ? specifier.replace(/\$\{[^}]+\}/gu, '*') : specifier);
	const matches = [];
	for (const candidate of candidates) {
		if (candidate.includes('*') || candidate.includes('?')) {
			const pattern = globPattern(candidate);
			for (const name of index.keys()) if (pattern.test(name)) matches.push(name);
		} else if (index.has(candidate)) {
			matches.push(candidate);
		}
	}
	if (required && matches.length === 0) {
		throw new Error(`${fromName}: referenced production artifact is missing (${specifier})`);
	}
	return [...new Set(matches)];
}

function manifestReferences(manifest, index) {
	const references = [];
	const add = (value, label) => {
		if (typeof value !== 'string' || value.length === 0) return;
		const matches = resolveReference(index, 'manifest.json', value, { required: true });
		if (matches.length === 0) throw new Error(`manifest.json: ${label} is missing (${value})`);
		references.push(...matches);
	};
	const addIcons = (icons, label) => {
		for (const [size, value] of Object.entries(icons ?? {})) add(value, `${label}.${size}`);
	};

	add(manifest.background?.service_worker, 'background.service_worker');
	add(manifest.action?.default_popup, 'action.default_popup');
	addIcons(manifest.action?.default_icon, 'action.default_icon');
	addIcons(manifest.icons, 'icons');
	add(manifest.options_page, 'options_page');
	add(manifest.options_ui?.page, 'options_ui.page');
	add(manifest.devtools_page, 'devtools_page');
	add(manifest.side_panel?.default_path, 'side_panel.default_path');
	for (const value of Object.values(manifest.chrome_url_overrides ?? {})) add(value, 'chrome_url_overrides');
	for (const page of manifest.sandbox?.pages ?? []) add(page, 'sandbox.pages');
	for (const [scriptIndex, script] of (manifest.content_scripts ?? []).entries()) {
		for (const value of script.js ?? []) add(value, `content_scripts.${scriptIndex}.js`);
		for (const value of script.css ?? []) add(value, `content_scripts.${scriptIndex}.css`);
	}
	for (const [resourceIndex, resource] of (manifest.web_accessible_resources ?? []).entries()) {
		for (const value of resource.resources ?? []) add(value, `web_accessible_resources.${resourceIndex}`);
	}
	if (manifest.default_locale) {
		const localeArtifacts = [...index.keys()].filter((name) => name.startsWith('_locales/'));
		if (localeArtifacts.length === 0) throw new Error('manifest.json: default_locale requires _locales artifacts');
		references.push(...localeArtifacts);
	}
	return [...new Set(references)];
}

function fileReferences(name, source, index) {
	const references = [];
	const add = (specifier, required = false) => {
		try {
			references.push(...resolveReference(index, name, specifier, { required }));
		} catch (error) {
			throw new Error(error instanceof Error ? error.message : String(error));
		}
	};
	const extension = extname(name).toLowerCase();
	if (extension === '.html') {
		for (const reference of htmlLoadingReferences(name, source, index)) references.push(reference.target);
	} else if (extension === '.css') {
		for (const match of source.matchAll(CSS_REFERENCE_PATTERN)) add(match[1], true);
	} else if (extension === '.js') {
		for (const reference of loadingReferences(name, source, index)) references.push(reference.target);
	}
	return [...new Set(references)];
}

function htmlAttribute(tag: string, attribute: string): string | undefined {
	const match = new RegExp(`\\b${attribute}\\s*=\\s*["']([^"']+)["']`, 'iu').exec(tag);
	return match?.[1];
}

function htmlLoadingReferences(name: string, source: string, index: Map<string, string>) {
	const references: Array<{ kind: string; target: string }> = [];
	for (const match of source.matchAll(HTML_TAG_PATTERN)) {
		const tag = match[0];
		const tagName = match[1]?.toLowerCase();
		const resource = tagName === 'script'
			? htmlAttribute(tag, 'src')
			: tagName === 'link' && /\brel\s*=\s*["']stylesheet["']/iu.test(tag)
				? htmlAttribute(tag, 'href')
				: tagName === 'img' || tagName === 'source' || tagName === 'audio'
					? htmlAttribute(tag, 'src')
					: tagName === 'video' ? htmlAttribute(tag, 'poster') : undefined;
		if (!resource) continue;
		for (const target of resolveReference(index, name, resource, { required: true })) {
			references.push({ kind: tagName === 'script' ? 'html-script' : 'html-resource', target });
		}
	}
	return references;
}

function staticStringBindings(source: string): Map<string, string> {
	const bindings = new Map<string, string>();
	for (const match of source.matchAll(STATIC_STRING_BINDING_PATTERN)) {
		if (match[1] && match[2]) bindings.set(match[1], match[2]);
	}
	for (const match of source.matchAll(STATIC_STRING_ASSIGNMENT_PATTERN)) {
		if (match[1] && match[2]) bindings.set(match[1], match[2]);
	}
	return bindings;
}

function loadingReferences(name, source, index) {
	const references = [];
	const add = (specifier, kind, required = true) => {
		for (const target of resolveReference(index, name, specifier, { required })) {
			references.push({ kind, target });
		}
	};
	const extension = extname(name).toLowerCase();
	if (extension === '.html') {
		references.push(...htmlLoadingReferences(name, source, index));
	} else if (extension === '.js') {
		const bindings = staticStringBindings(source);
		const runtimeModules = new Set<string>();
		for (const match of source.matchAll(IMPORT_PATTERN)) {
			const specifier = match[1];
			if (!specifier || URL_SCHEME_PATTERN.test(specifier)) continue;
			if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
				throw new Error(`${name}: bare production import is forbidden (${specifier})`);
			}
		}
		for (const match of source.matchAll(STATIC_MODULE_REFERENCE_PATTERN)) {
			add(match[1], 'js-static');
		}
		for (const match of source.matchAll(DYNAMIC_IMPORT_PATTERN)) add(match[1], 'js-deferred');
		for (const match of source.matchAll(RUNTIME_MODULE_IMPORT_PATTERN)) {
			if (!match[1]) continue;
			runtimeModules.add(match[1]);
			add(match[1], 'runtime-module');
		}
		for (const match of source.matchAll(RUNTIME_ASSET_PATTERN)) {
			if (match[1] === REMOTE_RUNTIME_ASSET && !runtimeModules.has(match[1])) {
				add(match[1], 'runtime-asset');
			}
		}
		for (const match of source.matchAll(RUNTIME_FETCH_ASSET_PATTERN)) {
			add(match[2], 'runtime-asset');
		}
		for (const match of source.matchAll(OFFSCREEN_DOCUMENT_URL_PATTERN)) {
			add(match[1], 'extension-page');
		}
		for (const match of source.matchAll(OFFSCREEN_DOCUMENT_URL_BINDING_PATTERN)) {
			const documentUrl = bindings.get(match[1]);
			if (documentUrl) add(documentUrl, 'extension-page');
		}
		for (const match of source.matchAll(SCRIPTING_FILES_PATTERN)) {
			add(match[1], 'chrome-script');
		}
		for (const match of source.matchAll(SCRIPTING_BOUND_FILES_PATTERN)) {
			const scriptName = bindings.get(match[1]);
			if (scriptName) add(scriptName, 'chrome-script');
		}
	}
	return references;
}

function artifactClosureFromIndex(index, roots, options) {
	const names = new Set();
	const queue = [...roots];
	while (queue.length > 0) {
		const name = queue.shift();
		if (!name || names.has(name)) continue;
		const path = index.get(name);
		if (!path) throw new Error(`${name}: production loading root is missing`);
		names.add(name);
		const extension = extname(name).toLowerCase();
		if (!['.html', '.js'].includes(extension)) continue;
		const source = readFileSync(path, 'utf8');
		for (const reference of loadingReferences(name, source, index)) {
			const admitted = reference.kind === 'html-script'
				|| reference.kind === 'js-static'
				|| reference.kind === 'js-deferred' && options.includeDeferred
				|| reference.kind === 'runtime-module' && options.includeDeferred
				|| reference.kind === 'runtime-asset' && options.includeRuntimeAssets;
			if (admitted && !names.has(reference.target)) queue.push(reference.target);
		}
	}
	const sortedNames = [...names].sort();
	const files = sortedNames.map((name) => index.get(name));
	const scriptNames = sortedNames.filter((name) => extname(name).toLowerCase() === '.js');
	const scriptFiles = scriptNames.map((name) => index.get(name));
	return {
		bytes: files.reduce((sum, path) => sum + statSync(path).size, 0),
		files,
		names: sortedNames,
		scriptBytes: scriptFiles.reduce((sum, path) => sum + statSync(path).size, 0),
		scriptFiles,
		scriptNames,
	};
}

function artifactIndex(distDir) {
	const root = resolve(distDir);
	const failures = [];
	const files = walkArtifacts(root, root, failures);
	if (failures.length > 0) throw new Error(failures.join('\n'));
	return new Map(files.map((path) => [artifactName(root, path), path]));
}

export function artifactClosure(
	distDir,
	bundleName,
	options = { includeDeferred: false, includeRuntimeAssets: false },
) {
	return artifactClosureFromIndex(artifactIndex(distDir), [bundleName], options);
}

export function bundleFootprint(distDir, bundleName) {
	const closure = artifactClosure(distDir, bundleName, {
		includeDeferred: true,
		includeRuntimeAssets: false,
	});
	return { bytes: closure.bytes, files: closure.files };
}

function productionGraph(index, manifest) {
	const roots = new Set(['manifest.json', ...manifestReferences(manifest, index)]);
	const reachable = new Set();
	const queue = [...roots];
	while (queue.length > 0) {
		const name = queue.shift();
		if (!name || reachable.has(name)) continue;
		const path = index.get(name);
		if (!path) throw new Error(`${name}: production root is missing`);
		reachable.add(name);
		const extension = extname(name).toLowerCase();
		if (!['.css', '.html', '.js'].includes(extension)) continue;
		const source = readFileSync(path, 'utf8');
		for (const reference of fileReferences(name, source, index)) {
			if (!reachable.has(reference)) queue.push(reference);
		}
	}
	return { reachable, roots };
}

function duplicateArtifacts(files, root) {
	const hashes = new Map();
	for (const path of files) {
		const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
		const names = hashes.get(digest) ?? [];
		names.push(artifactName(root, path));
		hashes.set(digest, names);
	}
	return [...hashes.values()].filter((names) => names.length > 1);
}

function artifactSetDigest(files, root) {
	const hash = createHash('sha256');
	for (const path of files) {
		const name = artifactName(root, path);
		const data = readFileSync(path);
		hash.update(`${Buffer.byteLength(name, 'utf8')}:`);
		hash.update(name);
		hash.update(`:${data.length}:`);
		hash.update(data);
	}
	return hash.digest('hex');
}

function compareMetafileNames(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeMetafileOutputName(root, rawPath) {
	const value = String(rawPath).replaceAll('\\', '/');
	const rootName = resolve(root).replaceAll('\\', '/');
	if (value === rootName) return '';
	if (value.startsWith(`${rootName}/`)) return value.slice(rootName.length + 1);
	const normalized = posix.normalize(value).replace(/^\.\//u, '');
	const distMarker = `/${posix.basename(rootName)}/`;
	const markerIndex = normalized.lastIndexOf(distMarker);
	if (markerIndex >= 0) return normalized.slice(markerIndex + distMarker.length);
	const distPrefix = `${posix.basename(rootName)}/`;
	return normalized.startsWith(distPrefix) ? normalized.slice(distPrefix.length) : normalized;
}

function resolveMetafileOutputName(root, fromName, specifier, outputs) {
	const cleaned = String(specifier).replaceAll('\\', '/');
	const candidates = [
		normalizeMetafileOutputName(root, cleaned),
		posix.normalize(posix.join(posix.dirname(fromName), cleaned)).replace(/^\.\//u, ''),
	];
	return candidates.find((candidate) => outputs.has(candidate));
}

function metafileOutputRecords(root, metafiles) {
	const outputs = new Map();
	for (const build of metafiles) {
		if (!build?.metafile || typeof build.sharingDomain !== 'string') {
			throw new Error('Every production metafile requires one explicit sharingDomain');
		}
		for (const [rawPath, detail] of Object.entries(build.metafile.outputs ?? {})) {
			const name = normalizeMetafileOutputName(root, rawPath);
			if (!name) continue;
			if (outputs.has(name)) throw new Error(`Metafile output is attributed more than once (${name})`);
			outputs.set(name, {
				build: typeof build.name === 'string' ? build.name : build.sharingDomain,
				detail,
				name,
				sharingDomain: build.sharingDomain,
			});
		}
	}
	return outputs;
}

function metafileOutputBytes(root, record) {
	const path = resolve(root, record.name);
	if (!existsSync(path)) throw new Error(`${record.name}: metafile output is missing from dist`);
	return statSync(path).size;
}

function metafileClosure(root, outputs, rootName, includeDeferred) {
	const names = new Set();
	const queue = [rootName];
	while (queue.length > 0) {
		const name = queue.shift();
		if (!name || names.has(name)) continue;
		const record = outputs.get(name);
		if (!record) throw new Error(`${name}: metafile loading root is missing`);
		names.add(name);
		for (const imported of record.detail.imports ?? []) {
			if (!imported || imported.external === true || typeof imported.path !== 'string') continue;
			const kind = typeof imported.kind === 'string' ? imported.kind : '';
			const deferred = kind === 'dynamic-import' || kind === 'import-call' || /dynamic/iu.test(kind);
			if (deferred && !includeDeferred) continue;
			const target = resolveMetafileOutputName(root, name, imported.path, outputs);
			if (!target) throw new Error(`${name}: metafile import is missing (${imported.path})`);
			if (!names.has(target)) queue.push(target);
		}
	}
	const sortedNames = [...names].sort();
	const bytes = sortedNames.reduce((sum, name) => sum + metafileOutputBytes(root, outputs.get(name)), 0);
	const scriptNames = sortedNames.filter((name) => extname(name).toLowerCase() === '.js');
	const scriptBytes = scriptNames.reduce((sum, name) => sum + metafileOutputBytes(root, outputs.get(name)), 0);
	return { bytes, names: sortedNames, scriptBytes, scriptNames };
}

function metafileInputBytes(outputs, names) {
	const contributions = new Map();
	for (const name of names) {
		const record = outputs.get(name);
		for (const [input, info] of Object.entries(record?.detail.inputs ?? {})) {
			const normalized = input.replaceAll('\\', '/');
			const bytes = typeof info?.bytesInOutput === 'number' ? info.bytesInOutput : 0;
			contributions.set(normalized, (contributions.get(normalized) ?? 0) + bytes);
		}
	}
	return contributions;
}

function topInputContributors(contributions, limit = 24) {
	return [...contributions]
		.map(([path, bytes]) => ({ path, bytes }))
		.filter(({ bytes }) => bytes > 0)
		.sort((left, right) => right.bytes - left.bytes || compareMetafileNames(left.path, right.path))
		.slice(0, limit);
}

function metafileClosureSummary(closure) {
	return {
		bytes: closure.bytes,
		names: closure.names,
		scriptBytes: closure.scriptBytes,
		scriptNames: closure.scriptNames,
	};
}

function metafileEntrypointEvidence(root, outputs) {
	const entries = [...outputs.values()]
		.filter((record) => typeof record.detail.entryPoint === 'string')
		.sort((left, right) => compareMetafileNames(left.name, right.name))
		.map((record) => {
			const staticClosure = metafileClosure(root, outputs, record.name, false);
			const possibleClosure = metafileClosure(root, outputs, record.name, true);
			return {
				build: record.build,
				entryPoint: record.detail.entryPoint,
				name: record.name,
				possibleOutputClosure: metafileClosureSummary(possibleClosure),
				sharingDomain: record.sharingDomain,
				staticOutputClosure: metafileClosureSummary(staticClosure),
				staticInputs: metafileInputBytes(outputs, staticClosure.names),
				possibleInputs: metafileInputBytes(outputs, possibleClosure.names),
			};
		});
	const inputOwners = new Map();
	for (const entry of entries) {
		const allInputs = new Set([
			...entry.staticInputs.keys(),
			...entry.possibleInputs.keys(),
		]);
		for (const input of allInputs) {
			const owners = inputOwners.get(input) ?? [];
			owners.push({
				build: entry.build,
				entry: entry.name,
				sharingDomain: entry.sharingDomain,
				staticBytes: entry.staticInputs.get(input) ?? 0,
				possibleBytes: entry.possibleInputs.get(input) ?? 0,
			});
			inputOwners.set(input, owners);
		}
	}
	const sharedInputs = [...inputOwners.entries()]
		.filter(([, owners]) => owners.length > 1)
		.sort(([left], [right]) => compareMetafileNames(left, right))
		.map(([input, owners]) => ({
			entries: owners.sort((left, right) => compareMetafileNames(left.entry, right.entry)),
			input,
			totalPossibleAttributionBytes: owners.reduce((sum, owner) => sum + owner.possibleBytes, 0),
			totalStaticBytes: owners.reduce((sum, owner) => sum + owner.staticBytes, 0),
		}));
	return {
		outputClosures: entries.map(({ staticInputs, possibleInputs, ...entry }) => ({
			...entry,
			topPossibleInputContributors: topInputContributors(possibleInputs),
			topStaticContributors: topInputContributors(staticInputs),
		})),
		sharedInputs,
	};
}

function metafileEvidence(metafiles, root) {
	const owners = new Map();
	const contributors = new Map();
	const outputs = metafileOutputRecords(root, metafiles);
	for (const build of metafiles) {
		const inputs = new Set();
		for (const output of Object.values(build.metafile.outputs ?? {})) {
			for (const [path, info] of Object.entries(output.inputs ?? {})) {
				const normalized = path.replaceAll('\\', '/');
				inputs.add(normalized);
				contributors.set(normalized, (contributors.get(normalized) ?? 0) + (info.bytesInOutput ?? 0));
			}
		}
		for (const input of inputs) {
			const list = owners.get(input) ?? [];
			list.push({ name: build.name, sharingDomain: build.sharingDomain });
			owners.set(input, list);
		}
	}
	const redundantModules = [];
	const boundaryReplications = [];
	for (const [input, builds] of owners) {
		if (builds.length < 2) continue;
		const domains = new Set(builds.map((build) => build.sharingDomain));
		if (domains.size < builds.length) redundantModules.push({ input, builds });
		else boundaryReplications.push({ input, builds });
	}
	const topContributors = [...contributors]
		.map(([path, bytes]) => ({ path, bytes }))
		.sort((left, right) => right.bytes - left.bytes || compareMetafileNames(left.path, right.path))
		.slice(0, 8);
	const entrypointEvidence = metafileEntrypointEvidence(root, outputs);
	return {
		boundaryReplications,
		outputClosures: entrypointEvidence.outputClosures,
		redundantModules,
		sharedInputs: entrypointEvidence.sharedInputs,
		topContributors,
	};
}

export function analyzeProductionArtifacts({ distDir, metafiles = [] }) {
	const root = resolve(distDir);
	const failures = [];
	const files = walkArtifacts(root, root, failures);
	const index = new Map(files.map((path) => [artifactName(root, path), path]));
	const staticOptions = { includeDeferred: false, includeRuntimeAssets: false };
	const eventualOptions = { includeDeferred: true, includeRuntimeAssets: true };
	let serviceWorkerWake = artifactClosureFromIndex(index, [], staticOptions);
	let documentStart = artifactClosureFromIndex(index, [], staticOptions);
	let offscreenAudioOnly = null;
	let offscreenRemote = null;
	const manifestPath = index.get('manifest.json');
	if (!manifestPath) failures.push('manifest.json: required production root is missing');

	for (const name of index.keys()) {
		if (FORBIDDEN_PRODUCTION_ARTIFACT_PATTERNS.some((pattern) => pattern.test(name))) {
			failures.push(`${name}: development or source artifact is forbidden`);
		}
	}
	for (const path of files.filter((candidate) => candidate.endsWith('.js'))) {
		const source = readFileSync(path, 'utf8');
		const name = artifactName(root, path);
		if (SOURCE_MAP_REFERENCE_PATTERN.test(source)) failures.push(`${name}: source map reference is forbidden`);
		if (DIAGNOSTIC_CALL_PATTERN.test(source)) failures.push(`${name}: diagnostic console call is forbidden`);
	}

	let graph = { reachable: new Set(), roots: new Set() };
	if (manifestPath) {
		try {
			const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
			graph = productionGraph(index, manifest);
			const serviceWorker = manifest.background?.service_worker;
			if (typeof serviceWorker === 'string') {
				serviceWorkerWake = artifactClosureFromIndex(index, [serviceWorker], staticOptions);
				if (serviceWorkerWake.scriptFiles.length !== 1) {
					failures.push(
						`${serviceWorker}: MV3 service worker must be one self-contained bundle`,
					);
				}
			}
			const documentStartNames = (manifest.content_scripts ?? [])
				.flatMap((script) => script.js ?? [])
				.filter((name) => typeof name === 'string');
			documentStart = artifactClosureFromIndex(index, documentStartNames, staticOptions);
		} catch (error) {
			failures.push(error instanceof Error ? error.message : String(error));
		}
	}
	if (index.has('offscreen.html')) {
		try {
			offscreenAudioOnly = artifactClosureFromIndex(index, ['offscreen.html'], staticOptions);
			offscreenRemote = artifactClosureFromIndex(index, ['offscreen.html'], eventualOptions);
			if (index.has(REMOTE_RUNTIME_ASSET)) {
				if (offscreenAudioOnly.names.includes(REMOTE_RUNTIME_ASSET)) {
					failures.push('offscreen.html: Capture-only static closure must exclude peerjs-vendor.js');
				}
				if (!offscreenRemote.names.includes(REMOTE_RUNTIME_ASSET)) {
					failures.push('offscreen.html: Remote eventual closure must include peerjs-vendor.js');
				}
				const offscreenSource = readFileSync(index.get('offscreen.html'), 'utf8');
				if (/<script\b[^>]*\bsrc\s*=\s*["']peerjs-vendor\.js["']/iu.test(offscreenSource)) {
					failures.push('offscreen.html: peerjs-vendor.js must not be a static script');
				}
				const offscreenEntry = index.get('offscreen.js');
				const deferredRoutes = offscreenEntry
					? loadingReferences('offscreen.js', readFileSync(offscreenEntry, 'utf8'), index)
						.filter((reference) => reference.kind === 'js-deferred')
					: [];
				if (deferredRoutes.length !== 1) {
					failures.push('offscreen.js: exactly one deferred Remote route is required');
				}
				const peerParents = [];
				for (const [name, path] of index) {
					if (extname(name).toLowerCase() !== '.js') continue;
					for (const reference of loadingReferences(name, readFileSync(path, 'utf8'), index)) {
						if (reference.kind === 'runtime-module'
							&& reference.target === REMOTE_RUNTIME_ASSET) peerParents.push(name);
					}
				}
				if (peerParents.length !== 1) {
					failures.push('peerjs-vendor.js: exactly one Remote ESM runtime-module owner is required');
				} else if (offscreenAudioOnly.names.includes(peerParents[0])) {
					failures.push('peerjs-vendor.js: ESM runtime loader must stay outside the Capture-only closure');
				}
				const peerVendorSource = readFileSync(index.get(REMOTE_RUNTIME_ASSET), 'utf8');
				const hasDefaultExport = /\bexport\s+default\b/u.test(peerVendorSource)
					|| /\bexport\s*\{[^}]*\bas\s+default\b[^}]*\}/u.test(peerVendorSource);
				if (!hasDefaultExport) {
					failures.push('peerjs-vendor.js: ESM runtime module must expose one default export');
				}
				if (/\bglobalThis\.Peer\s*=/u.test(peerVendorSource)) {
					failures.push('peerjs-vendor.js: global Peer assignment is forbidden');
				}
			}
		} catch (error) {
			failures.push(error instanceof Error ? error.message : String(error));
		}
	}
	for (const name of index.keys()) {
		if (!graph.reachable.has(name)) failures.push(`${name}: unreachable production artifact`);
	}

	const duplicates = duplicateArtifacts(files, root);
	for (const names of duplicates) failures.push(`byte-identical production artifacts: ${names.join(', ')}`);

	let evidence = {
		boundaryReplications: [],
		outputClosures: [],
		redundantModules: [],
		sharedInputs: [],
		topContributors: [],
	};
	try {
		evidence = metafileEvidence(metafiles, root);
		for (const item of evidence.redundantModules) {
			failures.push(`${item.input}: repeated in shareable build domain (${item.builds.map((build) => build.name).join(', ')})`);
		}
	} catch (error) {
		failures.push(error instanceof Error ? error.message : String(error));
	}

	const javascript = files.filter((path) => extname(path) === '.js')
		.reduce((sum, path) => sum + statSync(path).size, 0);
	const total = files.reduce((sum, path) => sum + statSync(path).size, 0);
	const entrypoints = [...index.keys()]
		.filter((name) => extname(name) === '.js' && !name.includes('/'))
		.map((name) => {
			const staticClosure = artifactClosureFromIndex(index, [name], staticOptions);
			const possibleClosure = artifactClosureFromIndex(index, [name], eventualOptions);
			return {
				name,
				possible: {
					bytes: possibleClosure.bytes,
					names: possibleClosure.names,
					scriptBytes: possibleClosure.scriptBytes,
				},
				static: {
					bytes: staticClosure.bytes,
					names: staticClosure.names,
					scriptBytes: staticClosure.scriptBytes,
				},
			};
		})
		.sort((left, right) => left.name.localeCompare(right.name));

	const report = {
		artifactSha256: artifactSetDigest(files, root),
		boundaryReplications: evidence.boundaryReplications,
		documentStart,
		duplicates,
		entrypoints,
		failures: [...new Set(failures)].sort(),
		files: files.length,
		javascript,
		outputAttribution: {
			outputClosures: evidence.outputClosures,
			sharedInputs: evidence.sharedInputs,
			status: metafiles.length > 0 ? 'measured' : 'not-measured',
		},
		offscreenAudioOnly,
		offscreenRemote,
		reachable: graph.reachable.size,
		schemaVersion: 1,
		serviceWorkerWake,
		topContributors: evidence.topContributors,
		total,
	};
	report.headroomAdvisories = productionHeadroomAdvisories(report);
	report.failures.push(...productionBudgetFailures(report));
	report.failures = [...new Set(report.failures)].sort();
	return report;
}

export function assertProductionArtifactReport(report) {
	if (report.failures.length > 0) {
		throw new Error(`Production artifact integrity failed:\n${report.failures.join('\n')}`);
	}
	console.log(
		`✓ Production artifacts: ${report.reachable}/${report.files} reachable, 0 duplicate; `
		+ `service-worker wake ${format(report.serviceWorkerWake.scriptBytes)}, `
		+ `document_start ${format(report.documentStart.scriptBytes)}, `
		+ `JS ${format(report.javascript)}, dist ${format(report.total)}`,
	);
	if (report.headroomAdvisories.length > 0) {
		console.warn(`⚠ Production headroom advisory (non-blocking):\n${report.headroomAdvisories
			.map((finding) => `  ${finding.message}`)
			.join('\n')}`);
	}
	if (report.offscreenAudioOnly && report.offscreenRemote) {
		console.log(
			`✓ Offscreen closures: Capture-only ${format(report.offscreenAudioOnly.scriptBytes)}`
			+ ` | Remote eventual ${format(report.offscreenRemote.scriptBytes)}`,
		);
	}
	console.log(`✓ Entrypoint script closures: ${report.entrypoints
		.map((item) => `${item.name}:${format(item.static.scriptBytes)}→${format(item.possible.scriptBytes)}`)
		.join(' | ')}`);
	const runtimePayloads = report.entrypoints
		.map((item) => ({
			bytes: item.possible.bytes - item.possible.scriptBytes,
			name: item.name,
		}))
		.filter((item) => item.bytes > 0);
	if (runtimePayloads.length > 0) {
		console.log(`✓ Possible non-script payloads: ${runtimePayloads
			.map((item) => `${item.name}:${format(item.bytes)}`)
			.join(' | ')}`);
	}
	if (report.topContributors.length > 0) {
		console.log(`✓ Largest module contributions: ${report.topContributors
			.map((item) => `${item.path}:${format(item.bytes)}`)
			.join(' | ')}`);
	}
	if (report.boundaryReplications.length > 0) {
		console.log(`✓ ${report.boundaryReplications.length} shared source modules are isolated only across non-shareable Chrome runtime domains`);
	}
	return report;
}

export function checkProductionArtifacts(options) {
	return assertProductionArtifactReport(analyzeProductionArtifacts(options));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const projectDir = dirname(dirname(fileURLToPath(import.meta.url)));
	checkProductionArtifacts({ distDir: resolve(projectDir, 'dist') });
}

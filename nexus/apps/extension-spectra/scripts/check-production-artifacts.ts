import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
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
});

export function productionBudgetFailures(report) {
	const failures = [];
	const check = (label, actual, ceiling) => {
		if (actual > ceiling) failures.push(`${label}: ${actual} bytes exceeds production budget ${ceiling}`);
	};
	const entries = new Map(report.entrypoints.map((entry) => [entry.name, entry]));
	check('service-worker wake', report.serviceWorkerWake.scriptBytes, SPECTRA_PRODUCTION_BUDGETS.serviceWorkerWake);
	check('document_start', report.documentStart.scriptBytes, SPECTRA_PRODUCTION_BUDGETS.documentStart);
	check('content-bootstrap.js static closure', entries.get('content-bootstrap.js')?.staticBytes ?? 0, SPECTRA_PRODUCTION_BUDGETS.contentBootstrap);
	check('content-site-hotkeys.js static closure', entries.get('content-site-hotkeys.js')?.staticBytes ?? 0, SPECTRA_PRODUCTION_BUDGETS.contentSiteHotkeys);
	check('offscreen Capture-only closure', report.offscreenAudioOnly?.scriptBytes ?? 0, SPECTRA_PRODUCTION_BUDGETS.offscreenCapture);
	check('offscreen Remote eventual closure', report.offscreenRemote?.scriptBytes ?? 0, SPECTRA_PRODUCTION_BUDGETS.offscreenRemote);
	check('popup.js static closure', entries.get('popup.js')?.staticBytes ?? 0, SPECTRA_PRODUCTION_BUDGETS.popupStatic);
	return failures;
}

const KiB = 1024;
const REMOTE_RUNTIME_ASSET = 'peerjs-vendor.js';
const IMPORT_PATTERN = /(?:\bimport\s*(?:[^"'()]*?from\s*)?|\bimport\s*\()\s*["']([^"']+)["']/gu;
const STATIC_MODULE_REFERENCE_PATTERN = /\b(?:import\s*(?:[^"'()]*?\bfrom\s*)?|export\s+(?:[^"']*?\bfrom\s*))["']([^"']+)["']/gu;
const DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu;
const RUNTIME_MODULE_IMPORT_PATTERN = /\bimport\s*\(\s*chrome\.runtime\.getURL\(\s*["']([^"']+)["']\s*\)\s*\)/gu;
const HTML_SCRIPT_PATTERN = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/giu;
const RUNTIME_ASSET_PATTERN = /\bchrome\.runtime\.getURL\(\s*["']([^"']+)["']\s*\)/gu;
const HTML_REFERENCE_PATTERN = /\b(?:href|poster|src)\s*=\s*["']([^"']+)["']/giu;
const CSS_REFERENCE_PATTERN = /(?:@import\s+(?:url\()?|url\()\s*["']?([^"')\s]+)["']?\s*\)?/giu;
const STRING_LITERAL_PATTERN = /(["'`])((?:\\.|(?!\1)[\s\S])*)\1/gu;
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
		for (const match of source.matchAll(HTML_REFERENCE_PATTERN)) add(match[1], true);
	} else if (extension === '.css') {
		for (const match of source.matchAll(CSS_REFERENCE_PATTERN)) add(match[1], true);
	} else if (extension === '.js') {
		for (const match of source.matchAll(IMPORT_PATTERN)) {
			const specifier = match[1];
			if (!specifier || URL_SCHEME_PATTERN.test(specifier)) continue;
			if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
				throw new Error(`${name}: bare production import is forbidden (${specifier})`);
			}
			add(specifier, true);
		}
		for (const match of source.matchAll(STRING_LITERAL_PATTERN)) add(match[2]);
	}
	return [...new Set(references)];
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
		for (const match of source.matchAll(HTML_SCRIPT_PATTERN)) add(match[1], 'html-script');
	} else if (extension === '.js') {
		for (const match of source.matchAll(STATIC_MODULE_REFERENCE_PATTERN)) {
			add(match[1], 'js-static');
		}
		for (const match of source.matchAll(DYNAMIC_IMPORT_PATTERN)) add(match[1], 'js-deferred');
		for (const match of source.matchAll(RUNTIME_MODULE_IMPORT_PATTERN)) {
			add(match[1], 'js-deferred');
		}
		for (const match of source.matchAll(RUNTIME_ASSET_PATTERN)) {
			if (match[1] === REMOTE_RUNTIME_ASSET) add(match[1], 'runtime-asset');
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

function metafileEvidence(metafiles) {
	const owners = new Map();
	const contributors = new Map();
	for (const build of metafiles) {
		if (!build?.metafile || typeof build.sharingDomain !== 'string') {
			throw new Error('Every production metafile requires one explicit sharingDomain');
		}
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
		.sort((left, right) => right.bytes - left.bytes || left.path.localeCompare(right.path))
		.slice(0, 8);
	return { boundaryReplications, redundantModules, topContributors };
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
						if (reference.kind === 'runtime-asset'
							&& reference.target === REMOTE_RUNTIME_ASSET) peerParents.push(name);
					}
				}
				if (peerParents.length !== 1) {
					failures.push('peerjs-vendor.js: exactly one Remote runtime-asset owner is required');
				} else if (offscreenAudioOnly.names.includes(peerParents[0])) {
					failures.push('peerjs-vendor.js: runtime loader must stay outside the Capture-only closure');
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

	let evidence = { boundaryReplications: [], redundantModules: [], topContributors: [] };
	try {
		evidence = metafileEvidence(metafiles);
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
			const eventualClosure = artifactClosureFromIndex(index, [name], eventualOptions);
			return {
				name,
				eventualBytes: eventualClosure.bytes,
				staticBytes: staticClosure.bytes,
			};
		})
		.sort((left, right) => left.name.localeCompare(right.name));

	const report = {
		boundaryReplications: evidence.boundaryReplications,
		documentStart,
		duplicates,
		entrypoints,
		failures: [...new Set(failures)].sort(),
		files: files.length,
		javascript,
		offscreenAudioOnly,
		offscreenRemote,
		reachable: graph.reachable.size,
		serviceWorkerWake,
		topContributors: evidence.topContributors,
		total,
	};
	report.failures.push(...productionBudgetFailures(report));
	report.failures = [...new Set(report.failures)].sort();
	return report;
}

export function checkProductionArtifacts(options) {
	const report = analyzeProductionArtifacts(options);
	if (report.failures.length > 0) {
		throw new Error(`Production artifact integrity failed:\n${report.failures.join('\n')}`);
	}
	console.log(
		`✓ Production artifacts: ${report.reachable}/${report.files} reachable, 0 duplicate; `
		+ `service-worker wake ${format(report.serviceWorkerWake.scriptBytes)}, `
		+ `document_start ${format(report.documentStart.scriptBytes)}, `
		+ `JS ${format(report.javascript)}, dist ${format(report.total)}`,
	);
	if (report.offscreenAudioOnly && report.offscreenRemote) {
		console.log(
			`✓ Offscreen closures: Capture-only ${format(report.offscreenAudioOnly.scriptBytes)}`
			+ ` | Remote eventual ${format(report.offscreenRemote.scriptBytes)}`,
		);
	}
	console.log(`✓ Entrypoint closures: ${report.entrypoints
		.map((item) => `${item.name}:${format(item.staticBytes)}→${format(item.eventualBytes)}`)
		.join(' | ')}`);
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const projectDir = dirname(dirname(fileURLToPath(import.meta.url)));
	checkProductionArtifacts({ distDir: resolve(projectDir, 'dist') });
}

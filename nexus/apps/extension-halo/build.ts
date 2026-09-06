/**
 * HALO Build Script (esbuild)
 * goal: keep startup surfaces physically isolated and production output lean
 * output: compressed single-line logs per step
 */

import esbuild from 'esbuild';
import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { measureContentStartupSurfaces } from './build-runtime-surfaces';
import {
	assertActivationClosureBudget,
	measureDynamicActivationClosures,
} from './build-activation-closures';
import {
	RELEASE_CONTENT_SCRIPTS,
	RELEASE_SCRIPT_RUNTIME_IDS,
	RELEASE_WEB_ACCESSIBLE_RUNTIME_ENTRIES,
} from './src/kernel/registry/_generated-release-admission';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isWatch = process.argv.includes('--watch');
const isDev = process.argv.includes('--dev') || isWatch;
const isAnalyze = process.argv.includes('--analyze');
const distDir = path.join(__dirname, 'dist');
const sourceManifest = JSON.parse(
	readFileSync(path.join(__dirname, 'public/manifest.json'), 'utf8'),
);
const minimumChromeMajor = Number.parseInt(String(sourceManifest.minimum_chrome_version ?? ''), 10);
if (!Number.isSafeInteger(minimumChromeMajor) || minimumChromeMajor < 100) {
	throw new Error(`HALO manifest has invalid minimum_chrome_version: ${String(sourceManifest.minimum_chrome_version)}`);
}
const BROWSER_TARGET = `chrome${minimumChromeMajor}`;

// Production ceilings are audited regression gates, not aspirations:
// intentional growth requires an explicit architecture + budget change.
const PRODUCTION_BUDGET_KIB = Object.freeze({
	background: 32,
	allFrameDocumentStart: 1,
	topFrameDocumentStart: 26,
	// Preserve the existing explicitly enabled clipboard host; admission is not a feature deletion.
	allFrameDocumentIdle: 2,
	topFrameDocumentIdle: 14,
	sidepanelStartup: 36,
	frameToolsRuntime: 8,
	hoverZoomRuntime: 52,
	sidepanelEventualChunks: 1850,
	largestSidepanelChunk: 500,
	maxSidepanelActivation: 1100,
});

// HALO keeps React types and source compatibility, but the SidePanel's one
// renderer-owned graph is emitted through Preact compat to avoid shipping both
// ReactDOM and Preact. Content scripts and the background never receive these aliases.
const SIDEPANEL_RENDERER_ALIAS = Object.freeze({
	'react/jsx-dev-runtime': 'preact/jsx-dev-runtime',
	'react/jsx-runtime': 'preact/jsx-runtime',
	'react-dom/client': 'preact/compat/client',
	'react-dom': 'preact/compat',
	react: 'preact/compat',
});

function run(label, args, opts = {}) {
	const { silent = false, ...processOptions } = opts;
	try {
		execFileSync(process.execPath, args, {
			stdio: 'pipe',
			cwd: __dirname,
			...processOptions,
		});
		return true;
	} catch (e) {
		if (silent) return false;
		const stderr = e.stderr?.toString().trim();
		const stdout = e.stdout?.toString().trim();
		console.error(`❌ ${label}: ${stderr || stdout || e.message}`);
		return false;
	}
}

const commonConfig = {
	bundle: true,
	treeShaking: true,
	minify: !isDev,
	legalComments: 'none',
	sourcemap: isDev,
	target: BROWSER_TARGET,
	define: { 'process.env.NODE_ENV': isDev ? '"development"' : '"production"' },
	pure: isDev ? [] : ['console.debug', 'console.info', 'console.log'],
	drop: isDev ? [] : ['debugger'],
	loader: { '.ts': 'ts', '.tsx': 'tsx' },
	alias: {
		'@nexus/kernel': path.resolve(__dirname, '../../packages/nexus-kernel/dist/index.js'),
		'@nexus/ui-kit': path.resolve(__dirname, '../../packages/ui-kit/dist/index.js'),
	},
};

if (!isWatch) {
	const registryPath = path.resolve(__dirname, '../../scripts/generate-tool-registry.ts');

	if (existsSync(registryPath)) {
		if (!run('registry', ['../../scripts/generate-tool-registry.ts', '--check'], { silent: true })) {
			console.error('❌ generated registry projection is stale; run bun run generate-registry');
			process.exit(1);
		}
	}
	console.log('✓ Pre-flight: generated registry current');
}

if (existsSync(distDir)) {
	rmSync(distDir, {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 100,
	});
}
mkdirSync(distDir, { recursive: true });
cpSync(path.join(__dirname, 'public'), distDir, { recursive: true });

const toolsDir = path.join(__dirname, 'src/tools');
const scriptsDir = path.join(__dirname, 'src/scripts');
const distToolsDir = path.join(distDir, 'tools');
const distScriptsDir = path.join(distDir, 'scripts');
const releaseScriptRuntimeIds = new Set<string>(RELEASE_SCRIPT_RUNTIME_IDS);
const scriptBuildAnalyses = [];

mkdirSync(distToolsDir, { recursive: true });
mkdirSync(distScriptsDir, { recursive: true });

async function buildScriptFiles(sourceDir, destBaseDir) {
	if (!existsSync(sourceDir)) return 0;
	const dirs = readdirSync(sourceDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && releaseScriptRuntimeIds.has(entry.name));

	const promises = dirs.map(async (dir) => {
		const scriptJs = path.join(sourceDir, dir.name, 'script.js');
		const scriptCss = path.join(sourceDir, dir.name, 'script.css');
		const scriptTs = path.join(sourceDir, dir.name, 'script.ts');
		const destDir = path.join(destBaseDir, dir.name);
		let built = false;

		if (existsSync(scriptJs) || existsSync(scriptTs)) {
			mkdirSync(destDir, { recursive: true });
			try {
				const sourceEntry = existsSync(scriptTs) ? scriptTs : scriptJs;
				const result = await esbuild.build({
					entryPoints: [sourceEntry],
					outfile: path.join(destDir, 'script.js'),
					bundle: true,
					minify: !isDev,
					sourcemap: isDev ? 'inline' : false,
					target: BROWSER_TARGET,
					format: 'esm',
					legalComments: 'none',
					logLevel: 'silent',
					metafile: isAnalyze,
				});
				if (isAnalyze && result.metafile) {
					scriptBuildAnalyses.push({
						id: dir.name,
						source: path.relative(__dirname, sourceEntry).replaceAll('\\', '/'),
						output: path.relative(distDir, path.join(destDir, 'script.js')).replaceAll('\\', '/'),
						outputs: Object.fromEntries(
							Object.entries(result.metafile.outputs)
								.map(([output, detail]) => [
									relativeDist(path.resolve(__dirname, output)),
									{ bytes: detail.bytes, entryPoint: detail.entryPoint, imports: detail.imports, inputs: detail.inputs },
								])
								.sort(([left], [right]) => left.localeCompare(right)),
						),
					});
				}
				built = true;
			} catch (e) {
				console.error(`❌ Failed to build script ${dir.name}:`, e.message);
			}
		}
		if (existsSync(scriptCss)) {
			mkdirSync(destDir, { recursive: true });
			copyFileSync(scriptCss, path.join(destDir, 'script.css'));
			built = true;
		}
		return built ? 1 : 0;
	});

	const results = await Promise.all(promises);
	return results.reduce((total, value) => total + value, 0);
}

const [toolScriptsCount, officialScriptsCount] = await Promise.all([
	buildScriptFiles(toolsDir, distToolsDir),
	buildScriptFiles(scriptsDir, distScriptsDir),
]);

const entries = [
	{ entry: 'src/entry/content.ts', out: 'content.js', kind: 'classic' },
	...RELEASE_CONTENT_SCRIPTS.map(({ entry, js }) => ({ entry, out: js, kind: 'classic' })),
	...RELEASE_WEB_ACCESSIBLE_RUNTIME_ENTRIES.map(({ entry, output }) => ({
		entry,
		out: output,
		kind: 'module',
	})),
	{ entry: 'src/entry/background.ts', out: 'background.js', kind: 'classic' },
	{ entry: 'src/entry/sidepanel.tsx', out: 'sidepanel.js', kind: 'sidepanel' },
	{ entry: 'src/entry/sidepanel-init.ts', out: 'sidepanel-init.js', kind: 'classic' },
];
const entryOutputs = entries.map(({ out }) => out);
if (new Set(entryOutputs).size !== entryOutputs.length) {
	throw new Error('HALO generated build entry projection contains duplicate outputs');
}

function buildOptions({ entry, out, kind }, extra = {}) {
	if (kind === 'sidepanel') {
		return {
			...commonConfig,
			alias: { ...commonConfig.alias, ...SIDEPANEL_RENDERER_ALIAS },
			entryPoints: { sidepanel: entry },
			outdir: distDir,
			entryNames: '[name]',
			chunkNames: 'chunks/[name]-[hash]',
			format: 'esm',
			splitting: true,
			...extra,
		};
	}
	if (kind === 'module') {
		return {
			...commonConfig,
			entryPoints: [entry],
			outfile: path.join(distDir, out),
			format: 'esm',
			...extra,
		};
	}
	return {
		...commonConfig,
		entryPoints: [entry],
		outfile: path.join(distDir, out),
		...extra,
	};
}

function walkFiles(directory) {
	if (!existsSync(directory)) return [];
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const candidate = path.join(directory, entry.name);
		return entry.isDirectory() ? walkFiles(candidate) : [candidate];
	});
}

function relativeDist(file) {
	return path.relative(distDir, file).replaceAll('\\', '/');
}

function kib(bytes) {
	return Math.ceil(bytes / 1024);
}

function outputAbsolute(output) {
	return path.normalize(path.resolve(__dirname, output));
}

/**
 * Sum the physical files that execute before any dynamic import boundary.
 * This is a startup parse/compile closure, not the entry file alone and not
 * the total bytes of every future lazy feature chunk.
 */
function staticOutputClosure(metafile, entryOutput) {
	if (!metafile?.outputs) return null;
	const outputs = new Map(
		Object.entries(metafile.outputs).map(([output, detail]) => [outputAbsolute(output), detail]),
	);
	const start = path.normalize(path.join(distDir, entryOutput));
	if (!outputs.has(start)) return null;

	const visited = new Set();
	const outputBytes = new Map();
	const stack = [start];
	let bytes = 0;
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current || visited.has(current)) continue;
		const detail = outputs.get(current);
		if (!detail) continue;
		visited.add(current);
		outputBytes.set(current, detail.bytes);
		bytes += detail.bytes;

		for (const imported of detail.imports ?? []) {
			if (imported.external || imported.kind === 'dynamic-import') continue;
			const target = path.normalize(path.resolve(path.dirname(current), imported.path));
			if (outputs.has(target) && !visited.has(target)) stack.push(target);
		}
	}
	return { bytes, fileCount: visited.size, outputBytes };
}

/** Attribute the complete static closure to the source modules esbuild retained. */
function largestStaticClosureInputs(metafile, closure, limit = 12) {
	if (!metafile?.outputs || !closure?.outputBytes) return [];
	const outputs = new Map(
		Object.entries(metafile.outputs).map(([output, detail]) => [outputAbsolute(output), detail]),
	);
	const aggregated = new Map();

	for (const output of closure.outputBytes.keys()) {
		const detail = outputs.get(output);
		if (!detail) continue;
		for (const [input, stats] of Object.entries(detail.inputs ?? {})) {
			const normalizedInput = path
				.relative(__dirname, path.resolve(__dirname, input))
				.replaceAll('\\', '/');
			const bytes = stats.bytesInOutput ?? 0;
			if (bytes <= 0) continue;
			aggregated.set(normalizedInput, (aggregated.get(normalizedInput) ?? 0) + bytes);
		}
	}

	return [...aggregated.entries()]
		.map(([input, bytes]) => ({ input, bytes }))
		.sort((left, right) => right.bytes - left.bytes || left.input.localeCompare(right.input))
		.slice(0, limit);
}

function assertProductionSidepanelSplitting() {
	if (isDev) return;
	const chunksDir = path.join(distDir, 'chunks');
	const chunks = walkFiles(chunksDir).filter((file) => file.endsWith('.js'));
	if (chunks.length === 0) {
		throw new Error(
			'HALO production sidepanel emitted no lazy chunks; React.lazy imports must remain physically split',
		);
	}
}

function assertProductionSidepanelRenderer(metafile) {
	if (isDev) return;
	const inputs = Object.keys(metafile?.inputs ?? {}).map((input) => input.replaceAll('\\', '/'));
	const reactRuntimeInputs = inputs.filter((input) => (
		/(^|\/)node_modules\/(react|react-dom|scheduler)(\/|@)/u.test(input)
		|| /react-dom\.production\.min\.js$/u.test(input)
	));
	if (reactRuntimeInputs.length > 0) {
		throw new Error(`HALO SidePanel retained React runtime inputs: ${reactRuntimeInputs.join(', ')}`);
	}
	if (!inputs.some((input) => /(^|\/)node_modules\/preact(\/|@)/u.test(input))) {
		throw new Error('HALO SidePanel emitted no Preact runtime input');
	}
}

function assertProductionBudgets(measurements) {
	if (isDev) return;
	for (const [name, bytes] of Object.entries(measurements)) {
		const budget = PRODUCTION_BUDGET_KIB[name];
		if (budget === undefined) throw new Error(`HALO production budget is missing for ${name}`);
		const actual = kib(bytes);
		if (actual > budget) {
			throw new Error(
				`HALO production budget exceeded: ${name}=${actual}KiB > ${budget}KiB. `
				+ 'Intentional growth requires an explicit architecture and budget update.',
			);
		}
	}
}

if (isWatch) {
	console.log('👀 Watch mode...');
	const contexts = await Promise.all(entries.map(async (entry) => {
		const ctx = await esbuild.context(buildOptions(entry, {
			logLevel: 'warning',
			plugins: [{
				name: 'rebuild-notify',
				setup(build) {
					build.onEnd((result) => {
						if (result.errors.length === 0) console.log(`✓ ${entry.out}`);
					});
				},
			}],
		}));
		await ctx.watch();
		return ctx;
	}));

	process.on('SIGINT', async () => {
		await Promise.all(contexts.map((ctx) => ctx.dispose()));
		process.exit(0);
	});
} else {
	const buildResults = await Promise.all(entries.map(async (entry) => {
		try {
			const result = await esbuild.build(buildOptions(entry, {
				write: true,
				// Every production entry retains an in-memory metafile because startup
				// accounting follows the complete static closure declared by manifest
				// frame/lifecycle scope. Dev builds keep the SidePanel closure for its
				// physical lazy-loading invariant; --analyze retains all domains.
				metafile: !isDev || entry.kind === 'sidepanel' || isAnalyze,
			}));
			const bytes = statSync(path.join(distDir, entry.out)).size;
			return { entry, result, bytes, label: `${entry.out.replace('.js', '')}:${kib(bytes)}KB` };
		} catch (e) {
			console.error(`❌ ${entry.out}: ${e.message}`);
			process.exit(1);
		}
	}));

	assertProductionSidepanelSplitting();

	const byOutput = new Map(buildResults.map((item) => [item.entry.out, item]));
	const resultFor = (output) => {
		const result = byOutput.get(output);
		if (!result) throw new Error(`HALO manifest/build output is missing: ${output}`);
		return result;
	};
	const sizeOf = (output) => resultFor(output).bytes;
	const closureFor = (output) => {
		const result = resultFor(output);
		const closure = staticOutputClosure(result.result.metafile, output);
		if (!closure) {
			throw new Error(`HALO static startup closure could not be resolved for manifest output ${output}`);
		}
		return closure;
	};
	const {
		allFrameDocumentStart,
		topFrameDocumentStart,
		allFrameDocumentIdle,
		topFrameDocumentIdle,
	} = measureContentStartupSurfaces(sourceManifest, closureFor);

	const sidepanelResult = resultFor('sidepanel.js');
	assertProductionSidepanelRenderer(sidepanelResult.result.metafile);
	const sidepanelStartup = staticOutputClosure(sidepanelResult.result.metafile, 'sidepanel.js');
	if (!sidepanelStartup) {
		throw new Error('HALO SidePanel startup closure could not be resolved from the esbuild metafile');
	}
	const sidepanelTopInputs = largestStaticClosureInputs(
		sidepanelResult.result.metafile,
		sidepanelStartup,
	);
	const chunkFiles = walkFiles(path.join(distDir, 'chunks')).filter((file) => file.endsWith('.js'));
	const chunkBytes = chunkFiles.reduce((total, file) => total + statSync(file).size, 0);
	const largestChunkBytes = chunkFiles.reduce(
		(largest, file) => Math.max(largest, statSync(file).size),
		0,
	);
	const activationClosures = measureDynamicActivationClosures(
		sidepanelResult.result.metafile,
		__dirname,
	);
	assertActivationClosureBudget(
		activationClosures,
		PRODUCTION_BUDGET_KIB.maxSidepanelActivation,
	);
	const maxSidepanelActivation = activationClosures[0]?.bytes ?? 0;

	const budgetMeasurements = {
		background: sizeOf('background.js'),
		allFrameDocumentStart,
		topFrameDocumentStart,
		allFrameDocumentIdle,
		topFrameDocumentIdle,
		sidepanelStartup: sidepanelStartup.bytes,
		frameToolsRuntime: sizeOf('tools/_frame-tools/runtime.js'),
		hoverZoomRuntime: sizeOf('tools/_hover-zoom/runtime.js'),
		sidepanelEventualChunks: chunkBytes,
		largestSidepanelChunk: largestChunkBytes,
		maxSidepanelActivation,
	};
	assertProductionBudgets(budgetMeasurements);

	if (isAnalyze) {
		const report = {
			budgetsKiB: PRODUCTION_BUDGET_KIB,
			runtimeSurfaces: {
				allFrameDocumentStartBytes: allFrameDocumentStart,
				topFrameDocumentStartBytes: topFrameDocumentStart,
				allFrameDocumentIdleBytes: allFrameDocumentIdle,
				topFrameDocumentIdleBytes: topFrameDocumentIdle,
				sidepanelStartupBytes: sidepanelStartup.bytes,
				sidepanelStartupFiles: sidepanelStartup.fileCount,
				backgroundBytes: sizeOf('background.js'),
			},
			sidepanelTopInputs,
			sidepanelActivationClosures: activationClosures,
			scriptRuntimeBuilds: scriptBuildAnalyses.sort((left, right) => left.id.localeCompare(right.id)),
			entries: buildResults.map(({ entry, result }) => ({
				entry: entry.out,
				kind: entry.kind,
				outputs: Object.fromEntries(
					Object.entries(result.metafile?.outputs ?? {})
						.map(([output, detail]) => [
							relativeDist(path.resolve(__dirname, output)),
							{ bytes: detail.bytes, entryPoint: detail.entryPoint, imports: detail.imports, inputs: detail.inputs },
						])
						.sort(([left], [right]) => left.localeCompare(right)),
				),
			})),
		};
		writeFileSync(
			path.join(distDir, 'build-analysis.json'),
			`${JSON.stringify(report, null, 2)}\n`,
		);
	}

	const chunkInfo = chunkFiles.length > 0
		? ` | chunks:${chunkFiles.length}/${kib(chunkBytes)}KB`
		: '';
	const saatInfo = toolScriptsCount + officialScriptsCount > 0
		? ` | SaaT:${toolScriptsCount + officialScriptsCount}`
		: '';
	console.log(`✓ Build: ${buildResults.map(({ label }) => label).join(' | ')}${chunkInfo}${saatInfo}`);
	console.log(
		`✓ Startup closures: all-frame@start:${kib(allFrameDocumentStart)}KB | top-frame@start:${kib(topFrameDocumentStart)}KB | all-frame@idle:${kib(allFrameDocumentIdle)}KB | top-frame@idle:${kib(topFrameDocumentIdle)}KB | sidepanel:${kib(sidepanelStartup.bytes)}KB/${sidepanelStartup.fileCount} files | background:${kib(sizeOf('background.js'))}KB`,
	);
	if (!isDev) {
		console.log(`✓ SidePanel contributors: ${sidepanelTopInputs.map(({ input, bytes }) => `${input}:${(bytes / 1024).toFixed(1)}KiB`).join(' | ')}`);
		console.log(`✓ Largest SidePanel activation: ${activationClosures[0]?.entryPoint ?? activationClosures[0]?.target ?? 'none'}:${kib(maxSidepanelActivation)}KiB/${activationClosures[0]?.fileCount ?? 0} files`);
	}
	console.log(`✓ Browser target: Chrome ${minimumChromeMajor}+`);
	console.log('✓ Production budgets:', Object.entries(PRODUCTION_BUDGET_KIB).map(([name, value]) => `${name}<=${value}KiB`).join(' | '));
	console.log('🎉 Done → dist/');
}

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
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isWatch = process.argv.includes('--watch');
const isDev = process.argv.includes('--dev') || isWatch;
const isAnalyze = process.argv.includes('--analyze');
const distDir = path.join(__dirname, 'dist');

// Production ceilings are the audited KiB buckets from the 2026-08-08
// cross-platform production build. They are regression gates, not aspirations:
// intentional growth requires an explicit architecture + budget change.
const PRODUCTION_BUDGET_KIB = Object.freeze({
	background: 14,
	allFrameDocumentStart: 31,
	topFrameDocumentStart: 32,
	allFrameDocumentIdle: 2,
	topFrameDocumentIdle: 55,
	sidepanelStartup: 165,
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
	const verifyPath = path.resolve(__dirname, '../../scripts/verify-architecture.ts');

	if (existsSync(registryPath)) {
		if (!run('registry', ['../../scripts/generate-tool-registry.ts'], { silent: true })) {
			console.error('❌ registry generation failed');
			process.exit(1);
		}
	}
	if (existsSync(verifyPath)) {
		if (!run('verify', ['../../scripts/verify-architecture.ts'], { silent: true })) {
			console.error('❌ verify failed');
			process.exit(1);
		}
	}

	if (!run('tsc', ['tsc', '--noEmit', '--skipLibCheck'])) {
		process.exit(1);
	}
	console.log('✓ Pre-flight: tsc OK');
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

mkdirSync(distToolsDir, { recursive: true });
mkdirSync(distScriptsDir, { recursive: true });

async function buildScriptFiles(sourceDir, destBaseDir) {
	if (!existsSync(sourceDir)) return 0;
	const dirs = readdirSync(sourceDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());

	const promises = dirs.map(async (dir) => {
		const scriptJs = path.join(sourceDir, dir.name, 'script.js');
		const scriptCss = path.join(sourceDir, dir.name, 'script.css');
		const scriptTs = path.join(sourceDir, dir.name, 'script.ts');
		const destDir = path.join(destBaseDir, dir.name);
		let built = false;

		if (existsSync(scriptJs) || existsSync(scriptTs)) {
			mkdirSync(destDir, { recursive: true });
			try {
				await esbuild.build({
					entryPoints: [existsSync(scriptTs) ? scriptTs : scriptJs],
					outfile: path.join(destDir, 'script.js'),
					bundle: true,
					minify: !isDev,
					sourcemap: isDev ? 'inline' : false,
					target: ['chrome100'],
					format: 'esm',
					legalComments: 'none',
					logLevel: 'silent',
				});
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
	{ entry: 'src/entry/content-smooth-scroll.ts', out: 'content-smooth-scroll.js', kind: 'classic' },
	{ entry: 'src/entry/content-frame-tools.ts', out: 'content-frame-tools.js', kind: 'classic' },
	{ entry: 'src/entry/content-hover-zoom.ts', out: 'content-hover-zoom.js', kind: 'classic' },
	{ entry: 'src/entry/content-clipboard.ts', out: 'content-clipboard.js', kind: 'classic' },
	{ entry: 'src/entry/background.ts', out: 'background.js', kind: 'classic' },
	{ entry: 'src/entry/sidepanel.tsx', out: 'sidepanel.js', kind: 'sidepanel' },
	{ entry: 'src/entry/sidepanel-init.ts', out: 'sidepanel-init.js', kind: 'classic' },
];

function buildOptions({ entry, out, kind }, extra = {}) {
	if (kind === 'sidepanel') {
		return {
			...commonConfig,
			entryPoints: { sidepanel: entry },
			outdir: distDir,
			entryNames: '[name]',
			chunkNames: 'chunks/[name]-[hash]',
			format: 'esm',
			splitting: true,
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
 * Sum the files that execute before any dynamic import boundary.
 * This is the SidePanel cold-start parse/compile closure, not the entry file
 * alone and not the total bytes of every future lazy tool chunk.
 */
function staticOutputClosure(metafile, entryOutput) {
	if (!metafile?.outputs) return null;
	const outputs = new Map(
		Object.entries(metafile.outputs).map(([output, detail]) => [outputAbsolute(output), detail]),
	);
	const start = path.normalize(path.join(distDir, entryOutput));
	if (!outputs.has(start)) return null;

	const visited = new Set();
	const stack = [start];
	let bytes = 0;
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current || visited.has(current)) continue;
		const detail = outputs.get(current);
		if (!detail) continue;
		visited.add(current);
		bytes += detail.bytes;

		for (const imported of detail.imports ?? []) {
			if (imported.external || imported.kind === 'dynamic-import') continue;
			const target = path.normalize(path.resolve(path.dirname(current), imported.path));
			if (outputs.has(target) && !visited.has(target)) stack.push(target);
		}
	}
	return { bytes, files: visited.size };
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
				// SidePanel metafile is always retained in memory because startup
				// closure is a production performance invariant. Other domains emit
				// full analysis only on explicit --analyze builds.
				metafile: entry.kind === 'sidepanel' || isAnalyze,
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
	const sizeOf = (output) => byOutput.get(output)?.bytes ?? 0;
	const allFrameDocumentStart = sizeOf('content-smooth-scroll.js') + sizeOf('content-frame-tools.js');
	const topFrameDocumentStart = allFrameDocumentStart + sizeOf('content.js');
	const allFrameDocumentIdle = sizeOf('content-clipboard.js');
	const topFrameDocumentIdle = allFrameDocumentIdle + sizeOf('content-hover-zoom.js');

	const sidepanelResult = byOutput.get('sidepanel.js');
	const sidepanelStartup = staticOutputClosure(sidepanelResult?.result.metafile, 'sidepanel.js');
	if (!sidepanelStartup) {
		throw new Error('HALO SidePanel startup closure could not be resolved from the esbuild metafile');
	}

	const budgetMeasurements = {
		background: sizeOf('background.js'),
		allFrameDocumentStart,
		topFrameDocumentStart,
		allFrameDocumentIdle,
		topFrameDocumentIdle,
		sidepanelStartup: sidepanelStartup.bytes,
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
				sidepanelStartupFiles: sidepanelStartup.files,
				backgroundBytes: sizeOf('background.js'),
			},
			entries: buildResults.map(({ entry, result }) => ({
				entry: entry.out,
				kind: entry.kind,
				outputs: Object.fromEntries(
					Object.entries(result.metafile?.outputs ?? {})
						.map(([output, detail]) => [
							relativeDist(path.resolve(__dirname, output)),
							{ bytes: detail.bytes, entryPoint: detail.entryPoint, imports: detail.imports },
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

	const chunkFiles = walkFiles(path.join(distDir, 'chunks')).filter((file) => file.endsWith('.js'));
	const chunkBytes = chunkFiles.reduce((total, file) => total + statSync(file).size, 0);
	const chunkInfo = chunkFiles.length > 0
		? ` | chunks:${chunkFiles.length}/${kib(chunkBytes)}KB`
		: '';
	const saatInfo = toolScriptsCount + officialScriptsCount > 0
		? ` | SaaT:${toolScriptsCount + officialScriptsCount}`
		: '';
	console.log(`✓ Build: ${buildResults.map(({ label }) => label).join(' | ')}${chunkInfo}${saatInfo}`);
	console.log(
		`✓ Startup closures: all-frame@start:${kib(allFrameDocumentStart)}KB | top-frame@start:${kib(topFrameDocumentStart)}KB | all-frame@idle:${kib(allFrameDocumentIdle)}KB | top-frame@idle:${kib(topFrameDocumentIdle)}KB | sidepanel:${kib(sidepanelStartup.bytes)}KB/${sidepanelStartup.files} files | background:${kib(sizeOf('background.js'))}KB`,
	);
	console.log('✓ Production budgets:', Object.entries(PRODUCTION_BUDGET_KIB).map(([name, value]) => `${name}<=${value}KiB`).join(' | '));
	console.log('🎉 Done → dist/');
}

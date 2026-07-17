/**
 * SPECTRA esbuild pipeline.
 * Default output is a minified production extension; development modes are explicit.
 */

import esbuild from 'esbuild';
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { checkBundleBudget } from './scripts/check-bundle-budget.mjs';
import { writeI18nAssets } from './scripts/i18n-assets.ts';

const projectDir = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(projectDir, 'dist');
const publicDir = resolve(projectDir, 'public');
const packageJson = JSON.parse(readFileSync(resolve(projectDir, 'package.json'), 'utf8'));
const version = packageJson.version;

const isWatch = process.argv.includes('--watch');
const isDev = process.argv.includes('--dev') || isWatch;
const isAnalyze = process.argv.includes('--analyze');
const emitSourceMap = process.argv.includes('--sourcemap');

const entries = [
	{ entry: 'src/background/index.ts', out: 'background.js' },
	{ entry: 'src/content/core/bootstrap.ts', out: 'content-bootstrap.js' },
	{ entry: 'src/content/core/index.ts', out: 'content-runtime.js' },
	{ entry: 'src/popup/index.ts', out: 'popup.js' },
	{ entry: 'src/offscreen/index.ts', out: 'offscreen.js' },
	{ entry: 'src/options/index.ts', out: 'options.js' },
];

const isolatedEntries = entries.filter(({ out }) => out.startsWith('content-'));
const moduleEntries = entries.filter(({ out }) => !out.startsWith('content-'));

function runTypecheck() {
	try {
		execFileSync(process.execPath, ['tsc', '--noEmit', '--skipLibCheck'], { cwd: projectDir, stdio: 'pipe' });
	} catch (error) {
		const detail = [error.stdout, error.stderr]
			.map((stream) => stream?.toString().trim())
			.filter(Boolean)
			.join('\n') || error.message;
		throw new Error(`TypeScript check failed:\n${detail}`);
	}
}

function prepareDist() {
	rmSync(distDir, { recursive: true, force: true });
	mkdirSync(distDir, { recursive: true });
	cpSync(publicDir, distDir, { recursive: true });

	const manifestPath = resolve(distDir, 'manifest.json');
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	manifest.version = version;
	writeFileSync(
		manifestPath,
		isDev ? `${JSON.stringify(manifest, null, 2)}\n` : JSON.stringify(manifest),
	);

	const popupPath = resolve(distDir, 'popup.html');
	if (existsSync(popupPath)) {
		const mode = isDev ? 'Dev' : 'Prod';
		const popup = readFileSync(popupPath, 'utf8')
			.replace(/v\d+\.\d+\.\d+\s*•\s*(?:Build|Dev|Prod)/, `v${version} • ${mode}`);
		writeFileSync(popupPath, popup);
	}
}

// Production markup is shipped as-is by Chrome. Collapse formatting whitespace
// without touching quoted attribute values, so source HTML can stay readable.
function minifyHtml(source) {
	const withoutComments = source.replace(/<!--[\s\S]*?-->/gu, '');
	let output = '';
	let inTag = false;
	let quote = '';
	let pendingWhitespace = false;
	for (const character of withoutComments) {
		if (quote) {
			output += character;
			if (character === quote) quote = '';
			continue;
		}
		if (inTag && (character === '"' || character === "'")) {
			if (pendingWhitespace && output.at(-1) !== '<') output += ' ';
			pendingWhitespace = false;
			quote = character;
			output += character;
			continue;
		}
		if (/\s/u.test(character)) {
			pendingWhitespace = true;
			continue;
		}
		if (pendingWhitespace) {
			const previous = output.at(-1);
			if (previous
				&& previous !== '<'
				&& character !== '>'
				&& !(previous === '>' && character === '<')) output += ' ';
			pendingWhitespace = false;
		}
		output += character;
		if (character === '<') inTag = true;
		else if (character === '>') inTag = false;
	}
	return output.trim();
}

function minifyProductionAssets() {
	if (isDev) return;
	for (const name of ['popup.html', 'options.html', 'offscreen.html']) {
		const path = resolve(distDir, name);
		if (existsSync(path)) writeFileSync(path, minifyHtml(readFileSync(path, 'utf8')));
	}

	const localesDir = resolve(distDir, '_locales');
	if (!existsSync(localesDir)) return;
	for (const locale of readdirSync(localesDir, { withFileTypes: true })) {
		if (!locale.isDirectory()) continue;
		const path = resolve(localesDir, locale.name, 'messages.json');
		if (!existsSync(path)) continue;
		writeFileSync(path, JSON.stringify(JSON.parse(readFileSync(path, 'utf8'))));
	}
}

async function minifyProductionStyles() {
	if (isDev) return;
	for (const name of ['popup.css', 'options.css']) {
		const path = resolve(distDir, name);
		if (!existsSync(path)) continue;
		const result = await esbuild.transform(readFileSync(path, 'utf8'), {
			loader: 'css',
			minify: true,
			legalComments: 'none',
		});
		writeFileSync(path, result.code);
	}
}

function assertProductionJavaScript() {
	if (isDev) return;
	const diagnosticCalls = [];
	for (const path of walkFiles(distDir).filter((candidate) => candidate.endsWith('.js'))) {
		if (/\bconsole\.(?:debug|info|log)\s*\(/u.test(readFileSync(path, 'utf8'))) {
			diagnosticCalls.push(path.slice(distDir.length + 1).replaceAll('\\', '/'));
		}
	}
	if (diagnosticCalls.length > 0) {
		throw new Error(`Production bundles contain diagnostic console calls: ${diagnosticCalls.join(', ')}`);
	}
}

function walkFiles(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		return entry.isDirectory() ? walkFiles(path) : [path];
	});
}

const common = {
	absWorkingDir: projectDir,
	bundle: true,
	treeShaking: true,
	splitting: false,
	platform: 'browser',
	target: ['chrome120'],
	charset: 'utf8',
	legalComments: 'none',
	minify: !isDev,
	sourcemap: emitSourceMap ? 'external' : false,
	sourcesContent: false,
	define: { 'process.env.NODE_ENV': isDev ? '"development"' : '"production"' },
	// Production keeps actionable warnings/errors but removes diagnostic chatter,
	// including logger.info implementations bundled from the shared kernel.
	pure: isDev ? [] : ['console.debug', 'console.info', 'console.log'],
	drop: isDev ? [] : ['debugger'],
	loader: { '.ts': 'ts', '.tsx': 'tsx' },
	alias: {
		// Bundle the current workspace sources. Release still builds the package
		// outputs for tests and declarations, but extension code must never pick up
		// a stale dist/ tree left by an earlier local build.
		'@nexus/contracts/bootstrap': resolve(projectDir, '../../packages/contracts/src/spectra.bootstrap.ts'),
		'@nexus/contracts': resolve(projectDir, '../../packages/contracts/src/index.ts'),
		'@nexus/kernel': resolve(projectDir, '../../packages/nexus-kernel/src/index.ts'),
		'@nexus/audio-engine': resolve(projectDir, '../../packages/features/audio-engine/src/index.ts'),
		// PeerJS pulls every Firefox/Safari/legacy-Chrome compatibility shim from
		// webrtc-adapter. SPECTRA is compiled for Chrome 120+, whose native WebRTC
		// surface needs only the browserDetails object PeerJS reads at runtime.
		'webrtc-adapter': resolve(projectDir, 'scripts/chrome120-webrtc-adapter.mjs'),
	},
	logLevel: 'warning',
};

runTypecheck();
prepareDist();
await minifyProductionStyles();
writeI18nAssets(distDir);
minifyProductionAssets();
console.log(`✓ SPECTRA ${version} ${isDev ? 'development' : 'production'} build`);

if (isWatch) {
	const contexts = await Promise.all(entries.map(async ({ entry, out }) => {
		const context = await esbuild.context({
			...common,
			entryPoints: [entry],
			outfile: resolve(distDir, out),
			plugins: [{
				name: 'build-notifier',
				setup(build) {
					build.onEnd((result) => {
						if (result.errors.length === 0) console.log(`✓ ${out}`);
					});
				},
			}],
		});
		await context.watch();
		return context;
	}));
	process.on('SIGINT', async () => {
		await Promise.all(contexts.map((context) => context.dispose()));
		process.exit(0);
	});
	console.log('Watching SPECTRA entrypoints…');
} else {
	const metafiles = [];
	const summary = [];
	const buildOne = async ({ entry, out }) => {
		const result = await esbuild.build({
			...common,
			entryPoints: [entry],
			outfile: resolve(distDir, out),
			metafile: true,
		});
		metafiles.push({ name: out, metafile: result.metafile });
		summary.push(`${out}:${Math.ceil(statSync(resolve(distDir, out)).size / 1024)}KiB`);
	};

	if (isDev) {
		for (const entry of entries) await buildOne(entry);
	} else {
		for (const entry of isolatedEntries) await buildOne(entry);
		const moduleEntryPoints = Object.fromEntries(moduleEntries.map(({ entry, out }) => [
			out.slice(0, -'.js'.length),
			entry,
		]));
		const result = await esbuild.build({
			...common,
			entryPoints: moduleEntryPoints,
			outdir: distDir,
			entryNames: '[name]',
			chunkNames: 'chunks/[name]-[hash]',
			format: 'esm',
			splitting: true,
			metafile: true,
		});
		for (const { out } of moduleEntries) {
			metafiles.push({ name: out, metafile: result.metafile });
			summary.push(`${out}:${Math.ceil(statSync(resolve(distDir, out)).size / 1024)}KiB`);
		}
	}

	assertProductionJavaScript();
	if (!isDev) checkBundleBudget({ distDir, metafiles });

	if (isAnalyze) {
		const report = metafiles.map(({ name, metafile }) => ({
			name,
			sha256: createHash('sha256').update(readFileSync(resolve(distDir, name))).digest('hex'),
			inputs: Object.entries(metafile.outputs).find(([output]) => {
				const normalized = output.replaceAll('\\', '/');
				return normalized === `dist/${name}` || normalized.endsWith(`/dist/${name}`);
			})?.[1].inputs ?? {},
		}));
		writeFileSync(resolve(distDir, 'build-analysis.json'), `${JSON.stringify(report, null, 2)}\n`);
	}

	console.log(`✓ ${summary.join(' | ')}`);
}

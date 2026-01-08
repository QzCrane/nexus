/**
 * HALO Build Script (esbuild)
 * Unified with Spectra build system
 */

import esbuild from 'esbuild';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse args
const isWatch = process.argv.includes('--watch');
const isDev = process.argv.includes('--dev') || isWatch;

// Run generate-registry (skip in watch mode for speed)
if (!isWatch) {
	try {
		console.log('📦 Generating tool registry...');
		execSync('node ../../scripts/generate-tool-registry.mjs', { stdio: 'inherit', cwd: __dirname });
	} catch {
		console.error('⚠️ generate-registry failed, continuing build...');
	}

	try {
		console.log('🔍 Running verify-architecture...');
		execSync('node ../../scripts/verify-architecture.js', { stdio: 'inherit', cwd: __dirname });
	} catch {
		console.error('⚠️ verify-architecture failed, continuing build...');
	}
}

// Clean dist
fs.removeSync('dist');
fs.ensureDirSync('dist');

// Copy public assets
fs.copySync('public', 'dist');
console.log('✓ Copied public files');

// Copy SaaT script files
const toolsDir = path.join(__dirname, 'src/tools');
const scriptsDir = path.join(__dirname, 'src/scripts');
const distToolsDir = path.join(__dirname, 'dist/tools');
const distScriptsDir = path.join(__dirname, 'dist/scripts');

fs.ensureDirSync(distToolsDir);
fs.ensureDirSync(distScriptsDir);

function copyScriptFiles(sourceDir, destBaseDir) {
	if (!fs.existsSync(sourceDir)) return 0;
	const dirs = fs.readdirSync(sourceDir, { withFileTypes: true }).filter(d => d.isDirectory());
	let count = 0;
	for (const dir of dirs) {
		const scriptJs = path.join(sourceDir, dir.name, 'script.js');
		const scriptCss = path.join(sourceDir, dir.name, 'script.css');
		const destDir = path.join(destBaseDir, dir.name);
		let copied = false;
		if (fs.existsSync(scriptJs)) {
			fs.ensureDirSync(destDir);
			fs.copyFileSync(scriptJs, path.join(destDir, 'script.js'));
			copied = true;
		}
		if (fs.existsSync(scriptCss)) {
			fs.ensureDirSync(destDir);
			fs.copyFileSync(scriptCss, path.join(destDir, 'script.css'));
			copied = true;
		}
		if (copied) count++;
	}
	return count;
}

const toolScriptsCount = copyScriptFiles(toolsDir, distToolsDir);
const officialScriptsCount = copyScriptFiles(scriptsDir, distScriptsDir);

if (toolScriptsCount + officialScriptsCount > 0) {
	console.log(`✓ Copied ${toolScriptsCount + officialScriptsCount} SaaT script files`);
}

const commonConfig = {
	bundle: true,
	minify: !isDev,
	sourcemap: isDev,
	define: {
		'process.env.NODE_ENV': isDev ? '"development"' : '"production"'
	},
	loader: { '.ts': 'ts', '.tsx': 'tsx' },
	alias: {
		'@nexus/contracts': path.resolve(__dirname, '../../packages/contracts/dist/index.js'),
		'@nexus/kernel': path.resolve(__dirname, '../../packages/nexus-kernel/dist/index.js'),
		'@nexus/ui-kit': path.resolve(__dirname, '../../packages/ui-kit/dist/index.js'),
		'@nexus/zen-engine': path.resolve(__dirname, '../../packages/features/zen-engine/dist/index.js')
	}
};

const entries = [
	{ entry: 'src/entry/content.ts', out: 'content.js' },
	{ entry: 'src/entry/background.ts', out: 'background.js' },
	{ entry: 'src/entry/sidepanel.tsx', out: 'sidepanel.js' },
	{ entry: 'src/entry/sidepanel-init.ts', out: 'sidepanel-init.js' }
];

if (isWatch) {
	// Watch mode - use esbuild context for incremental builds
	console.log('👀 Watch mode enabled - waiting for changes...\n');
	
	const contexts = await Promise.all(entries.map(async ({ entry, out }) => {
		const ctx = await esbuild.context({
			...commonConfig,
			entryPoints: [entry],
			outfile: `dist/${out}`,
			logLevel: 'info',
			plugins: [{
				name: 'rebuild-notify',
				setup(build) {
					build.onEnd(result => {
						if (result.errors.length === 0) {
							console.log(`✓ Rebuilt ${out}`);
						}
					});
				}
			}]
		});
		await ctx.watch();
		return ctx;
	}));
	
	process.on('SIGINT', async () => {
		console.log('\n🛑 Stopping watch...');
		await Promise.all(contexts.map(ctx => ctx.dispose()));
		process.exit(0);
	});
	
} else {
	// Normal build
	await Promise.all(entries.map(async ({ entry, out }) => {
		try {
			await esbuild.build({
				...commonConfig,
				entryPoints: [entry],
				outfile: `dist/${out}`,
				write: true
			});
			console.log(`✓ Built ${out}`);
		} catch (e) {
			console.error(`✗ Failed to build ${out}:`, e.message);
			process.exit(1);
		}
	}));
	
	console.log('\n🎉 HALO build complete!');
}

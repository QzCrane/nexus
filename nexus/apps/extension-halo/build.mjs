import esbuild from 'esbuild';
const { build } = esbuild;
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Clean dist
fs.removeSync('dist');
fs.ensureDirSync('dist');

// Copy public assets
fs.copySync('public', 'dist');
console.log('✓ Copied public files');

// Config
const isWatch = process.argv.includes('--watch');

const commonConfig = {
	bundle: true,
	minify: !isWatch,
	sourcemap: isWatch,
	define: {
		'process.env.NODE_ENV': isWatch ? '"development"' : '"production"'
	},
	loader: { '.ts': 'ts', '.tsx': 'tsx' },
	alias: {
		'@nexus/contracts': path.resolve(__dirname, '../../packages/contracts/dist/index.js'),
		'@nexus/kernel': path.resolve(__dirname, '../../packages/nexus-kernel/dist/index.js'),
		'@nexus/ui-kit': path.resolve(__dirname, '../../packages/ui-kit/dist/index.js'),
		'@nexus/zen-engine': path.resolve(__dirname, '../../packages/features/zen-engine/dist/index.js')
	}
};

// Build Content Script
build({
	...commonConfig,
	entryPoints: ['src/entry/content.ts'],
	outfile: 'dist/content.js',
}).then(() => console.log('✓ Built content.js')).catch(e => { console.error(e); process.exit(1); });

// Build Popup (React)
build({
	...commonConfig,
	entryPoints: ['src/entry/popup.tsx'],
	outfile: 'dist/popup.js',
}).then(() => console.log('✓ Built popup.js')).catch(e => { console.error(e); process.exit(1); });

// Build Background
build({
	...commonConfig,
	entryPoints: ['src/entry/background.ts'],
	outfile: 'dist/background.js',
}).then(() => console.log('✓ Built background.js')).catch(e => { console.error(e); process.exit(1); });

console.log('\n🎉 HALO build complete!');

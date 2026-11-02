// goal: verify the unpacked package (dist/) is complete before Chrome reloads it
// inv: a partial dist is external mutation (interrupted build, failed watch rebuild,
//      manual cleanup) — never a valid build output; normal builds finish with a
//      statSync size check on every entrypoint and fail on a missing outfile.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = resolve(projectDir, 'dist');

// Build entries (build.ts allEntries) plus the offscreen document the runtime
// creates. These must physically exist for every surface to function.
const ENTRYPOINTS = [
	'background.js',
	'content-bootstrap.js',
	'content-site-hotkeys.js',
	'content-fullscreen-bridge.js',
	'content-page-media-bridge.js',
	'content-runtime.js',
	'content-video-effects.js',
	'popup.js',
	'popup-first-paint.js',
	'options.js',
	'offscreen.js',
	'offscreen.html',
	'peerjs-vendor.js',
];

function manifestReferences(distDirPath: string): string[] {
	const manifestPath = join(distDirPath, 'manifest.json');
	if (!existsSync(manifestPath)) return ['manifest.json'];
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
		background?: { service_worker?: string };
		content_scripts?: { js?: string[] }[];
		web_accessible_resources?: { resources?: string[] }[];
		action?: { default_popup?: string; default_icon?: Record<string, string> };
		options_page?: string;
		options_ui?: { page?: string };
		icons?: Record<string, string>;
	};
	const references = new Set<string>();
	if (manifest.background?.service_worker) references.add(manifest.background.service_worker);
	for (const script of manifest.content_scripts ?? []) {
		for (const file of script.js ?? []) references.add(file);
	}
	for (const resource of manifest.web_accessible_resources ?? []) {
		for (const file of resource.resources ?? []) references.add(file);
	}
	if (manifest.action?.default_popup) references.add(manifest.action.default_popup);
	if (manifest.options_page) references.add(manifest.options_page);
	if (manifest.options_ui?.page) references.add(manifest.options_ui.page);
	for (const icon of Object.values(manifest.icons ?? {})) references.add(icon);
	for (const icon of Object.values(manifest.action?.default_icon ?? {})) references.add(icon);
	return [...references];
}

export function checkDistIntegrity(targetDir = distDir): { missing: string[] } {
	const required = [...ENTRYPOINTS, ...manifestReferences(targetDir)];
	const missing = [...new Set(required.filter((name) => !existsSync(join(targetDir, name))))].sort();
	return { missing };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const { missing } = checkDistIntegrity();
	if (missing.length > 0) {
		console.error(`✗ dist is incomplete — missing ${missing.length} required file(s):`);
		for (const name of missing) console.error(`  - ${name}`);
		console.error('Rebuild with `bun run build:dev` (or `bun run build` for production), then reload the unpacked extension.');
		process.exit(1);
	}
	console.log(`✓ dist complete: ${ENTRYPOINTS.length} entrypoints + all manifest-referenced files present`);
}

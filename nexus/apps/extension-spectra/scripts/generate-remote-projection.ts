// goal: project every extension-owned remote artifact onto the buildless static page
//
// The remote site is deployed without a build step, so its wire protocol and
// vendored transport are committed projections of extension-owned sources.
// `--check` fails when any committed projection no longer matches its owner; the
// default mode regenerates all of them. The exported model is shared with the
// architecture verification gate so generation and verification cannot drift.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import esbuild from 'esbuild';

const appDir = resolve(import.meta.dir, '..');
const repositoryDir = resolve(appDir, '../../..');
const entryPoint = resolve(appDir, 'src/remote/protocol.ts');
const projectionPath = resolve(repositoryDir, 'remote-site/dist/protocol.js');
const projectionLabel = relative(repositoryDir, projectionPath).replaceAll('\\', '/');
const banner = '/* Generated from nexus/apps/extension-spectra/src/remote/protocol.ts. Do not edit. */';

export interface RemoteVendorProjectionFile {
	ownerPath: string;
	projectionPath: string;
	label: string;
}

export const REMOTE_VENDOR_PROJECTION_FILES: readonly RemoteVendorProjectionFile[] = Object.freeze(
	[
		{ owner: 'vendor/peerjs/peerjs.min.js', projection: 'vendor/peerjs.min.js' },
		{ owner: 'vendor/peerjs/peerjs.min.d.ts', projection: 'vendor/peerjs.min.d.ts' },
		{ owner: 'vendor/peerjs/LICENSE.peerjs', projection: 'vendor/LICENSE.peerjs' },
	].map(({ owner, projection }) => Object.freeze({
		ownerPath: resolve(appDir, owner),
		projectionPath: resolve(repositoryDir, 'remote-site', projection),
		label: `remote-site/${projection}`,
	})),
);

export { projectionPath as remoteProtocolProjectionPath };

export function buildRemoteProtocolProjection(): Buffer {
	const result = esbuild.buildSync({
		entryPoints: [entryPoint],
		bundle: true,
		format: 'iife',
		globalName: 'SpectraRemoteProtocol',
		platform: 'browser',
		target: ['chrome120'],
		charset: 'utf8',
		legalComments: 'none',
		minify: true,
		sourcemap: false,
		write: false,
		banner: { js: banner },
		alias: {
			// Bundle the current workspace sources instead of a stale package dist.
			'@nexus/contracts': resolve(appDir, '../../packages/contracts/src/index.ts'),
		},
		loader: { '.ts': 'ts' },
		define: { 'process.env.NODE_ENV': '"production"' },
		logLevel: 'warning',
	});
	const output = result.outputFiles?.[0]?.contents;
	if (!output) throw new Error('The remote protocol bundle produced no output');
	return Buffer.from(output);
}

/** Returns the committed projection bytes, or null when it was never generated. */
export function readCommittedRemoteProjection(path: string): Buffer | null {
	try {
		return readFileSync(path);
	} catch {
		return null;
	}
}

export function readCommittedRemoteProtocolProjection(): Buffer | null {
	return readCommittedRemoteProjection(projectionPath);
}

function main(): void {
	const check = process.argv.includes('--check');
	const projection = buildRemoteProtocolProjection();
	const regeneration = 'run "bun run generate:remote-projection" in nexus/';
	if (!check) {
		mkdirSync(dirname(projectionPath), { recursive: true });
		writeFileSync(projectionPath, projection);
		for (const file of REMOTE_VENDOR_PROJECTION_FILES) {
			mkdirSync(dirname(file.projectionPath), { recursive: true });
			writeFileSync(file.projectionPath, readFileSync(file.ownerPath));
		}
		const labels = [projectionLabel, ...REMOTE_VENDOR_PROJECTION_FILES.map((file) => file.label)];
		console.log(`✓ Remote projections written: ${labels.join(', ')}`);
		return;
	}

	const failures: string[] = [];
	const committed = readCommittedRemoteProtocolProjection();
	if (!committed) failures.push(`${projectionLabel} is missing; ${regeneration}`);
	else if (!committed.equals(projection)) failures.push(`${projectionLabel} is stale; ${regeneration}`);
	for (const file of REMOTE_VENDOR_PROJECTION_FILES) {
		if (!existsSync(file.ownerPath)) {
			failures.push(`${file.label}: owner ${relative(repositoryDir, file.ownerPath).replaceAll('\\', '/')} is missing`);
			continue;
		}
		const committedVendor = readCommittedRemoteProjection(file.projectionPath);
		if (!committedVendor) failures.push(`${file.label} is missing; ${regeneration}`);
		else if (!committedVendor.equals(readFileSync(file.ownerPath))) {
			failures.push(`${file.label} is stale; ${regeneration}`);
		}
	}
	if (failures.length > 0) throw new Error(failures.join('\n'));
	const labels = [projectionLabel, ...REMOTE_VENDOR_PROJECTION_FILES.map((file) => file.label)];
	console.log(`✓ Remote projections match their owners: ${labels.join(', ')}`);
}

if (import.meta.main) {
	try {
		main();
	} catch (error) {
		console.error(
			`✗ Remote projection failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exitCode = 1;
	}
}

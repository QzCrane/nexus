// goal: generate the HALO Chrome manifest runtime surface from infrastructure + release admission
// inv: catalog-only modules cannot enter content_scripts or web_accessible_resources by editing public manifest

import { readFileSync } from 'node:fs';
import {
	HALO_MANIFEST,
	HALO_MANIFEST_BASE,
} from './config.ts';
import type { ReleaseAdmission } from './release-admission.ts';
import { emitGeneratedFile, type GenerationMode } from './utils.ts';

interface ManifestContentScript {
	matches: string[];
	js: string[];
	run_at: 'document_start' | 'document_idle';
	all_frames: boolean;
}

interface ManifestBase extends Record<string, unknown> {
	manifest_version: number;
	version: string;
	content_scripts: ManifestContentScript[];
	web_accessible_resources?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readManifestBase(): ManifestBase {
	const value = JSON.parse(readFileSync(HALO_MANIFEST_BASE, 'utf8')) as unknown;
	if (!isRecord(value)
		|| value.manifest_version !== 3
		|| typeof value.version !== 'string'
		|| !/^\d+\.\d+\.\d+$/u.test(value.version)
		|| !Array.isArray(value.content_scripts)) {
		throw new Error('HALO manifest.base.json is malformed');
	}
	if (Object.hasOwn(value, 'web_accessible_resources')) {
		throw new Error('HALO manifest base cannot own web_accessible_resources; release admission owns them');
	}
	const contentScripts: ManifestContentScript[] = [];
	for (const [index, entry] of value.content_scripts.entries()) {
		if (!isRecord(entry)
			|| !Array.isArray(entry.matches)
			|| entry.matches.length !== 1
			|| entry.matches[0] !== '<all_urls>'
			|| !Array.isArray(entry.js)
			|| entry.js.length !== 1
			|| typeof entry.js[0] !== 'string'
			|| (entry.run_at !== 'document_start' && entry.run_at !== 'document_idle')
			|| typeof entry.all_frames !== 'boolean') {
			throw new Error(`HALO manifest base content_scripts[${index}] is malformed`);
		}
		contentScripts.push({
			matches: ['<all_urls>'],
			js: [entry.js[0]],
			run_at: entry.run_at,
			all_frames: entry.all_frames,
		});
	}
	const outputs = contentScripts.map((entry) => entry.js[0]);
	if (new Set(outputs).size !== outputs.length) {
		throw new Error('HALO manifest base duplicates an infrastructure content-script output');
	}
	return { ...value, content_scripts: contentScripts } as ManifestBase;
}

export function generateReleaseManifest(
	admission: ReleaseAdmission,
	mode: GenerationMode = 'write',
): string {
	const base = readManifestBase();
	const contentScripts = [...base.content_scripts];
	const outputOwners = new Map(contentScripts.map((entry) => [entry.js[0], 'infrastructure']));
	for (const module of admission.modules) {
		if (!module.contentScript) continue;
		const previous = outputOwners.get(module.contentScript.js);
		if (previous) {
			throw new Error(
				`HALO manifest content-script output ${module.contentScript.js} is owned by both ${previous} and ${module.id}`,
			);
		}
		outputOwners.set(module.contentScript.js, module.id);
		contentScripts.push({
			matches: ['<all_urls>'],
			js: [module.contentScript.js],
			run_at: module.contentScript.runAt,
			all_frames: module.contentScript.allFrames,
		});
	}

	const webResources = admission.modules
		.flatMap((module) => module.webAccessibleRuntimes ?? [])
		.map((runtime) => runtime.output)
		.sort();
	if (new Set(webResources).size !== webResources.length) {
		throw new Error('HALO release manifest has duplicate web-accessible resources');
	}

	const manifest: Record<string, unknown> = {
		...base,
		content_scripts: contentScripts,
		...(webResources.length > 0 ? {
			web_accessible_resources: [{
				resources: webResources,
				matches: ['<all_urls>'],
				use_dynamic_url: true,
			}],
		} : {}),
	};
	const content = `${JSON.stringify(manifest, null, 2)}\n`;
	emitGeneratedFile(HALO_MANIFEST, content, mode, 'HALO release manifest');
	return base.version;
}

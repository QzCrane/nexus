// goal: make physical HALO release admission independent from source/catalog presence
// inv: a module enters an executable release surface only through this exact owner

import { readFileSync } from 'node:fs';
import {
	HALO_RELEASE_ADMISSION,
	OUTPUT_RELEASE_ADMISSION,
} from './config.ts';
import { emitGeneratedFile, type GenerationMode } from './utils.ts';

export const RELEASE_STAGES = ['ready', 'beta', 'support'] as const;
export type HaloReleaseStage = typeof RELEASE_STAGES[number];
export const RELEASE_SURFACES = [
	'panel',
	'script-runtime',
	'content-runtime',
	'background-runtime',
] as const;
export type HaloReleaseSurface = typeof RELEASE_SURFACES[number];

export interface ReleaseContentScript {
	js: string;
	runAt: 'document_start' | 'document_idle';
	allFrames: boolean;
}

export interface ReleaseAdmissionModule {
	id: string;
	stage: HaloReleaseStage;
	surfaces: HaloReleaseSurface[];
	contentScript?: ReleaseContentScript;
	webAccessibleResources?: string[];
	reason: string;
}

export interface ReleaseAdmission {
	schemaVersion: 1;
	modules: ReleaseAdmissionModule[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function parseContentScript(value: unknown, id: string): ReleaseContentScript | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)
		|| !isNonEmptyString(value.js)
		|| !/^[A-Za-z0-9_./-]+\.js$/u.test(value.js)
		|| (value.runAt !== 'document_start' && value.runAt !== 'document_idle')
		|| typeof value.allFrames !== 'boolean') {
		throw new Error(`${id}: contentScript is malformed`);
	}
	return {
		js: value.js,
		runAt: value.runAt,
		allFrames: value.allFrames,
	};
}

function parseResourceList(value: unknown, id: string): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)
		|| value.length === 0
		|| value.some((resource) => !isNonEmptyString(resource) || resource.includes('*') || resource.startsWith('/'))
		|| new Set(value).size !== value.length) {
		throw new Error(`${id}: webAccessibleResources must be unique exact relative paths`);
	}
	return [...value].sort() as string[];
}

export function parseReleaseAdmission(value: unknown): ReleaseAdmission {
	if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.modules)) {
		throw new Error('HALO release admission must use schemaVersion 1 with a modules array');
	}
	if (value.modules.length === 0 || value.modules.length > 256) {
		throw new Error('HALO release admission modules must contain 1..256 entries');
	}

	const seen = new Set<string>();
	let previousId = '';
	const modules = value.modules.map((raw, index): ReleaseAdmissionModule => {
		if (!isRecord(raw)
			|| !isNonEmptyString(raw.id)
			|| !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(raw.id)
			|| !RELEASE_STAGES.includes(raw.stage as HaloReleaseStage)
			|| !Array.isArray(raw.surfaces)
			|| raw.surfaces.length === 0
			|| raw.surfaces.some((surface) => !RELEASE_SURFACES.includes(surface as HaloReleaseSurface))
			|| !isNonEmptyString(raw.reason)) {
			throw new Error(`HALO release admission entry ${index} is malformed`);
		}
		if (seen.has(raw.id)) throw new Error(`HALO release admission duplicates ${raw.id}`);
		if (previousId && raw.id.localeCompare(previousId) <= 0) {
			throw new Error('HALO release admission modules must be sorted by id');
		}
		if (new Set(raw.surfaces).size !== raw.surfaces.length) {
			throw new Error(`HALO release admission ${raw.id} duplicates a surface`);
		}
		const contentScript = parseContentScript(raw.contentScript, raw.id);
		const webAccessibleResources = parseResourceList(raw.webAccessibleResources, raw.id);
		const hasContentRuntime = raw.surfaces.includes('content-runtime');
		if (hasContentRuntime !== Boolean(contentScript)) {
			throw new Error(`${raw.id}: content-runtime surface and contentScript must be declared together`);
		}
		if (webAccessibleResources && !hasContentRuntime) {
			throw new Error(`${raw.id}: webAccessibleResources require content-runtime admission`);
		}

		seen.add(raw.id);
		previousId = raw.id;
		return {
			id: raw.id,
			stage: raw.stage as HaloReleaseStage,
			surfaces: raw.surfaces as HaloReleaseSurface[],
			...(contentScript ? { contentScript } : {}),
			...(webAccessibleResources ? { webAccessibleResources } : {}),
			reason: raw.reason,
		};
	});
	return { schemaVersion: 1, modules };
}

export function readReleaseAdmission(): ReleaseAdmission {
	return parseReleaseAdmission(JSON.parse(readFileSync(HALO_RELEASE_ADMISSION, 'utf8')));
}

export function releaseAdmissionMap(admission: ReleaseAdmission): Map<string, ReleaseAdmissionModule> {
	return new Map(admission.modules.map((entry) => [entry.id, entry]));
}

export function hasReleaseSurface(
	admissionMap: ReadonlyMap<string, ReleaseAdmissionModule>,
	id: string,
	surface: HaloReleaseSurface,
): boolean {
	return admissionMap.get(id)?.surfaces.includes(surface) === true;
}

export function validateReleaseAdmissionAgainstModules(
	admission: ReleaseAdmission,
	allModules: readonly any[],
	manifestsMap: ReadonlyMap<string, any>,
): void {
	const moduleById = new Map(allModules.map((module) => [module.id, module]));
	const admissionMap = releaseAdmissionMap(admission);
	const contentOutputs = new Set<string>();
	const resources = new Set<string>();

	for (const entry of admission.modules) {
		const module = moduleById.get(entry.id);
		const manifest = manifestsMap.get(entry.id);
		if (!module || !manifest) throw new Error(`release admission references unknown module ${entry.id}`);
		if (entry.stage === 'ready' && manifest.status !== 'ready') {
			throw new Error(`${entry.id}: ready release admission requires manifest.status=ready`);
		}
		if (entry.stage === 'beta' && manifest.status !== 'beta') {
			throw new Error(`${entry.id}: beta release admission requires manifest.status=beta`);
		}
		if (entry.stage === 'support' && (manifest.status === 'coming' || manifest.status === 'disabled')) {
			throw new Error(`${entry.id}: support release admission cannot ship a coming/disabled module`);
		}
		if (entry.surfaces.includes('panel') && !module.panelPath) {
			throw new Error(`${entry.id}: panel admission requires a physical panel`);
		}
		if (entry.surfaces.includes('script-runtime')) {
			if (module.pluginType !== 'script' || !manifest.script) {
				throw new Error(`${entry.id}: script-runtime admission requires a script plugin contract`);
			}
			if (entry.stage === 'support') {
				throw new Error(`${entry.id}: script-runtime must have an explicit ready/beta product stage`);
			}
		}
		if (entry.contentScript) {
			if (contentOutputs.has(entry.contentScript.js)) {
				throw new Error(`content-script output has multiple release owners: ${entry.contentScript.js}`);
			}
			contentOutputs.add(entry.contentScript.js);
		}
		for (const resource of entry.webAccessibleResources ?? []) {
			if (resources.has(resource)) throw new Error(`web-accessible resource has multiple owners: ${resource}`);
			resources.add(resource);
		}
	}

	// A manifest may describe arbitrary catalog inventory, but an explicitly
	// ready/beta executable must not become a misleading UI promise with no
	// release owner. This is the reverse fence that prevents status drift.
	for (const module of allModules) {
		const manifest = manifestsMap.get(module.id);
		if (!manifest || (manifest.status !== 'ready' && manifest.status !== 'beta')) continue;
		if (!admissionMap.has(module.id)) {
			throw new Error(`${module.id}: ${manifest.status} catalog status requires explicit release admission`);
		}
		const entry = admissionMap.get(module.id)!;
		if (entry.stage !== manifest.status) {
			throw new Error(`${module.id}: manifest status and release admission stage disagree`);
		}
	}
}

export function generateReleaseAdmissionProjection(
	admission: ReleaseAdmission,
	mode: GenerationMode = 'write',
): void {
	const bySurface = Object.fromEntries(
		RELEASE_SURFACES.map((surface) => [
			surface,
			admission.modules.filter((entry) => entry.surfaces.includes(surface)).map((entry) => entry.id),
		]),
	) as Record<HaloReleaseSurface, string[]>;
	const stages = Object.fromEntries(admission.modules.map((entry) => [entry.id, entry.stage]));
	const contentScripts = admission.modules.flatMap((entry) => entry.contentScript
		? [{ id: entry.id, ...entry.contentScript }]
		: []);
	const webAccessibleResources = admission.modules.flatMap((entry) => entry.webAccessibleResources ?? []).sort();
	const content = `// AUTO-GENERATED - DO NOT EDIT
// Generated by: bun run generate-registry
// Physical release admission projection; catalog inventory remains in _generated.ts.

export const RELEASE_ADMITTED_PLUGIN_IDS = Object.freeze(${JSON.stringify(admission.modules.map((entry) => entry.id), null, 2)} as const);
export const RELEASE_PANEL_IDS = Object.freeze(${JSON.stringify(bySurface.panel, null, 2)} as const);
export const RELEASE_SCRIPT_RUNTIME_IDS = Object.freeze(${JSON.stringify(bySurface['script-runtime'], null, 2)} as const);
export const RELEASE_CONTENT_RUNTIME_IDS = Object.freeze(${JSON.stringify(bySurface['content-runtime'], null, 2)} as const);
export const RELEASE_BACKGROUND_RUNTIME_IDS = Object.freeze(${JSON.stringify(bySurface['background-runtime'], null, 2)} as const);
export const RELEASE_CONTENT_SCRIPTS = Object.freeze(${JSON.stringify(contentScripts, null, 2)} as const);
export const RELEASE_WEB_ACCESSIBLE_RESOURCES = Object.freeze(${JSON.stringify(webAccessibleResources, null, 2)} as const);
export const RELEASE_STAGE_BY_ID = Object.freeze(${JSON.stringify(stages, null, 2)} as const);

const RELEASE_ADMITTED_PLUGIN_ID_SET = new Set<string>(RELEASE_ADMITTED_PLUGIN_IDS);
export function isReleaseAdmittedPlugin(id: string): boolean {
\treturn RELEASE_ADMITTED_PLUGIN_ID_SET.has(id);
}
`;
	emitGeneratedFile(OUTPUT_RELEASE_ADMISSION, content, mode, 'release admission projection');
}

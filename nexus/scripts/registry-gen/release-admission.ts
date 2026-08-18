// goal: make physical HALO release admission independent from source/catalog presence
// inv: a module enters an executable release surface only through this exact owner

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	HALO_APP_ROOT,
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
	entry: string;
	js: string;
	runAt: 'document_start' | 'document_idle';
	allFrames: boolean;
}

export interface ReleaseWebAccessibleRuntime {
	entry: string;
	output: string;
}

interface ReleaseActiveServiceBase {
	owner: string;
	readiness: string;
	disposer: string;
}

export type ReleaseActiveService =
	| (ReleaseActiveServiceBase & {
		kind: 'storage-enabled';
		area: 'local' | 'sync';
		key: string;
		defaultEnabled: boolean;
	})
	| (ReleaseActiveServiceBase & { kind: 'userscripts-authority' })
	| (ReleaseActiveServiceBase & { kind: 'saat-registry' });

export interface ReleaseAdmissionModule {
	id: string;
	stage: HaloReleaseStage;
	surfaces: HaloReleaseSurface[];
	contentScript?: ReleaseContentScript;
	webAccessibleRuntimes?: ReleaseWebAccessibleRuntime[];
	activeService?: ReleaseActiveService;
	reason: string;
}

export interface ReleaseAdmission {
	schemaVersion: 1;
	modules: ReleaseAdmissionModule[];
}

interface DiscoveredModuleLike {
	id: string;
	pluginType: string;
	panelPath: string | null;
}

interface PluginManifestLike {
	status?: unknown;
	script?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function lifecycleText(value: unknown, id: string, field: string): string {
	if (!isNonEmptyString(value) || value.length > 512) {
		throw new Error(`${id}: activeService.${field} must be a non-empty string <=512 chars`);
	}
	return value.trim();
}

function parseActiveService(value: unknown, id: string): ReleaseActiveService | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)
		|| (value.kind !== 'storage-enabled'
			&& value.kind !== 'userscripts-authority'
			&& value.kind !== 'saat-registry')) {
		throw new Error(`${id}: activeService is malformed`);
	}
	const base = {
		owner: lifecycleText(value.owner, id, 'owner'),
		readiness: lifecycleText(value.readiness, id, 'readiness'),
		disposer: lifecycleText(value.disposer, id, 'disposer'),
	};
	if (value.kind === 'storage-enabled') {
		if ((value.area !== 'local' && value.area !== 'sync')
			|| !isNonEmptyString(value.key)
			|| !/^[A-Za-z0-9_.:-]{1,128}$/u.test(value.key)
			|| typeof value.defaultEnabled !== 'boolean') {
			throw new Error(`${id}: storage-enabled activeService is malformed`);
		}
		return {
			kind: value.kind,
			area: value.area,
			key: value.key,
			defaultEnabled: value.defaultEnabled,
			...base,
		};
	}
	return { kind: value.kind, ...base };
}

function parseSourceEntry(value: unknown, id: string, field: string): string {
	if (!isNonEmptyString(value)
		|| !/^src\/entry\/[A-Za-z0-9_./-]+\.tsx?$/u.test(value)
		|| value.includes('..')) {
		throw new Error(`${id}: ${field} must be an exact src/entry TypeScript path`);
	}
	if (!existsSync(resolve(HALO_APP_ROOT, value))) {
		throw new Error(`${id}: ${field} does not exist: ${value}`);
	}
	return value;
}

function parseContentScript(value: unknown, id: string): ReleaseContentScript | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)
		|| !isNonEmptyString(value.js)
		|| !/^[A-Za-z0-9_-]+\.js$/u.test(value.js)
		|| (value.runAt !== 'document_start' && value.runAt !== 'document_idle')
		|| typeof value.allFrames !== 'boolean') {
		throw new Error(`${id}: contentScript is malformed`);
	}
	return {
		entry: parseSourceEntry(value.entry, id, 'contentScript.entry'),
		js: value.js,
		runAt: value.runAt,
		allFrames: value.allFrames,
	};
}

function parseWebAccessibleRuntimes(
	value: unknown,
	id: string,
): ReleaseWebAccessibleRuntime[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
		throw new Error(`${id}: webAccessibleRuntimes must contain 1..32 exact runtime entries`);
	}
	const outputs = new Set<string>();
	const entries = new Set<string>();
	const runtimes = value.map((raw, index): ReleaseWebAccessibleRuntime => {
		if (!isRecord(raw)
			|| !isNonEmptyString(raw.output)
			|| raw.output.includes('*')
			|| raw.output.startsWith('/')
			|| raw.output.includes('..')
			|| !/^[A-Za-z0-9_./-]+\.js$/u.test(raw.output)) {
			throw new Error(`${id}: webAccessibleRuntimes[${index}] is malformed`);
		}
		const entry = parseSourceEntry(raw.entry, id, `webAccessibleRuntimes[${index}].entry`);
		if (outputs.has(raw.output)) throw new Error(`${id}: duplicates web runtime output ${raw.output}`);
		if (entries.has(entry)) throw new Error(`${id}: duplicates web runtime source ${entry}`);
		outputs.add(raw.output);
		entries.add(entry);
		return { entry, output: raw.output };
	});
	return runtimes.sort((left, right) => left.output.localeCompare(right.output));
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
		const webAccessibleRuntimes = parseWebAccessibleRuntimes(raw.webAccessibleRuntimes, raw.id);
		const activeService = parseActiveService(raw.activeService, raw.id);
		const hasContentRuntime = raw.surfaces.includes('content-runtime');
		if (hasContentRuntime !== Boolean(contentScript)) {
			throw new Error(`${raw.id}: content-runtime surface and contentScript must be declared together`);
		}
		if (webAccessibleRuntimes && !hasContentRuntime) {
			throw new Error(`${raw.id}: webAccessibleRuntimes require content-runtime admission`);
		}
		if (activeService?.kind === 'saat-registry' && !raw.surfaces.includes('script-runtime')) {
			throw new Error(`${raw.id}: saat-registry activeService requires script-runtime admission`);
		}
		if (activeService?.kind === 'userscripts-authority' && !raw.surfaces.includes('background-runtime')) {
			throw new Error(`${raw.id}: userscripts-authority activeService requires background-runtime admission`);
		}
		if (activeService?.kind === 'storage-enabled'
			&& !raw.surfaces.includes('content-runtime')
			&& !raw.surfaces.includes('background-runtime')) {
			throw new Error(`${raw.id}: storage-enabled activeService requires a runtime surface`);
		}

		seen.add(raw.id);
		previousId = raw.id;
		return {
			id: raw.id,
			stage: raw.stage as HaloReleaseStage,
			surfaces: raw.surfaces as HaloReleaseSurface[],
			...(contentScript ? { contentScript } : {}),
			...(webAccessibleRuntimes ? { webAccessibleRuntimes } : {}),
			...(activeService ? { activeService } : {}),
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
	allModules: readonly DiscoveredModuleLike[],
	manifestsMap: ReadonlyMap<string, PluginManifestLike>,
): void {
	const moduleById = new Map(allModules.map((module) => [module.id, module]));
	const admissionMap = releaseAdmissionMap(admission);
	const contentOutputs = new Set<string>();
	const sourceEntries = new Set<string>();
	const runtimeOutputs = new Set<string>();
	const storageOwners = new Set<string>();

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
			if (sourceEntries.has(entry.contentScript.entry)) {
				throw new Error(`content-script source has multiple release owners: ${entry.contentScript.entry}`);
			}
			contentOutputs.add(entry.contentScript.js);
			sourceEntries.add(entry.contentScript.entry);
		}
		for (const runtime of entry.webAccessibleRuntimes ?? []) {
			if (runtimeOutputs.has(runtime.output)) {
				throw new Error(`web-accessible runtime output has multiple owners: ${runtime.output}`);
			}
			if (sourceEntries.has(runtime.entry)) {
				throw new Error(`web-accessible runtime source has multiple owners: ${runtime.entry}`);
			}
			runtimeOutputs.add(runtime.output);
			sourceEntries.add(runtime.entry);
		}
		if (entry.activeService?.kind === 'storage-enabled') {
			const identity = `${entry.activeService.area}:${entry.activeService.key}`;
			if (storageOwners.has(identity)) throw new Error(`active-service storage has multiple owners: ${identity}`);
			storageOwners.add(identity);
		}
	}

	// A manifest may describe arbitrary catalog inventory, but an explicitly
	// ready/beta executable must not become a misleading UI promise with no
	// release owner. This is the reverse fence that prevents status drift.
	for (const module of allModules) {
		const manifest = manifestsMap.get(module.id);
		if (!manifest || (manifest.status !== 'ready' && manifest.status !== 'beta')) continue;
		if (!admissionMap.has(module.id)) {
			throw new Error(`${module.id}: ${String(manifest.status)} catalog status requires explicit release admission`);
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
	const webAccessibleRuntimeEntries = admission.modules
		.flatMap((entry) => (entry.webAccessibleRuntimes ?? []).map((runtime) => ({
			id: entry.id,
			...runtime,
		})))
		.sort((left, right) => left.output.localeCompare(right.output));
	const webAccessibleResources = webAccessibleRuntimeEntries.map((entry) => entry.output);
	const activeServices = admission.modules.flatMap((entry) => entry.activeService
		? [{ id: entry.id, ...entry.activeService }]
		: []);
	const content = `// AUTO-GENERATED - DO NOT EDIT
// Generated by: bun run generate-registry
// Physical release admission projection; catalog inventory remains in _generated.ts.

import type { PluginId } from './_generated';

export const RELEASE_ADMITTED_PLUGIN_IDS = Object.freeze(${JSON.stringify(admission.modules.map((entry) => entry.id), null, 2)} as const);
export const RELEASE_PANEL_IDS = Object.freeze(${JSON.stringify(bySurface.panel, null, 2)} as const);
export const RELEASE_SCRIPT_RUNTIME_IDS = Object.freeze(${JSON.stringify(bySurface['script-runtime'], null, 2)} as const);
export const RELEASE_CONTENT_RUNTIME_IDS = Object.freeze(${JSON.stringify(bySurface['content-runtime'], null, 2)} as const);
export const RELEASE_BACKGROUND_RUNTIME_IDS = Object.freeze(${JSON.stringify(bySurface['background-runtime'], null, 2)} as const);
export const RELEASE_CONTENT_SCRIPTS = Object.freeze(${JSON.stringify(contentScripts, null, 2)} as const);
export const RELEASE_WEB_ACCESSIBLE_RUNTIME_ENTRIES = Object.freeze(${JSON.stringify(webAccessibleRuntimeEntries, null, 2)} as const);
export const RELEASE_WEB_ACCESSIBLE_RESOURCES = Object.freeze(${JSON.stringify(webAccessibleResources, null, 2)} as const);
export const RELEASE_ACTIVE_SERVICE_CONTRACTS = Object.freeze(${JSON.stringify(activeServices, null, 2)} as const);
export const RELEASE_STAGE_BY_ID = Object.freeze(${JSON.stringify(stages, null, 2)} as const);

export type ReleaseStage = 'catalog' | (typeof RELEASE_STAGE_BY_ID)[keyof typeof RELEASE_STAGE_BY_ID];
const RELEASE_STAGE_RECORD: Readonly<Record<string, Exclude<ReleaseStage, 'catalog'>>> = RELEASE_STAGE_BY_ID;
const RELEASE_ADMITTED_PLUGIN_ID_SET = new Set<string>(RELEASE_ADMITTED_PLUGIN_IDS);

export function releaseStageForPlugin(id: PluginId): ReleaseStage {
\treturn RELEASE_STAGE_RECORD[id] ?? 'catalog';
}

export function isReleaseAdmittedPlugin(id: string): boolean {
\treturn RELEASE_ADMITTED_PLUGIN_ID_SET.has(id);
}
`;
	emitGeneratedFile(OUTPUT_RELEASE_ADMISSION, content, mode, 'release admission projection');
}

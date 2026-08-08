export const CONTENT_STARTUP_SURFACE_NAMES = [
	'allFrameDocumentStart',
	'topFrameDocumentStart',
	'allFrameDocumentIdle',
	'topFrameDocumentIdle',
] as const;

export type ContentStartupSurfaceName = typeof CONTENT_STARTUP_SURFACE_NAMES[number];

export type ContentStartupSurfaces<T> = Record<ContentStartupSurfaceName, T>;

interface ContentScriptRegistration {
	all_frames?: unknown;
	js?: unknown;
	run_at?: unknown;
}

interface ExtensionManifest {
	content_scripts?: unknown;
}

export interface StaticClosure {
	outputBytes: ReadonlyMap<string, number>;
}

function asManifest(value: unknown): ExtensionManifest {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error('HALO manifest must be an object for startup accounting');
	}
	return value as ExtensionManifest;
}

function asRegistration(value: unknown, index: number): ContentScriptRegistration {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(`HALO content_scripts[${index}] must be an object`);
	}
	return value as ContentScriptRegistration;
}

function registrationOutputs(registration: ContentScriptRegistration, index: number): string[] {
	if (registration.js === undefined) return [];
	if (!Array.isArray(registration.js)) {
		throw new Error(`HALO content_scripts[${index}].js must be an array`);
	}
	return registration.js.map((value, jsIndex) => {
		if (typeof value !== 'string' || value.length === 0) {
			throw new Error(`HALO content_scripts[${index}].js[${jsIndex}] must be a non-empty string`);
		}
		return value;
	});
}

function registrationRunAt(registration: ContentScriptRegistration, index: number): 'document_start' | 'document_idle' {
	const runAt = registration.run_at ?? 'document_idle';
	if (runAt !== 'document_start' && runAt !== 'document_idle') {
		throw new Error(
			`HALO content_scripts[${index}] uses unsupported run_at=${JSON.stringify(runAt)}; ` +
			'production startup accounting requires an explicit document_start or document_idle surface',
		);
	}
	return runAt;
}

function registrationAllFrames(registration: ContentScriptRegistration, index: number): boolean {
	if (registration.all_frames === undefined) return false;
	if (typeof registration.all_frames !== 'boolean') {
		throw new Error(`HALO content_scripts[${index}].all_frames must be boolean when present`);
	}
	return registration.all_frames;
}

export function classifyContentStartupSurfaces(manifestValue: unknown): ContentStartupSurfaces<readonly string[]> {
	const manifest = asManifest(manifestValue);
	if (manifest.content_scripts === undefined) {
		return {
			allFrameDocumentStart: [],
			topFrameDocumentStart: [],
			allFrameDocumentIdle: [],
			topFrameDocumentIdle: [],
		};
	}
	if (!Array.isArray(manifest.content_scripts)) {
		throw new Error('HALO manifest content_scripts must be an array');
	}

	const surfaces: ContentStartupSurfaces<Set<string>> = {
		allFrameDocumentStart: new Set(),
		topFrameDocumentStart: new Set(),
		allFrameDocumentIdle: new Set(),
		topFrameDocumentIdle: new Set(),
	};

	for (const [index, rawRegistration] of manifest.content_scripts.entries()) {
		const registration = asRegistration(rawRegistration, index);
		const outputs = registrationOutputs(registration, index);
		if (outputs.length === 0) continue;
		const runAt = registrationRunAt(registration, index);
		const allFrames = registrationAllFrames(registration, index);
		const topSurface = runAt === 'document_start'
			? surfaces.topFrameDocumentStart
			: surfaces.topFrameDocumentIdle;
		const allFrameSurface = runAt === 'document_start'
			? surfaces.allFrameDocumentStart
			: surfaces.allFrameDocumentIdle;

		for (const output of outputs) {
			topSurface.add(output);
			if (allFrames) allFrameSurface.add(output);
		}
	}

	return {
		allFrameDocumentStart: [...surfaces.allFrameDocumentStart].sort(),
		topFrameDocumentStart: [...surfaces.topFrameDocumentStart].sort(),
		allFrameDocumentIdle: [...surfaces.allFrameDocumentIdle].sort(),
		topFrameDocumentIdle: [...surfaces.topFrameDocumentIdle].sort(),
	};
}

function measureSurface(
	outputs: readonly string[],
	closureForOutput: (output: string) => StaticClosure,
): number {
	const physicalOutputs = new Map<string, number>();
	for (const output of outputs) {
		const closure = closureForOutput(output);
		if (!(closure.outputBytes instanceof Map)) {
			throw new Error(`HALO static closure for ${output} did not provide outputBytes`);
		}
		for (const [physicalOutput, bytes] of closure.outputBytes) {
			if (!Number.isFinite(bytes) || bytes < 0) {
				throw new Error(`HALO static closure has invalid byte count for ${physicalOutput}: ${bytes}`);
			}
			const existing = physicalOutputs.get(physicalOutput);
			if (existing !== undefined && existing !== bytes) {
				throw new Error(
					`HALO startup accounting saw conflicting byte counts for ${physicalOutput}: ` +
					`${existing} vs ${bytes}`,
				);
			}
			physicalOutputs.set(physicalOutput, bytes);
		}
	}
	return [...physicalOutputs.values()].reduce((total, bytes) => total + bytes, 0);
}

export function measureContentStartupSurfaces(
	manifestValue: unknown,
	closureForOutput: (output: string) => StaticClosure,
): ContentStartupSurfaces<number> {
	const surfaces = classifyContentStartupSurfaces(manifestValue);
	return {
		allFrameDocumentStart: measureSurface(surfaces.allFrameDocumentStart, closureForOutput),
		topFrameDocumentStart: measureSurface(surfaces.topFrameDocumentStart, closureForOutput),
		allFrameDocumentIdle: measureSurface(surfaces.allFrameDocumentIdle, closureForOutput),
		topFrameDocumentIdle: measureSurface(surfaces.topFrameDocumentIdle, closureForOutput),
	};
}

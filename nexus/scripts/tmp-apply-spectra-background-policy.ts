import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const spectraDir = resolve(workspaceDir, 'apps/extension-spectra/src/background');

function replaceOnce(source: string, from: string, to: string, label: string): string {
	const first = source.indexOf(from);
	if (first < 0) throw new Error(`Missing ${label}`);
	if (source.indexOf(from, first + from.length) >= 0) throw new Error(`Ambiguous ${label}`);
	return source.slice(0, first) + to + source.slice(first + from.length);
}

function patchCoordinator(): void {
	const path = resolve(spectraDir, 'control-coordinator.ts');
	let source = readFileSync(path, 'utf8');
	for (const line of [
		'\tCONTROL_ALGORITHM_POLICIES,\n',
		'\tresolveAcknowledgedAudioVolumeState,\n',
		'\tresolveControlAudioVolume,\n',
	]) {
		source = replaceOnce(source, line, '', `control-coordinator import ${line.trim()}`);
	}
	source = replaceOnce(
		source,
		"} from './runtime-loader';\nimport { swLog } from '../shared/logger';",
		"} from './runtime-loader';\nimport {\n\tbackgroundControlTargetScopeFlags,\n\tbackgroundResolveAcknowledgedAudioVolumeState,\n\tbackgroundResolveControlAudioVolume,\n} from './background-control-policy';\nimport { swLog } from '../shared/logger';",
		'control-coordinator background projection import',
	);
	const functionStart = source.indexOf('function controlTargetScopeFlags(');
	const functionEnd = source.indexOf('\n\nfunction assertUnambiguousTargetScope', functionStart);
	if (functionStart < 0 || functionEnd < 0) throw new Error('Missing controlTargetScopeFlags owner');
	source = source.slice(0, functionStart) + source.slice(functionEnd + 2);
	source = source.replaceAll('controlTargetScopeFlags(', 'backgroundControlTargetScopeFlags(');
	source = source.replaceAll(
		'resolveAcknowledgedAudioVolumeState(',
		'backgroundResolveAcknowledgedAudioVolumeState(',
	);
	source = source.replaceAll('resolveControlAudioVolume(', 'backgroundResolveControlAudioVolume(');
	writeFileSync(path, source);
}

function patchRuntimeLoader(): void {
	const path = resolve(spectraDir, 'runtime-loader.ts');
	let source = readFileSync(path, 'utf8');
	source = replaceOnce(
		source,
		'\tCONTROL_ALGORITHM_POLICIES,\n',
		'',
		'runtime-loader CONTROL_ALGORITHM_POLICIES import',
	);
	source = replaceOnce(
		source,
		'\ttype ControlField,\n',
		'\ttype ControlSessionField,\n',
		'runtime-loader ControlField import',
	);
	source = replaceOnce(
		source,
		"import { ensureCaptureStatesReconciled } from './handlers/capture';",
		"import { ensureCaptureStatesReconciled } from './handlers/capture';\nimport { backgroundRestoreBucket } from './background-control-policy';",
		'runtime-loader background projection import',
	);
	const oldRouting = `\tfor (const [rawField, value] of Object.entries(patch)) {\n\t\tconst field = rawField as ControlField;\n\t\tconst policy = CONTROL_ALGORITHM_POLICIES[field];\n\t\tconst target = policy.scope === 'active-video'\n\t\t\t? video\n\t\t\t: policy.scope === 'document'\n\t\t\t\t|| policy.orderedStrategies.some((strategy) => (\n\t\t\t\t\tstrategy === 'media-webaudio' || strategy === 'capture'\n\t\t\t\t))\n\t\t\t\t\t? full\n\t\t\t\t\t: media;\n\t\t(target as Record<string, unknown>)[field] = structuredClone(value);\n\t}`;
	const newRouting = `\tfor (const [rawField, value] of Object.entries(patch)) {\n\t\tconst field = rawField as ControlSessionField;\n\t\tconst bucket = backgroundRestoreBucket(field);\n\t\tconst target = bucket === 'video' ? video : bucket === 'full' ? full : media;\n\t\t(target as Record<string, unknown>)[field] = structuredClone(value);\n\t}`;
	source = replaceOnce(source, oldRouting, newRouting, 'runtime-loader restore routing');
	writeFileSync(path, source);
}

patchCoordinator();
patchRuntimeLoader();
console.log('✓ Applied SPECTRA Background control-policy projection');

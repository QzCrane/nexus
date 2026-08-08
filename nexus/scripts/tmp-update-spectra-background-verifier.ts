import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const verifierPath = resolve(workspaceDir, 'scripts/verify/check-spectra-control.ts');
let source = readFileSync(verifierPath, 'utf8');

const startMarker = `\tfor (const required of [\n\t\t'function projectControlTarget(',\n\t\t'function assertUnambiguousTargetScope(',\n\t\t'CONTROL_ALGORITHM_POLICIES[capability].scope',`;
const endMarker = `\tif (coordinator.includes('activeMedia = response.data.target')) {`;
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error('Unable to locate legacy ACK target projection verifier');

const replacement = `\tconst backgroundControlPolicy = fs.readFileSync(\n\t\tpath.join(root, SOURCE_PATH, 'background/background-control-policy.ts'),\n\t\t'utf8',\n\t);\n\tconst backgroundControlPolicyTest = fs.readFileSync(\n\t\tpath.join(root, APP_PATH, 'test/background-control-policy.spec.ts'),\n\t\t'utf8',\n\t);\n\tconst backgroundRuntimeLoader = fs.readFileSync(\n\t\tpath.join(root, SOURCE_PATH, 'background/runtime-loader.ts'),\n\t\t'utf8',\n\t);\n\tfor (const required of [\n\t\t'function projectControlTarget(',\n\t\t'function assertUnambiguousTargetScope(',\n\t\t'backgroundControlTargetScopeFlags(capabilities)',\n\t\t'ackTarget = response.data.target',\n\t\t'Mixed media/video controls require one explicit video target',\n\t]) {\n\t\tif (!coordinator.includes(required)) {\n\t\t\terror(\`SCTRL-002/SCTRL-025/SCTRL-029: ACK target projection must remain contract-scoped (\${required})\`);\n\t\t}\n\t}\n\tfor (const required of [\n\t\t'BACKGROUND_MEDIA_TARGET_CAPABILITIES',\n\t\t'BACKGROUND_VIDEO_TARGET_CAPABILITIES',\n\t\t'BACKGROUND_PROCESSOR_FIELDS',\n\t\t'backgroundControlTargetScopeFlags(',\n\t\t'backgroundRestoreBucket(',\n\t\t'backgroundResolveAcknowledgedProcessorLifecycle(',\n\t\t'backgroundResolveControlAudioVolume(',\n\t]) {\n\t\tif (!backgroundControlPolicy.includes(required)) {\n\t\t\terror(\`SCTRL-002/SCTRL-025/SCTRL-029/SCTRL-034: narrow Background policy projection is incomplete (\${required})\`);\n\t\t}\n\t}\n\tif (coordinator.includes('CONTROL_ALGORITHM_POLICIES')\n\t\t|| backgroundRuntimeLoader.includes('CONTROL_ALGORITHM_POLICIES')\n\t\t|| !backgroundControlPolicyTest.includes('matches canonical target-scope semantics for every capability')\n\t\t|| !backgroundControlPolicyTest.includes('matches canonical document-restore routing for every session field')\n\t\t|| !backgroundControlPolicyTest.includes('matches the canonical processor-readback field set')\n\t\t|| !backgroundControlPolicyTest.includes('matches canonical acknowledged audio-volume projection semantics')) {\n\t\terror('SCTRL-002/SCTRL-016/SCTRL-025/SCTRL-029/SCTRL-034: Background projection must stay small and exhaustively release-gated against canonical control policy');\n\t}\n`;

source = source.slice(0, start) + replacement + source.slice(end);
writeFileSync(verifierPath, source);
console.log('✓ Updated SPECTRA Background policy verifier');

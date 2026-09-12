import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
	CONTROL_ALGORITHM_ADJUDICATIONS,
	CONTROL_ALGORITHM_POLICIES,
	CONTROL_CAPABILITIES,
	CONTROL_STRATEGIES,
	CONTROL_STRATEGY_RULES,
	controlCapabilityUsesAcknowledgement,
	controlCapabilityUsesStrategy,
	selectControlAlgorithmAdjudication,
	selectControlAlgorithmPolicy,
	selectControlCapabilityScope,
	selectControlStrategyRule,
} from '../../packages/contracts/src/control.contracts.ts';
import {
	HOTKEY_ACTIONS,
	HOTKEY_ACTION_DESCRIPTORS,
	hotkeyActionRequiresUserActivation,
	selectHotkeyActionDescriptor,
	selectHotkeyAvailability,
	selectHotkeyCapability,
	selectHotkeyFeedbackOwner,
	selectHotkeyParameterKind,
	selectHotkeyRepeatPolicy,
} from '../../packages/contracts/src/hotkeys.contracts.ts';
import { SPECTRA_CONTROL_ALGORITHM_ADJUDICATIONS } from './spectra-control-algorithm-catalog.ts';
import { missingSourceEvidence } from './source-evidence.ts';
import { error, ok, scanDir, section } from './utils.ts';

const APP_PATH = 'apps/extension-spectra';
const SOURCE_PATH = `${APP_PATH}/src`;

const LEGACY_WRITERS = Object.freeze({
	volume: new Set(),
	muted: new Set(),
	playbackRate: new Set([
		`${SOURCE_PATH}/content/audio/volume-observer.ts`,
		`${SOURCE_PATH}/content/logic/media-control.ts`,
	]),
	currentTime: new Set([
		`${SOURCE_PATH}/content/input/hotkey-helpers.ts`,
		`${SOURCE_PATH}/content/logic/media-control.ts`,
		`${SOURCE_PATH}/content/video/ab-loop.ts`,
		`${SOURCE_PATH}/content/video/time-marker.ts`,
	]),
	preservesPitch: new Set(),
	loop: new Set(),
	inlineVideoStyle: new Set([
		`${SOURCE_PATH}/content/video/video-filter.ts`,
		`${SOURCE_PATH}/content/video/video-transform.ts`,
	]),
	focusRecovery: new Set([
		`${SOURCE_PATH}/content/logic/media-control.ts`,
		`${SOURCE_PATH}/content/video/video-transform.ts`,
	]),
});

const CANONICAL_WRITERS = Object.freeze({
	volume: new Set([`${SOURCE_PATH}/content/logic/native-media-executor.ts`]),
	muted: new Set([`${SOURCE_PATH}/content/logic/native-media-executor.ts`]),
	playbackRate: new Set([`${SOURCE_PATH}/content/logic/native-media-executor.ts`]),
	currentTime: new Set([`${SOURCE_PATH}/content/logic/native-media-async.ts`]),
	preservesPitch: new Set([`${SOURCE_PATH}/content/logic/native-media-executor.ts`]),
	loop: new Set([`${SOURCE_PATH}/content/logic/native-media-executor.ts`]),
	inlineVideoStyle: new Set(),
	focusRecovery: new Set(),
});

function normalize(root, fullPath) {
	return path.relative(root, fullPath).replaceAll('\\', '/');
}

function executableSource(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//gu, '')
		.replace(/\/\/.*$/gmu, '');
}

export function hasNamedImports(source, moduleSpecifier, requiredNames) {
	const escapedSpecifier = moduleSpecifier.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
	const importPattern = new RegExp(
		`\\bimport\\s*\\{([^}]*)\\}\\s*from\\s*['"]${escapedSpecifier}['"]`,
		'gu',
	);
	const importedNames = new Set();
	for (const match of source.matchAll(importPattern)) {
		for (const binding of match[1].split(',')) {
			const importedName = binding
				.trim()
				.replace(/^type\s+/u, '')
				.split(/\s+as\s+/u)[0]
				?.trim();
			if (importedName) importedNames.add(importedName);
		}
	}
	return requiredNames.every((name) => importedNames.has(name));
}

function checkSourceAlgorithmCatalog(root, contracts, architecture) {
	const extractCapabilities = (name) => {
		const match = contracts.match(new RegExp(`export const ${name} = \\[(.*?)\\] as const`, 'su'));
		return match
			? [...match[1].matchAll(/'([^']+)'/gu)].map((item) => item[1])
			: [];
	};
	const capabilities = new Set([
		...extractCapabilities('CONTROL_FIELDS'),
		...extractCapabilities('CONTROL_OPERATIONS'),
	]);
	const covered = new Set();
	const ids = new Set();
	const sourceAnchors = new Set();
	const decisions = new Set([
		'native-control',
		'hybrid-state-native',
		'controlled-augmentation',
		'observation-only',
		'pure-computation',
		'intent-routing',
		'lifecycle-orchestration',
	]);
	const admissions = new Set([
		'none',
		'extension-owned',
		'explicit-foreground-subscription',
		'sandbox-only',
		'not-applicable',
	]);
	const recurring = new Set([
		'none',
		'while-owned',
		'while-subscribed',
		'page-lifetime-after-media-binding',
	]);

	for (const [index, algorithm] of SPECTRA_CONTROL_ALGORITHM_ADJUDICATIONS.entries()) {
		const expectedId = `ALG-${String(index + 1).padStart(3, '0')}`;
		if (algorithm.id !== expectedId || ids.has(algorithm.id)) {
			error(`SCTRL-002/SCTRL-016: source algorithm IDs must be unique and sequential (${algorithm.id}/${expectedId})`);
		}
		ids.add(algorithm.id);
		const sourceAnchor = `${algorithm.source}#${algorithm.anchor}`;
		if (sourceAnchors.has(sourceAnchor)) {
			error(`SCTRL-016: source algorithm anchor must be unique (${sourceAnchor})`);
		}
		sourceAnchors.add(sourceAnchor);
		if (!decisions.has(algorithm.decision)
			|| !admissions.has(algorithm.augmentationAdmission)
			|| !recurring.has(algorithm.recurringWork)
			|| algorithm.interceptionPolicy !== 'forbidden') {
			error(`SCTRL-002: invalid source algorithm adjudication for ${algorithm.id}`);
		}
		if (algorithm.decision === 'native-control'
			&& algorithm.augmentationAdmission !== 'none') {
			error(`SCTRL-002: native algorithm ${algorithm.id} cannot admit generic augmentation`);
		}
		if (algorithm.recurringWork !== 'none'
			&& ['controlled-augmentation', 'lifecycle-orchestration'].includes(algorithm.decision)
			&& ['none', 'not-applicable'].includes(algorithm.augmentationAdmission)) {
			error(`SCTRL-013: recurring algorithm ${algorithm.id} needs an explicit owned/subscribed admission`);
		}
		if (!algorithm.successProof || !algorithm.performanceBoundary) {
			error(`SCTRL-005/SCTRL-013: ${algorithm.id} needs success proof and a performance boundary`);
		}
		for (const capability of algorithm.capabilities) {
			if (!capabilities.has(capability)) {
				error(`SCTRL-002: ${algorithm.id} references unknown capability ${capability}`);
			}
			covered.add(capability);
		}
		const sourcePath = path.join(root, algorithm.source);
		if (!fs.existsSync(sourcePath)) {
			error(`SCTRL-016: ${algorithm.id} source is missing (${algorithm.source})`);
		} else if (!fs.readFileSync(sourcePath, 'utf8').includes(algorithm.anchor)) {
			error(`SCTRL-016: ${algorithm.id} source anchor drifted (${algorithm.anchor})`);
		}
		if (!architecture.includes(`| \`${algorithm.id}\` |`)) {
			error(`SCTRL-016: architecture is missing source algorithm row ${algorithm.id}`);
		}
	}

	for (const capability of capabilities) {
		if (!covered.has(capability)) {
			error(`SCTRL-002/SCTRL-016: source algorithm catalog does not own ${capability}`);
		}
	}
	if (SPECTRA_CONTROL_ALGORITHM_ADJUDICATIONS.length !== 50) {
		error(`SCTRL-002/SCTRL-016: source algorithm inventory drifted (${SPECTRA_CONTROL_ALGORITHM_ADJUDICATIONS.length}/50)`);
	}
}

function checkDefaultRuntime(root) {
	const app = path.join(root, APP_PATH);
	const manifest = JSON.parse(fs.readFileSync(path.join(app, 'public/manifest.json'), 'utf8'));
	// Allowlist: MAIN-world bridges that must be present at document_start so
	// Chrome injects them before any page script can call requestFullscreen and
	// before an exact media controller is first queried. Each bridge module owns
	// a versioned guard that makes a second
	// injection (warm-update / on-demand via main-runtime-manager.ts) a no-op,
	// so the manifest entry and the runtime re-injection path coexist safely.
	const ALLOWED_MAIN_BRIDGES = Object.freeze({
		'content-fullscreen-bridge.js': '__SPECTRA_FULLSCREEN_BRIDGE_V1__',
		'content-page-media-bridge.js': '__SPECTRA_PAGE_MEDIA_BRIDGE_V2__',
	});
	const seenMainBridges = new Set();
	const scripts = manifest.content_scripts ?? [];
	for (const item of scripts) {
		const files = item.js ?? [];
		if (item.world === 'MAIN') {
			if (files.length !== 1 || !Object.hasOwn(ALLOWED_MAIN_BRIDGES, files[0])) {
				error(`SCTRL-001/SCTRL-004: manifest MAIN world entry must be an allowlisted bridge, got ${files.join(', ')}`);
			} else {
				seenMainBridges.add(files[0]);
			}
		} else {
			if (files.length !== 1 || files[0] !== 'content-bootstrap.js') {
				error(`SCTRL-001: manifest ISOLATED content entry must be only content-bootstrap.js, got ${files.join(', ')}`);
			}
		}
	}
	for (const bridge of Object.keys(ALLOWED_MAIN_BRIDGES)) {
		if (!seenMainBridges.has(bridge)) {
			error(`SCTRL-001/SCTRL-004: manifest must register the MAIN world bridge ${bridge} at document_start`);
		}
	}
	// Verify each allowlisted bridge module actually owns its versioned guard so the
	// manifest entry cannot silently drift away from the no-op re-injection
	// contract that main-runtime-manager.ts relies on.
	const BRIDGE_SOURCE_NAME = {
		'content-fullscreen-bridge.js': 'fullscreen-bridge.ts',
		'content-page-media-bridge.js': 'page-media-bridge.ts',
	};
	for (const [bridge, guard] of Object.entries(ALLOWED_MAIN_BRIDGES)) {
		const bridgePath = path.join(app, 'src/content/injector', BRIDGE_SOURCE_NAME[bridge]);
		if (!fs.existsSync(bridgePath)) {
			error(`SCTRL-001/SCTRL-004: allowlisted MAIN bridge source is missing (${bridgePath})`);
		} else if (!fs.readFileSync(bridgePath, 'utf8').includes(guard)) {
			error(`SCTRL-001/SCTRL-004: MAIN bridge ${bridge} lost its versioned guard ${guard}`);
		}
	}

	const pageMediaBridge = fs.readFileSync(
		path.join(app, 'src/content/injector/page-media-bridge.ts'),
		'utf8',
	);
	for (const required of [
		'const MAX_ANCESTOR_DEPTH = 12',
		'const MAX_ATTACHED_PROPERTIES = 96',
		'function controllerAssociation(',
		"dataProperty(controller, key) === element",
		'function findCapability(',
		'associationRank(right.association) - associationRank(left.association)',
		'left.distance - right.distance',
		'if (!(element instanceof HTMLMediaElement)) return;',
		"if (requestedValue === undefined) throw new Error('Page media write request has no value');",
		'capability.write(requestedValue);',
		'const actual = capability.read();',
		'capability.write(before);',
		'document.addEventListener(SPECTRA_PAGE_MEDIA_EVENT, onPageMediaRequest, true);',
	]) {
		if (!pageMediaBridge.includes(required)) {
			error(`SCTRL-004/SCTRL-005/SCTRL-017: exact-element page-media bridge boundary drifted (${required})`);
		}
	}
	for (const forbidden of [
		/\b(?:async|await|Promise|setTimeout|setInterval|requestAnimationFrame|requestIdleCallback|MutationObserver|ResizeObserver)\b/u,
		/\b(?:hostname|youtube)\b/iu,
		/\[class\*=/u,
		/window\.postMessage/u,
	]) {
		if (forbidden.test(pageMediaBridge)) {
			error(`SCTRL-004/SCTRL-013: page-media bridge must stay synchronous, domain-neutral and observer-free (${forbidden})`);
		}
	}
	const pageMediaContract = fs.readFileSync(
		path.join(app, 'src/shared/page-media-bridge.ts'),
		'utf8',
	);
	if (!/SPECTRA_PAGE_MEDIA_FIELDS = \[\s*'volumeBase',\s*'mediaMuted',\s*'speed',\s*\] as const;/su.test(pageMediaContract)) {
		error('SCTRL-002/SCTRL-004: exact-element MAIN admission must stay limited to volumeBase, mediaMuted and speed');
	}

	const build = fs.readFileSync(path.join(app, 'build.ts'), 'utf8');
	for (const forbidden of [
		"src/injector/index.ts",
		"out: 'injector.js'",
		"out: \"injector.js\"",
		'src/injector/',
	]) {
		if (build.includes(forbidden)) error(`SCTRL-004: generic MAIN bundle entry is forbidden (${forbidden})`);
	}
}

function checkAudioProcessorOwners(root) {
	const captureOwnerRelative = `${SOURCE_PATH}/offscreen/audio-host.ts`;
	const captureOwnerPath = path.join(root, captureOwnerRelative);
	const mediaOwnerRelative = 'packages/features/audio-engine/src/WebAudioController.ts';
	const mediaOwnerPath = path.join(root, mediaOwnerRelative);
	const retiredPaths = [
		`${SOURCE_PATH}/content/core/lifecycle/media-observer.ts`,
		`${SOURCE_PATH}/background/registry-repository.ts`,
		`${SOURCE_PATH}/popup/views/registry-ui.ts`,
		`${SOURCE_PATH}/popup/utils/registry-helpers.ts`,
		'packages/contracts/src/registry.contracts.ts',
		'packages/features/audio-engine/src/CapabilityPlanner.ts',
		'packages/features/audio-engine/src/PolicyEngine.ts',
		'packages/features/audio-engine/src/color-predictor.ts',
		'packages/features/audio-engine/src/webaudio/controller.ts',
		'packages/features/audio-engine/src/webaudio/index.ts',
	];
	for (const relative of retiredPaths) {
		if (fs.existsSync(path.join(root, relative))) {
			error(`SCTRL-003/SCTRL-008/SCTRL-041: retired/forbidden processor or route path returned (${relative})`);
		}
	}
	if (!fs.existsSync(captureOwnerPath) || !fs.existsSync(mediaOwnerPath)) {
		error('SCTRL-003/SCTRL-008/SCTRL-041: the three-state audio policy requires both Media WebAudio and Capture owners');
		return;
	}

	const processorConstruction = /\bnew\s+(?:window\.)?(?:AudioContext|webkitAudioContext)\s*\(|\bcreateMediaStreamSource\s*\(|\bcreateMediaElementSource\s*\(|\bMediaElementAudioSourceNode\b/u;
	const forbiddenImport = /(?:from\s+|import\s*\(\s*)['"][^'"]*(?:CapabilityPlanner|PolicyEngine|media-observer)[^'"]*['"]/iu;
	const forbiddenBinding = /\b(?:SiteRouteRecord|CapabilityPlanner|PolicyEngine)\b/u;
	scanDir(path.join(root, SOURCE_PATH), (fullPath, entry) => {
		if (!/\.(?:ts|tsx|js|mjs)$/u.test(entry.name) || entry.name.endsWith('.d.ts')) return;
		const relative = normalize(root, fullPath);
		const raw = fs.readFileSync(fullPath, 'utf8');
		const source = executableSource(raw);
		if (processorConstruction.test(source)
			&& relative !== captureOwnerRelative
			&& relative !== mediaOwnerRelative) {
			error(`SCTRL-003/SCTRL-008: audio processor construction escaped the two physical owners (${relative})`);
		}
		if (forbiddenImport.test(source) || forbiddenBinding.test(source)) {
			error(`SCTRL-003/SCTRL-008/SCTRL-041: production source imports or binds a retired processor/route owner (${relative})`);
		}
	});

	const host = fs.readFileSync(captureOwnerPath, 'utf8');
	for (const required of [
		'const processors = new Map<number, AudioProcessor>()',
		'async function startCapture(',
		'ctx = new AudioContext()',
		'ctx.createMediaStreamSource(stream)',
		"if (ctx.state !== 'running')",
		'processors.set(tabId, candidate)',
		'function activeResult(processor: AudioProcessor)',
		'contextState: \'running\'',
		'graphSignature: processor.snapshot.graphSignature',
		'normalizedActualConfig: processor.snapshot.normalizedActualConfig',
		'function getVisualizerFrame(tabId: number)',
		'if (!processor || !visualizerSubscriptions.has(tabId)) return EMPTY_VISUALIZER_FRAME;',
		'processor.router.getVisualizerData()',
	]) {
		if (!host.includes(required)) {
			error(`SCTRL-003/SCTRL-008/SCTRL-013: Capture owner lost the required physical/readback boundary (${required})`);
		}
	}
	if (/createMediaElementSource|MediaElementAudioSourceNode/u.test(executableSource(host))) {
		error('SCTRL-003/SCTRL-008: Capture owner must not bind a page MediaElementAudioSourceNode');
	}
	const mediaOwner = fs.readFileSync(mediaOwnerPath, 'utf8');
	for (const required of [
		'export function assessMediaSourceEligibility(',
		'export function assessMediaSourceCoverage(',
		'context.createMediaElementSource(element)',
		'canAttachAll(',
		'hasCompleteCoverage(',
		'runtime.router.apply(',
		'setVisualizerSubscribed(',
		'for (const element of [...this.ownedSources]) this.detachNode(element);',
	]) {
		if (!mediaOwner.includes(required)) {
			error(`SCTRL-003/SCTRL-008/SCTRL-013: Media WebAudio owner lost exact coverage/readback/lifecycle proof (${required})`);
		}
	}
	if (/\.crossOrigin\s*=|setAttribute\(\s*['"]crossorigin/iu.test(executableSource(mediaOwner))
		|| /createMediaStreamSource/u.test(executableSource(mediaOwner))) {
		error('SCTRL-003/SCTRL-008: Media WebAudio must neither mutate CORS state nor acquire a tab stream');
	}

	const audioContracts = fs.readFileSync(
		path.join(root, 'packages/contracts/src/audio.contracts.ts'),
		'utf8',
	);
	for (const required of [
		'export function requiresAudioProcessor(',
		'export interface AudioProcessorDemand',
		'export function resolveDesiredAudioMode(',
		'!requiresAudioProcessor(config) && !demand.visualizer',
		'mediaWebAudio: boolean;',
		"return demand.mediaWebAudio ? 'webaudio' : 'capture';",
		'export interface AudioSessionSnapshot',
		'export function isActiveCaptureLifecycle(',
		"value.actualMode === 'capture' && value.phase === 'active'",
		'configRevision',
		'actualConfig',
	]) {
		if (!audioContracts.includes(required)) {
			error(`SCTRL-002/SCTRL-005/SCTRL-008: audio contract lost Capture lifecycle authority (${required})`);
		}
	}
	const offscreenContracts = fs.readFileSync(
		path.join(root, 'packages/contracts/src/offscreen.contracts.ts'),
		'utf8',
	);
	for (const required of [
		'export type OffscreenAudioResult =',
		'controlRevision: number;',
		"phase: 'active';",
		"contextState: 'running';",
		'graphSignature: string;',
		'normalizedActualConfig: AudioProcessorConfig;',
		"phase: 'idle';",
		"contextState: 'closed';",
		"graphSignature: 'none';",
		'normalizedActualConfig: null;',
		'export function isOffscreenAudioResult(',
	]) {
		if (!offscreenContracts.includes(required)) {
			error(`SCTRL-005/SCTRL-008: offscreen Capture ACK contract lost an exact identity/readback field (${required})`);
		}
	}
	const captureAdmission = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'background/capture-admission.ts'),
		'utf8',
	);
	for (const required of [
		'export function mintCaptureAdmission(',
		'export function consumeCaptureAdmission(',
		'isCaptureAdmissionFenceCurrent(',
		'oneShot: true',
		'CAPTURE_ADMISSION_TTL_MS',
	]) {
		if (!captureAdmission.includes(required)) {
			error(`SCTRL-041: Capture admission owner lost its one-shot document fence (${required})`);
		}
	}
	const captureHandler = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'background/handlers/capture.ts'),
		'utf8',
	);
	for (const required of [
		'async function commitCaptureSnapshot(',
		'async function publishAcknowledgedCaptureState(',
		'audioGraphSignature(result.normalizedActualConfig) === result.graphSignature',
		'result.generation !== generation',
		'result.controlRevision !== controlRevision',
		"result.contextState !== 'running'",
		"result.phase !== 'active'",
		'state.controlRevision = result.controlRevision',
		'state.actualConfig = actualConfigFromProcessor(config, result.normalizedActualConfig)',
	]) {
		if (!captureHandler.includes(required)) {
			error(`SCTRL-005/SCTRL-008/SCTRL-041: Background must publish only an exact Capture ACK (${required})`);
		}
	}

	const captureManager = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/audio/capture-manager.ts'),
		'utf8',
	);
	for (const required of [
		'function applyConfirmedState(',
		'shouldAcceptAudioSessionPhase(',
		'actualConfig',
		"Capture start requires a one-shot Background admission",
		'response.data.generation',
		'continuationAdmission',
	]) {
		if (!captureManager.includes(required)) {
			error(`SCTRL-005/SCTRL-008: Content Capture state must accept only monotonic acknowledged readback (${required})`);
		}
	}

	const modeExecutor = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/logic/mode-executor.ts'),
		'utf8',
	);
	const modeExecutable = executableSource(modeExecutor);
	if (processorConstruction.test(modeExecutable)) {
		error('SCTRL-003/SCTRL-008: Content mode executor must not construct an audio processor');
	}
	for (const required of [
		'export function createModeExecutor(',
		'owner.disposed = true',
		'async function executeModeTransition(',
		"mode === 'webaudio'",
		'async function enterWebAudio(',
		'deps.audioController.canAttachAll(',
		'deps.audioController.hasCompleteCoverage(',
		'actualConfigFromGraphSnapshot(',
		'snapshot.sourceCount !== expectedSources',
		'deps.audioController.setVisualizerSubscribed(',
		'async function fallbackFromWebAudio(',
		"captureAdmission?.kind === 'capture-start'",
		'captureManager.request(true',
		'captureManager.syncConfig',
		"result.phase === 'active'",
		'captureManager.request(false',
		'transparentAudioConfig()',
		'CAPTURE_ADMISSION_REQUIRED',
	]) {
		if (!modeExecutor.includes(required)) {
			error(`SCTRL-003/SCTRL-005/SCTRL-008: Content mode transition lost the three-owner lifecycle boundary (${required})`);
		}
	}

	const visualizerLoop = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'popup/visualizer/loop.ts'),
		'utf8',
	);
	for (const required of [
		'isProcessorActive: () => boolean',
		'allowCaptureAcquisition: boolean',
		'subscription.params.isProcessorActive()',
		'subscription.params.allowCaptureAcquisition',
		'captureTabId',
		'batchRetryAt',
		'VISUALIZER_STATE_CHANGED_EVENT',
		'spectra.audio.visualizer.batch',
		'response.data.generation === generation',
	]) {
		if (!visualizerLoop.includes(required)) {
			error(`SCTRL-013/SCTRL-021: Visualizer lost its foreground-only bounded scheduler (${required})`);
		}
	}
	const audioHandler = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'background/handlers/audio.ts'),
		'utf8',
	);
	for (const required of [
		'isExtensionPopupSender(sender)',
		'reconcileVisualizerSourceOwners(',
		'acquirePopupVisualizerSource(',
		'releasePopupVisualizerSource(',
		'scheduleVisualizerSourceOwnerRetry(',
		'captureStates.get(tabId) === true',
		"'spectra.audio.visualizer.get'",
		'OFFSCREEN_AUDIO_SET_VIZ_SUBSCRIPTIONS',
		'OFFSCREEN_AUDIO_GET_VIZ_BATCH',
		'const captureTabIds',
		'unionCaptureTabIds',
	]) {
		if (!audioHandler.includes(required)) {
			error(`SCTRL-013/SCTRL-021: Visualizer Background ownership/admitted Capture projection drifted (${required})`);
		}
	}
	const coordinator = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'background/control-coordinator.ts'),
		'utf8',
	);
	for (const required of [
		'export async function acquirePopupVisualizerSource(',
		'captureAdmissionForInvocation(',
		"'spectra.audio.visualizer.demand.set'",
		"'visualizer'",
		'export function releasePopupVisualizerSource(',
		'chrome.webNavigation.getFrame({',
		'interface PopupVisualizerSourceAcquisition',
		"actualMode: 'webaudio' | 'capture' | null;",
		'lease: pendingLease',
	]) {
		if (!coordinator.includes(required)) {
			error(`SCTRL-013/SCTRL-021/SCTRL-041: Visualizer transient Capture lost foreground/document admission or release compensation (${required})`);
		}
	}
	const contentMessageHandler = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/logic/message-handler.ts'),
		'utf8',
	);
	for (const required of [
		"message.type !== 'spectra.audio.visualizer.get'",
		'deps.audioController.getVisualizerData()',
		"message.type !== 'spectra.audio.visualizer.demand.set'",
		'visualizerSubscribers.add(message.payload.subscriberId)',
		'visualizerSubscribers.delete(message.payload.subscriberId)',
		'captureAdmission: message.payload.admission',
	]) {
		if (!contentMessageHandler.includes(required)) {
			error(`SCTRL-013/SCTRL-021/SCTRL-041: Content lost exact-subscriber Visualizer demand ownership (${required})`);
		}
	}
	const visualizerContracts = fs.readFileSync(
		path.join(root, 'packages/contracts/src/visualizer.contracts.ts'),
		'utf8',
	);
	for (const required of [
		'captureTabId: number | null',
		'export function isVisualizerBatchPayload(',
		'value.captureTabId === null || unique.has(value.captureTabId)',
		'export function isAudioVisualizerDemandPayload(',
		"value.admission.kind === 'capture-start'",
	]) {
		if (!visualizerContracts.includes(required)) {
			error(`SCTRL-002/SCTRL-013/SCTRL-021/SCTRL-041: canonical Visualizer wire guard drifted (${required})`);
		}
	}
}

function checkSpectraV3EnvelopeOwner(root) {
	const bootstrapContract = fs.readFileSync(
		path.join(root, 'packages/contracts/src/spectra.bootstrap.ts'),
		'utf8',
	);
	const protocol = fs.readFileSync(
		path.join(root, 'packages/contracts/src/spectra.protocol.ts'),
		'utf8',
	);
	const runtimeClient = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'shared/spectra-client.ts'),
		'utf8',
	);
	const uiClient = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'shared/ui-spectra-client.ts'),
		'utf8',
	);
	const settingsClient = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'shared/ui-settings-spectra-client.ts'),
		'utf8',
	);
	const runtimeArchitecture = fs.readFileSync(
		path.join(root, APP_PATH, 'docs/architecture/runtime.md'),
		'utf8',
	);
	const strategyArchitecture = fs.readFileSync(
		path.join(root, APP_PATH, 'docs/control/02-strategy-and-routes.md'),
		'utf8',
	);

	const protocolVersionDefinitions = bootstrapContract.match(
		/^export const SPECTRA_PROTOCOL_VERSION\s*=/gmu,
	) ?? [];
	if (protocolVersionDefinitions.length !== 1
		|| !/^export const SPECTRA_CONTENT_RUNTIME_REVISION\s*=\s*'3\./mu.test(bootstrapContract)) {
		error('SCTRL-001/SCTRL-034: SPECTRA v3 must have one canonical protocol/runtime version owner');
	}
	for (const required of [
		'export type SpectraRequestEnvelope',
		'export type SpectraEventEnvelope',
		'export function isSpectraRequestEnvelope(',
		'export function isSpectraEventEnvelope(',
	]) {
		if (!protocol.includes(required)) {
			error(`SCTRL-001/SCTRL-034: SPECTRA v3 envelope contract owner drifted (${required})`);
		}
	}
	for (const required of [
		'function createEnvelope<T extends SpectraRequestType>(',
		'protocolVersion: SPECTRA_PROTOCOL_VERSION',
		'requestId: createRequestId()',
		'const message = createEnvelope(type, payload, context)',
		'function deliverSpectraTabEnvelope<T extends SpectraRequestType>(',
		'createEnvelope(type, payload, { ...context, tabId })',
	]) {
		if (!runtimeClient.includes(required)) {
			error(`SCTRL-001/SCTRL-034: SPECTRA extension request transport lost the canonical envelope owner (${required})`);
		}
	}
	for (const [name, source] of [
		['ui-spectra-client.ts', uiClient],
		['ui-settings-spectra-client.ts', settingsClient],
	]) {
		if (!source.includes('SpectraRequestEnvelope')
			|| !source.includes('SPECTRA_PROTOCOL_VERSION')
			|| !source.includes('requestId')) {
			error(`SCTRL-001/SCTRL-034: focused SPECTRA transport must remain typed by the canonical envelope owner (${name})`);
		}
	}
	for (const [name, document, required] of [
		['architecture/runtime.md', runtimeArchitecture, [
			'## Protocol and envelope ownership',
			'one SPECTRA envelope owner',
			'top-level `action:` message object is the retired V1 runtime protocol',
			'`GLOBAL_SETTINGS_UPDATE`',
		]],
		['control/02-strategy-and-routes.md', strategyArchitecture, [
			'### §4.2 SPECTRA extension envelope owner and V1 retirement',
			'顶层 `action:` envelope 属于已退役的 V1 runtime',
			'`createRouter`',
			'envelope 当前为 v2',
			'Remote 的 v3 是独立',
			'替换 response shape',
		]],
	]) {
		for (const phrase of required) {
			if (!document.includes(phrase)) {
				error(`SCTRL-016/SCTRL-034: SPECTRA extension envelope ownership rule is missing from the owner document (${name}: ${phrase})`);
			}
		}
	}

	const nakedActionEnvelope = /(?:chrome\.)?(?:runtime|tabs)\.sendMessage\([^;]{0,800}?\baction\s*:/u;
	const forbiddenRuntime = /\b(?:createMessenger|sendToTab|messenger\.send|createRouter|router\.(?:on|listen)|NEXUS_ACTIONS|NexusAction|NexusMessages|GLOBAL_SETTINGS_UPDATE)\b/u;
	scanDir(path.join(root, SOURCE_PATH), (fullPath, entry) => {
		if (!/\.(?:ts|tsx|js|mjs)$/u.test(entry.name) || entry.name.endsWith('.d.ts')) return;
		const relative = normalize(root, fullPath);
		const source = executableSource(fs.readFileSync(fullPath, 'utf8'));
		if (nakedActionEnvelope.test(source)) {
			error(`SCTRL-001/SCTRL-034: V1 action envelope sender is forbidden in SPECTRA production (${relative})`);
		}
		if (forbiddenRuntime.test(source)) {
			error(`SCTRL-001/SCTRL-034: retired V1 action/router runtime reached SPECTRA production (${relative})`);
		}
	});
}

const CONTROL_ACKNOWLEDGEMENTS = [
	'coordinator-snapshot',
	'page-controller-getter',
	'dom-event-getter',
	'dom-stable-getter',
	'chrome-event-getter',
	'processor-readback',
	'computed-style',
	'overlay-readback',
	'subscription-state',
	'operation-result',
];

function controlDimensionOwnerIsNotExhaustive() {
	if (Object.keys(CONTROL_ALGORITHM_POLICIES).length !== CONTROL_CAPABILITIES.length
		|| Object.keys(CONTROL_ALGORITHM_ADJUDICATIONS).length !== CONTROL_CAPABILITIES.length
		|| Object.keys(CONTROL_STRATEGY_RULES).length !== CONTROL_STRATEGIES.length) return true;
	for (const strategy of CONTROL_STRATEGIES) {
		if (!isDeepStrictEqual(selectControlStrategyRule(strategy), CONTROL_STRATEGY_RULES[strategy])) {
			return true;
		}
	}
	for (const capability of CONTROL_CAPABILITIES) {
		const policy = selectControlAlgorithmPolicy(capability);
		if (!isDeepStrictEqual(policy, CONTROL_ALGORITHM_POLICIES[capability])
			|| !isDeepStrictEqual(
				selectControlAlgorithmAdjudication(capability),
				CONTROL_ALGORITHM_ADJUDICATIONS[capability],
			)
			|| selectControlCapabilityScope(capability) !== policy.scope) return true;
		for (const strategy of CONTROL_STRATEGIES) {
			if (controlCapabilityUsesStrategy(capability, strategy)
				!== policy.orderedStrategies.includes(strategy)) return true;
		}
		for (const acknowledgement of CONTROL_ACKNOWLEDGEMENTS) {
			if (controlCapabilityUsesAcknowledgement(capability, acknowledgement)
				!== policy.acknowledgements.includes(acknowledgement)) return true;
		}
	}
	return false;
}

function hotkeyActionOwnerIsNotExhaustive() {
	if (Object.keys(HOTKEY_ACTION_DESCRIPTORS).length !== HOTKEY_ACTIONS.length) return true;
	for (const action of HOTKEY_ACTIONS) {
		const descriptor = HOTKEY_ACTION_DESCRIPTORS[action];
		if (!isDeepStrictEqual(selectHotkeyActionDescriptor(action), descriptor)
			|| selectHotkeyCapability(action) !== descriptor.capability
			|| selectHotkeyAvailability(action) !== descriptor.availability
			|| selectHotkeyRepeatPolicy(action) !== descriptor.repeatPolicy
			|| selectHotkeyParameterKind(action) !== descriptor.parameter
			|| selectHotkeyFeedbackOwner(action) !== descriptor.feedbackOwner
			|| hotkeyActionRequiresUserActivation(action) !== descriptor.requiresUserActivation) {
			return true;
		}
	}
	return false;
}

function checkPolicyOwner(root) {
	const contracts = fs.readFileSync(
		path.join(root, 'packages/contracts/src/control.contracts.ts'),
		'utf8',
	);
	const protocol = fs.readFileSync(
		path.join(root, 'packages/contracts/src/spectra.protocol.ts'),
		'utf8',
	);
	if (!contracts.includes('const CONTROL_DIMENSION_INDEX = {')
		|| !contracts.includes('as const satisfies ControlDimensionIndex')
		|| !contracts.includes('/* @__PURE__ */ projectControlRecord(')) {
		error('SCTRL-002: compact control dimension owner or derived audit projection is missing');
	}
	if (!contracts.includes('export const CONTROL_DIRECT_FIELDS')
		|| !contracts.includes("Exclude<ControlField, 'abLoop' | 'visualizer'>")
		|| !contracts.includes('hasOnlyKeys(value, controlDirectFields)')) {
		error('SCTRL-002/SCTRL-005: A/B and Visualizer must stay outside ordinary patch/mutation execution');
	}
	const screenshotPolicy = selectControlAlgorithmPolicy('screenshot');
	if (screenshotPolicy.scope !== 'active-video'
		|| screenshotPolicy.kind !== 'compound'
		|| screenshotPolicy.orderedStrategies.length !== 1
		|| screenshotPolicy.orderedStrategies[0] !== 'chrome-native'
		|| screenshotPolicy.acknowledgements.length !== 1
		|| screenshotPolicy.acknowledgements[0] !== 'operation-result'
		|| contracts.includes("method: 'canvas'")
		|| protocol.includes("method: 'canvas'")) {
		error('SCTRL-002/SCTRL-005: screenshot must have one Chrome-native, completed-save result path');
	}
	if (!/export interface ControlApplyAck\s*\{[^}]*target:\s*MediaTarget\s*\|\s*null;/su.test(contracts)) {
		error('SCTRL-005/SCTRL-006: control ACKs must carry the actually resolved media target');
	}
	if (!/export interface ControlSnapshot\s*\{[^}]*activeMedia:\s*MediaTarget\s*\|\s*null;[^}]*activeVideo:\s*MediaTarget\s*\|\s*null;/su.test(contracts)) {
		error('SCTRL-005/SCTRL-006/SCTRL-025: shared state must distinguish active media from active video');
	}
	if (controlDimensionOwnerIsNotExhaustive()) {
		error('SCTRL-002/SCTRL-015: compact control dimensions and their audit projections must be exhaustive and equivalent');
	}
	if (!contracts.includes('export function isControlStrategyAdmittedForCapability(')
		|| !contracts.includes('isControlStrategyAdmittedForCapability(field, strategy)')
		|| !/isControlStrategyAdmittedForCapability\(\s*value\.operation as ControlOperation,/u.test(contracts)) {
		error('SCTRL-002/SCTRL-005: field and operation ACKs must reject strategies outside the exact capability policy');
	}
	const processorCapabilities = ['boost', 'eqValues', 'bass', 'compressor', 'mono', 'pan', 'delay'];
	if (processorCapabilities.some((capability) => {
		const policy = selectControlAlgorithmPolicy(capability);
		return policy.orderedStrategies.length !== 2
			|| policy.orderedStrategies[0] !== 'media-webaudio'
			|| policy.orderedStrategies[1] !== 'capture';
	})) {
		error('SCTRL-002/SCTRL-041: audio augmentation must prefer proven Media WebAudio before Capture');
	}
	const visualizerPolicy = selectControlAlgorithmPolicy('visualizer');
	const mediaStrategy = selectControlStrategyRule('media-webaudio');
	const visualizerStrategy = selectControlStrategyRule('capture-observe');
	if (visualizerPolicy.orderedStrategies.length !== 2
		|| visualizerPolicy.orderedStrategies[0] !== 'media-webaudio'
		|| visualizerPolicy.orderedStrategies[1] !== 'capture-observe'
		|| visualizerPolicy.recurringWork !== 'while-subscribed'
		|| mediaStrategy.writerOwner !== 'media-processor'
		|| mediaStrategy.interception !== 'irreversible-media-source-binding'
		|| mediaStrategy.admissionEvidence !== 'proven-media-source-eligibility'
		|| mediaStrategy.audioRuntimeCost !== 'lazy-audio-context'
		|| visualizerStrategy.class !== 'observe'
		|| visualizerStrategy.interception !== 'authorized-tab-stream'
		|| visualizerStrategy.admissionEvidence !== 'authorized-capture-readback'
		|| visualizerStrategy.audioRuntimeCost !== 'lazy-offscreen-capture') {
		error('SCTRL-002/SCTRL-013/SCTRL-021: Visualizer must prefer exact-coverage Media WebAudio before Capture observation');
	}
	const hotkeys = fs.readFileSync(path.join(root, 'packages/contracts/src/hotkeys.contracts.ts'), 'utf8');
	if (!hotkeys.includes('const HOTKEY_ACTION_INDEX = {')
		|| !hotkeys.includes('satisfies Record<string, readonly [ControlCapability | null, number]>')
		|| !hotkeys.includes('export type HotkeyAction = keyof typeof HOTKEY_ACTION_INDEX')
		|| !hotkeys.includes('Object.keys(HOTKEY_ACTION_INDEX) as HotkeyAction[]')
		|| !hotkeys.includes('/* @__PURE__ */ projectHotkeyActionDescriptors()')
		|| /export const HOTKEY_ACTIONS[^=]*=\s*\[/u.test(hotkeys)
		|| !hotkeys.includes('export function isSlotHotkeyAction(')
		|| !hotkeys.includes('export function isHotkeyParamsForAction(')
		|| hotkeyActionOwnerIsNotExhaustive()) {
		error('SCTRL-002: hotkey actions must map exhaustively to control capabilities');
	}
	const settingsUiContracts = fs.readFileSync(
		path.join(root, 'packages/contracts/src/settings-ui.contracts.ts'),
		'utf8',
	);
	const settingsRepository = fs.readFileSync(
		path.join(root, APP_PATH, 'src/background/settings-repository.ts'),
		'utf8',
	);
	const settingsNormalization = fs.readFileSync(
		path.join(root, APP_PATH, 'src/background/settings-value-normalization.ts'),
		'utf8',
	);
	const shortcuts = fs.readFileSync(
		path.join(root, APP_PATH, 'src/background/shortcuts.ts'),
		'utf8',
	);
	const hotkeyActions = fs.readFileSync(
		path.join(root, APP_PATH, 'src/content/input/hotkey-actions.ts'),
		'utf8',
	);
	const hotkeyOptionsModal = fs.readFileSync(
		path.join(root, APP_PATH, 'src/options/modal.ts'),
		'utf8',
	);
	if (!settingsUiContracts.includes('isSlotHotkeyAction(action)')
		|| !settingsUiContracts.includes('isHotkeyParamsForAction(action, value.params)')
		|| !settingsRepository.includes('isSlotHotkeyAction(action)')
		|| !settingsNormalization.includes('isHotkeyParamsForAction(binding.action, value.params)')
		|| !shortcuts.includes('filter(([, action]) => isSlotHotkeyAction(action))')
		|| !hotkeyActions.includes('isHotkeyParamsForAction(action, params)')) {
		error('SCTRL-002/SCTRL-016: hotkey slots and parameters must share one contract at storage, runtime and execution boundaries');
	}
	if (!hotkeys.includes('export function isSpectraDefaultHotkeyKeyCombo(')
		|| !hotkeys.includes('return resolveSpectraDefaultHotkeyAction({')
		|| !settingsUiContracts.includes('!isSpectraDefaultHotkeyKeyCombo(value.key)')
		|| !settingsUiContracts.includes("value.disabledReason === 'reserved_default_chord'")
		|| !settingsRepository.includes(
			'if (isSpectraDefaultHotkeyKeyCombo(mutation.binding.key))',
		)
		|| !settingsNormalization.includes("binding.disabledReason = 'reserved_default_chord'")
		|| !settingsRepository.includes('hotkeyNormalization.requiresPersistence')
		|| !hotkeyOptionsModal.includes('if (renderReservedHotkeyWarning()) return;')
		|| !hotkeyOptionsModal.includes('delete currentBinding.disabledReason;')) {
		error('SCTRL-022: built-in chords must be rejected by new site bindings and durably disable recoverable legacy collisions through the one bootstrap resolver');
	}
	const supportedHotkeys = fs.readFileSync(
		path.join(root, APP_PATH, 'src/options/supported-hotkey-actions.ts'),
		'utf8',
	);
	if (!supportedHotkeys.includes('selectHotkeyAvailability(action)')) {
		error('SCTRL-016: Options must derive hotkey availability from canonical descriptors');
	}
	const remoteCommands = fs.readFileSync(
		path.join(root, APP_PATH, 'src/background/remote-commands.ts'),
		'utf8',
	);
	if (!remoteCommands.includes('REMOTE_COMMAND_DESCRIPTORS[command]')) {
		error('SCTRL-014/SCTRL-016: remote commands must consume their exhaustive capability descriptors');
	}
	if (!remoteCommands.includes("fieldState?.phase !== 'applied'")
		|| !remoteCommands.includes('stableRemoteStates.set(snapshot.tabId')) {
		error('SCTRL-005/SCTRL-014: Remote must project only applied actual fields and retain the same-document stable state on failure');
	}
	if (remoteCommands.includes('sendSpectraRequest(')
		|| !remoteCommands.includes('submit: submitControlRequest')
		|| !remoteCommands.includes('submitOperation: submitControlOperation')
		|| !remoteCommands.includes('getSnapshot: getControlViewSnapshot')) {
		error('SCTRL-014/SCTRL-033: Background remote control must call the serialized coordinator directly, not self-RPC through chrome.runtime');
	}
	const remoteService = fs.readFileSync(
		path.join(root, APP_PATH, 'src/background/remote-service.ts'),
		'utf8',
	);
	if ((remoteService.match(/await syncState\(tabId\);/gu) ?? []).length < 2) {
		error('SCTRL-014/SCTRL-033: remote sessions must cache an actual snapshot before authentication can expose state');
	}
	const coordinator = fs.readFileSync(
		path.join(root, APP_PATH, 'src/background/control-coordinator.ts'),
		'utf8',
	);
	const coordinatorValues = fs.readFileSync(
		path.join(root, APP_PATH, 'src/background/control-coordinator-values.ts'),
		'utf8',
	);
	const coordinatorAck = fs.readFileSync(
		path.join(root, APP_PATH, 'src/background/control-coordinator-ack.ts'),
		'utf8',
	);
	if (!coordinator.includes('controlApplyAckMatches(response.data, intent)')
		|| !coordinator.includes('controlOperationAckMatches(ack, intent)')
		|| !coordinatorAck.includes('export function controlApplyAckMatches(')
		|| !coordinatorAck.includes('export function controlOperationAckMatches(')
		|| /\b(?:chrome|browser)\s*\./u.test(coordinatorAck)
		|| /\b(?:storage|persist|publish)\s*\(/u.test(coordinatorAck)) {
		error('SCTRL-006/SCTRL-034: extracted ACK admission must remain pure and the coordinator must remain its only effect consumer');
	}
	const submitKeys = contracts.match(
		/const submitKeys = new Set<keyof ControlSubmitRequest>\(\[(.*?)\]\);/su,
	)?.[1] ?? '';
	const contentRuntimeContracts = fs.readFileSync(
		path.join(root, 'packages/contracts/src/spectra.content-runtime.ts'),
		'utf8',
	);
	const protocolContracts = fs.readFileSync(
		path.join(root, 'packages/contracts/src/spectra.protocol.ts'),
		'utf8',
	);
	const bootstrapContracts = fs.readFileSync(
		path.join(root, 'packages/contracts/src/spectra.bootstrap.ts'),
		'utf8',
	);
	const canonicalRuntimeRevision = bootstrapContracts.match(
		/SPECTRA_CONTENT_RUNTIME_REVISION = '([^']+)'/u,
	)?.[1];
	const protocolReexportsRuntimeRevision =
		/export\s*\{[^}]*\bSPECTRA_CONTENT_RUNTIME_REVISION\b[^}]*\}\s*from\s*['"]\.\/spectra\.bootstrap\.js['"]/u
			.test(protocolContracts);
	const contentReexportsRuntimeRevision =
		/export\s*\{[^}]*\bSPECTRA_CONTENT_RUNTIME_REVISION\b[^}]*\}/u
			.test(contentRuntimeContracts);
	const duplicateRuntimeRevision =
		/export const SPECTRA_CONTENT_RUNTIME_REVISION\s*=\s*'/u;
	if (!contracts.includes('type CaptureAdmission')
		|| !contracts.includes('captureAdmission?: CaptureAdmission')
		|| !contracts.includes('isCaptureAdmission(value.captureAdmission)')
		|| submitKeys.length === 0
		|| submitKeys.includes('captureAdmission')) {
		error('SCTRL-041: Capture admission must use the typed validated internal-intent boundary, never ControlSubmitRequest');
	}
	if (!canonicalRuntimeRevision
		|| duplicateRuntimeRevision.test(contentRuntimeContracts)
		|| duplicateRuntimeRevision.test(protocolContracts)
		|| !protocolReexportsRuntimeRevision
		|| !hasNamedImports(
			contentRuntimeContracts,
			'./spectra.bootstrap.js',
			['SPECTRA_CONTENT_RUNTIME_REVISION'],
		)
		|| !contentReexportsRuntimeRevision
		|| !contentRuntimeContracts.includes("'patch', 'captureAdmission'")
		|| !contentRuntimeContracts.includes('isCaptureAdmission(value.captureAdmission)')) {
		error('SCTRL-006/SCTRL-041: Bootstrap must solely own the runtime revision while both protocol facades preserve the canonical Capture boundary');
	}
	for (const required of [
		'captureAdmissionForInvocation',
		"chrome.tabs.query({ active: true, currentWindow: true })",
		"Reflect.deleteProperty(unadmittedRequest, 'captureAdmission')",
		'submitExtensionInvokedControlRequest',
		'submitExtensionInvokedControlOperation',
		'isExtensionPopupSender(sender)',
		'trustedContentHotkeyInvocation(sender, tabId)',
		"typeof sender.documentId === 'string'",
		'const document = { tabId, documentId: sender.documentId }',
		'assertInvocationTargetCurrent',
		"message.payload.source === 'popup'",
		"message.payload.source === 'hotkey'",
	]) {
		if (!coordinator.includes(required)) {
			error(`SCTRL-041: Background Capture admission boundary is missing (${required})`);
		}
	}
	if ((coordinator.match(/Reflect\.deleteProperty\(unadmittedRequest, 'captureAdmission'\)/gu) ?? []).length !== 2
		|| !shortcuts.includes('submitExtensionInvokedControlRequest')
		|| !shortcuts.includes('submitExtensionInvokedControlOperation')
		|| shortcuts.includes('submitControlRequest')
		|| shortcuts.includes('extensionInvoked')) {
		error('SCTRL-041: Popup and validated current-document shortcut transactions must use one invocation-bound Capture admission path');
	}
	const captureModeExecutor = fs.readFileSync(
		path.join(root, APP_PATH, 'src/content/logic/mode-executor.ts'),
		'utf8',
	);
	const captureManager = fs.readFileSync(
		path.join(root, APP_PATH, 'src/content/audio/capture-manager.ts'),
		'utf8',
	);
	if (!captureModeExecutor.includes("captureAdmission?.kind === 'capture-start'")
		|| !captureModeExecutor.includes('CAPTURE_ADMISSION_REQUIRED')
		|| captureModeExecutor.includes('requiresAudioProcessor(config) && hasUserGesture(state)')
		|| captureManager.includes('Capture transition blocked by missing activeTab permission')
		|| !captureManager.includes("log.error('Capture transition failed:'")) {
		error('SCTRL-041: unvalidated page state must not admit a new Capture or hide an unexpected browser denial');
	}
	const hydrationInitialState = fs.readFileSync(
		path.join(root, APP_PATH, 'src/content/core/initial-state.ts'),
		'utf8',
	);
	const hydrationContentCore = fs.readFileSync(
		path.join(root, APP_PATH, 'src/content/core/index.ts'),
		'utf8',
	);
	if (!hydrationInitialState.includes("export type InitialStateSource = 'handoff' | 'session' | 'fresh'")
		|| !hydrationInitialState.includes("source === 'session'")
		|| !hydrationInitialState.includes("state.actualMode !== 'capture' || state.desiredMode !== 'capture'")
		|| !hydrationContentCore.includes('if (shouldApplyInitialPolicy(state, source))')) {
		error('SCTRL-012/SCTRL-041: same-document handoff must hydrate without replaying policy before READY');
	}
	if (!coordinator.includes('applyPageObservation(intent, resolvedRequest.observedStrategies)')
		|| !coordinator.includes("source: pageObservation ? 'system' : intent.source")
		|| !coordinator.includes('patch: routedPatch')) {
		error('SCTRL-017: page observations must commit without routing a second content write');
	}
	for (const missing of missingSourceEvidence(
		{ coordinator, coordinatorValues },
		[
			{ owner: 'coordinatorValues', fragment: "intent.requestedCoverage !== 'active-target'" },
			{ owner: 'coordinator', fragment: 'applyChromeTabObservation(' },
			{ owner: 'coordinator', fragment: 'changeInfo.mutedInfo?.muted' },
		],
	)) {
		error(`SCTRL-017: required coordinator invariant is missing (${missing.fragment})`);
	}
	const document = path.join(root, APP_PATH, 'docs/control-architecture.md');
	if (!fs.existsSync(document)) error('SCTRL-016: control-architecture.md owner is missing');
	else {
		// 自 v2.6+ 起,控制架构按 progressive disclosure 拆分到 control/ 子目录
		// 新结构采用编号章节 (§X.Y),验证脚本需识别重命名后的标题
		const controlDir = path.join(root, APP_PATH, 'docs/control');
		const subFiles = fs.existsSync(controlDir)
			? fs.readdirSync(controlDir).filter(f => f.endsWith('.md')).map(f => path.join(controlDir, f))
			: [];
		const architecture = [fs.readFileSync(document, 'utf8'), ...subFiles.map(f => fs.readFileSync(f, 'utf8'))].join('\n\n');
		for (const requiredSection of [
			'### §7.3 Failure-directed escalation',
			'### §8.5 Per-capability native and augmentation ledger',
			'### §8.6 Native versus interception adjudication for every algorithm',
			'#### §8.6.1 Algorithm entry points and implementation anchors',
			'### §9.4 Retired/forbidden source inventory and current anchors',
			'### §12.1 Media WebAudio / Capture admission and ACK',
			'### §17.1 Implementation status ledger',
		]) {
			if (!architecture.includes(requiredSection)) {
				error(`SCTRL-016: control owner is missing ${requiredSection}`);
			}
		}
		if (!architecture.includes('28 persistent snapshot fields plus 23 momentary')) {
			error('SCTRL-016: the control owner must record the exact 28-field/23-operation inventory');
		}
		if (architecture.includes('equal-power/linear')) {
			error('SCTRL-016: audio topology must name the implemented crossfade curve exactly');
		}
		if (!architecture.includes('| Ordered strategies | MAIN policy | ACK evidence | Recurring work |')) {
			error('SCTRL-016: executable algorithm mirror must include strategy, MAIN, ACK and lifetime columns');
		}
		if (!architecture.includes('three-owner')
			|| !architecture.includes('MediaElement WebAudio')
			|| !architecture.includes('graphSignature')
			|| !architecture.includes('controlRevision')
			|| !architecture.includes("contextState: 'running'")) {
			error('SCTRL-013/SCTRL-016/SCTRL-028: three-owner processor identity and running-state ACK must be explicit and bounded');
		}
		for (const invariant of [
			'SCTRL-025',
			'SCTRL-026',
			'SCTRL-027',
			'SCTRL-028',
			'SCTRL-029',
			'SCTRL-030',
			'SCTRL-031',
			'SCTRL-032',
			'SCTRL-033',
			'SCTRL-034',
			'SCTRL-035',
			'SCTRL-036',
			'SCTRL-037',
			'SCTRL-038',
			'SCTRL-039',
			'SCTRL-040',
			'SCTRL-041',
			'SCTRL-042',
			'SCTRL-043',
			'SCTRL-044',
		]) {
			if (!architecture.includes(`- \`${invariant}\``)) {
				error(`SCTRL-016: control owner is missing ${invariant}`);
			}
		}
		for (const staleCaptureClaim of [
			'Capture output gain for full opaque output',
			'Capture output mute for opaque full output',
			'origin-clean canvas `toBlob`',
			'`dom-native -> chrome-native`',
			'processor may mirror mute',
			'processor already active, its master gain also goes to zero',
		]) {
			if (architecture.includes(staleCaptureClaim)) {
				error(`SCTRL-002/SCTRL-016: native volume or mute cannot fall back to Capture (${staleCaptureClaim})`);
			}
		}
		for (const capability of CONTROL_CAPABILITIES) {
			if (!architecture.includes(`| \`${capability}\` |`)) {
				error(`SCTRL-016: per-capability adjudication row is missing for ${capability}`);
			}
		}

		if (CONTROL_CAPABILITIES.length !== 51) {
			error(`SCTRL-002: canonical capability count must be 51, found ${CONTROL_CAPABILITIES.length}`);
		}
		const adjudicationTotals = new Map();
		for (const capability of CONTROL_CAPABILITIES) {
			const { nativePreference, augmentationAdmission } =
				selectControlAlgorithmAdjudication(capability);
			const exactRow = `| \`${capability}\` | \`${nativePreference}\` | \`${augmentationAdmission}\` |`;
			if (!architecture.includes(exactRow)) {
				error(`SCTRL-016: executable adjudication mirror drifted for ${capability}`);
			}
			adjudicationTotals.set(
				nativePreference,
				(adjudicationTotals.get(nativePreference) ?? 0) + 1,
			);
		}
		for (const [preference, expected] of Object.entries({
			'native-only': 17,
			'hybrid-extension-native': 6,
			'augmentation-only': 26,
			'observation-only': 2,
		})) {
			if ((adjudicationTotals.get(preference) ?? 0) !== expected) {
				error(`SCTRL-002: ${preference} count drifted (${adjudicationTotals.get(preference) ?? 0}/${expected})`);
			}
		}
		if (/^\|\s*(?:partial|pending)\s*\|/mu.test(architecture)) {
			error('SCTRL-016: implementation ledger contains release-blocking partial/pending work');
		}
		checkSourceAlgorithmCatalog(root, contracts, architecture);
		const runtimeProtocols = fs.readFileSync(
			path.join(root, APP_PATH, 'docs/reference/protocols.md'),
			'utf8',
		);
		const sourceEligibility = fs.readFileSync(
			path.join(root, APP_PATH, 'docs/architecture/media-source-admission.md'),
			'utf8',
		);
		if (!runtimeProtocols.includes('`ControlSnapshot` is the sole actual source')
			|| !runtimeProtocols.includes('`page-native -> dom-native`')
			|| !runtimeProtocols.includes('no domain list, retained player object, observer, timer, or polling loop')
			|| !runtimeProtocols.includes('`boostGain: 1–8`')
			|| runtimeProtocols.includes('MAIN WebAudio')) {
			error('SCTRL-014/SCTRL-016/SCTRL-032: runtime protocol narrative drifted from control ownership');
		}
		if (!sourceEligibility.includes('bypass -> webaudio -> capture')
			|| !sourceEligibility.includes('graphSignature')
			|| !sourceEligibility.includes('normalizedActualConfig')
			|| !sourceEligibility.includes('MediaElementAudioSourceNode')
			|| !sourceEligibility.includes('every current media source is proven safe')
			|| !sourceEligibility.includes('Forbidden designs')) {
			error('SCTRL-008/SCTRL-016: audio source admission must require complete MediaElement evidence and typed WebAudio/Capture readback');
		}
	}
}

function checkProductionLoadingTopology(root) {
	const bootstrapContract = fs.readFileSync(
		path.join(root, 'packages/contracts/src/spectra.bootstrap.ts'),
		'utf8',
	);
	const bootstrap = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/core/bootstrap.ts'),
		'utf8',
	);
	const build = fs.readFileSync(path.join(root, APP_PATH, 'build.ts'), 'utf8');
	const minificationPolicy = fs.readFileSync(
		path.join(root, APP_PATH, 'scripts/minification-policy.ts'),
		'utf8',
	);
	const retiredPropertyAllowlist = path.join(
		root,
		APP_PATH,
		'scripts/external-boundary-properties.ts',
	);
	const remoteHost = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'offscreen-remote/remote-host.ts'),
		'utf8',
	);
	const offscreenEntry = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'offscreen/index.ts'),
		'utf8',
	);
	const offscreenRemoteRuntime = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'offscreen-remote/runtime.ts'),
		'utf8',
	);
	const peerRuntimeLoader = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'offscreen-remote/peerjs-loader.ts'),
		'utf8',
	);
	const peerVendor = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'offscreen-remote/peerjs-vendor.ts'),
		'utf8',
	);
	const manifest = JSON.parse(fs.readFileSync(
		path.join(root, APP_PATH, 'public/manifest.json'),
		'utf8',
	));
	const nativeExecutor = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/logic/native-media-executor.ts'),
		'utf8',
	);
	const uiRuntime = fs.readFileSync(
		path.join(root, 'packages/contracts/src/spectra.ui-runtime.ts'),
		'utf8',
	);
	const uiClient = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'shared/ui-spectra-client.ts'),
		'utf8',
	);
	const settingsUiRuntime = fs.readFileSync(
		path.join(root, 'packages/contracts/src/spectra.ui-settings-runtime.ts'),
		'utf8',
	);
	const settingsUiClient = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'shared/ui-settings-spectra-client.ts'),
		'utf8',
	);
	const settingsClient = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'shared/settings-client.ts'),
		'utf8',
	);
	const optionsSettingsClient = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'shared/options-settings-client.ts'),
		'utf8',
	);
	const hotkeyTargetClient = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'shared/hotkey-target-client.ts'),
		'utf8',
	);
	const hotkeyTargetRepository = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'background/hotkey-target-repository.ts'),
		'utf8',
	);
	const uiRuntimeTest = fs.readFileSync(
		path.join(root, APP_PATH, 'test/ui-runtime-contract.spec.ts'),
		'utf8',
	);
	const artifactIntegrity = fs.readFileSync(
		path.join(root, APP_PATH, 'scripts/check-production-artifacts.ts'),
		'utf8',
	);
	const popup = fs.readFileSync(path.join(root, APP_PATH, 'public/popup.html'), 'utf8');
	for (const packagePath of [
		'packages/contracts/package.json',
		'packages/features/audio-engine/package.json',
		'packages/nexus-kernel/package.json',
	]) {
		const packageJson = JSON.parse(fs.readFileSync(path.join(root, packagePath), 'utf8'));
		if (packageJson.sideEffects !== false) {
			error(`SCTRL-013/SCTRL-034: pure runtime package must remain tree-shakeable (${packagePath})`);
		}
	}
	for (const required of [
		"export const SPECTRA_PROTOCOL_VERSION = 2 as const",
		'export function isBootstrapInboundRequest(',
		'export function isBootstrapHelloResponse(',
	]) {
		if (!bootstrapContract.includes(required)) {
			error(`SCTRL-001/SCTRL-034: minimal bootstrap contract drifted (${required})`);
		}
	}
	if (!bootstrap.includes("from '@nexus/contracts/bootstrap'")
		|| bootstrap.includes("from '../../shared/spectra-client'")
		|| bootstrap.includes('isSpectraRequestEnvelope')) {
		error('SCTRL-001/SCTRL-034: always-on bootstrap must not import the complete protocol/client graph');
	}
	for (const required of [
		"const isolatedEntries = entries.filter(({ out }) => out.startsWith('content-'))",
		"sharingDomain: 'background-service-worker'",
		'const backgroundEntries = entries.filter(',
		'const moduleEntryGroups = [',
		"name: 'extension'",
		"sharingDomain: 'extension-pages'",
		`chunkNames: \`chunks/\${group.name}/[name]-[hash]\``,
		'plugins: [contractRuntimeFacadePlugin()]',
		"import { productionMangleOptions } from './scripts/minification-policy.ts'",
		'if (!opaqueVendor) continue',
		'mangle: productionMangleOptions(true)',
		"out: 'peerjs-vendor.js'",
		"format: 'esm'",
		"path.endsWith('peerjs-vendor.js')",
		'for (const entry of backgroundEntries) await buildOne(entry)',
		'splitting: true',
	]) {
		if (!build.includes(required)) {
			error(`SCTRL-001/SCTRL-034: production loading topology drifted (${required})`);
		}
	}
	if (!hasNamedImports(build, './scripts/check-production-artifacts.ts', [
		'analyzeProductionArtifacts',
		'assertProductionArtifactReport',
	]) || !hasNamedImports(build, './scripts/minification-policy.ts', [
		'productionMangleOptions',
	]) || !hasNamedImports(build, './scripts/i18n-assets.ts', [
		'writeI18nAssets',
	])) {
		error('SCTRL-001/SCTRL-034: production minification policy imports drifted');
	}
	if (!popup.includes('<script type="module" src="popup.js"></script>')) {
		error('SCTRL-034: Popup must remain an extension-origin module before sharing private chunks');
	}
	const offscreen = fs.readFileSync(path.join(root, APP_PATH, 'public/offscreen.html'), 'utf8');
	if (!minificationPolicy.includes("if (!opaqueVendor) throw new Error('Application bundles must not enter the secondary Terser pass')")
		|| !minificationPolicy.includes('regex: /^_/u')
		|| build.includes('collectReservedProperties')
		|| fs.existsSync(retiredPropertyAllowlist)
		|| offscreen.includes('<script src="peerjs-vendor.js"></script>')
		|| !offscreen.includes('<script type="module" src="offscreen.js"></script>')
		|| !offscreenEntry.includes("import('../offscreen-remote/runtime')")
		|| !offscreenEntry.includes("message.type !== 'REMOTE_HOST_CREATE_SESSION'")
		|| !offscreenRemoteRuntime.includes('ensurePeerRuntime: peerRuntime.ensure')
		|| !peerRuntimeLoader.includes("return import(chrome.runtime.getURL('peerjs-vendor.js'))")
		|| peerRuntimeLoader.includes('PEER_VENDOR_FILE')
		|| !peerRuntimeLoader.includes("typeof module.default !== 'function'")
		|| !peerRuntimeLoader.includes("throw new Error('Local PeerJS vendor runtime is unavailable')")
		|| !peerRuntimeLoader.includes("from '../../../../../remote-site/vendor/peerjs.min.js'")
		|| !peerVendor.includes('export default Peer')
		|| !peerVendor.includes("import Peer from '../../../../../remote-site/vendor/peerjs.min.js'")
		|| peerVendor.includes('globalThis.Peer')
		|| !remoteHost.includes("import type { DataConnection, Peer } from './peerjs-loader'")
		|| /(?:^|\n)import\s+[^;\n]*\bfrom\s+['"]peerjs['"]/u.test(
			`${peerVendor}\n${peerRuntimeLoader}\n${remoteHost}`,
		)
		|| !remoteHost.includes('createPeer: (peerId: string) => Peer')
		|| !remoteHost.includes('peer = createPeer(session.pairing.peerId)')
		|| !build.includes("sharingDomain: 'offscreen-vendor'")) {
		error('SCTRL-004/SCTRL-014/SCTRL-034/SCTRL-044: application property stability or Remote-only lazy data-channel vendor boundary drifted');
	}
	const videoEffectsResource = (manifest.web_accessible_resources ?? [])
		.find((item) => item.resources?.includes('content-video-effects.js'));
	if (!build.includes("entry: 'src/content/video/video-effects-controller.ts'")
		|| !build.includes("out: 'content-video-effects.js'")
		|| !build.includes("sharingDomain: 'isolated-video-module'")
		|| !nativeExecutor.includes("import(chrome.runtime.getURL('content-video-effects.js'))")
		|| nativeExecutor.includes("import { VideoEffectsController } from '../video/video-effects-controller'")
		|| videoEffectsResource?.use_dynamic_url !== true) {
		error('SCTRL-001/SCTRL-013/SCTRL-042: video enhancement code must remain lazy, extension-owned and absent from native-only startup');
	}
	if (!build.includes("'@nexus/contracts/ui-runtime': resolve(")
		|| !build.includes("'@nexus/contracts/ui-settings-runtime': resolve(")
		|| !uiClient.includes("from '@nexus/contracts/ui-runtime'")
		|| !uiRuntime.includes('export const SPECTRA_UI_REQUEST_TYPES = [')
		|| !uiRuntime.includes('export type SpectraUiRequestType = (typeof SPECTRA_UI_REQUEST_TYPES)[number]')
		|| !uiRuntime.includes('export function isSpectraUiRequestType(')
		|| !uiRuntime.includes('export const SPECTRA_UI_EVENT_TYPES = [')
		|| !uiRuntime.includes('export type SpectraUiEventType = (typeof SPECTRA_UI_EVENT_TYPES)[number]')
		|| !uiRuntime.includes('export function isSpectraUiEventType(')
		|| !uiRuntime.includes('if (isSpectraSettingsUiRequestType(type)) return isSpectraSettingsUiResponse(type, value);')
		|| (uiClient.match(/T extends SpectraUiRequestType/gu) ?? []).length !== 2
		|| !uiRuntimeTest.includes("const internalType: SpectraRequestType = 'spectra.audio.capture.set'")
		|| !uiRuntimeTest.includes('expect(isSpectraUiResponse(internalType, failure)).toBe(false)')
		|| !uiRuntimeTest.includes('matches canonical validation for every allowed event')
		|| (uiRuntime.match(/default: return false;/gu) ?? []).length !== 1) {
		error('SCTRL-014/SCTRL-034/SCTRL-043: extension UI must use the restricted protocol validator surface');
	}
	if (!settingsUiRuntime.includes('export const SPECTRA_SETTINGS_UI_REQUEST_TYPES = [')
		|| !settingsUiRuntime.includes('export function isSpectraSettingsUiResponse')
		|| !settingsUiRuntime.includes('export function isSpectraSettingsUiEventEnvelope')
		|| settingsUiRuntime.includes('spectra.control.snapshot.get')
		|| settingsUiRuntime.includes('spectra.audio.session.get')
		|| !settingsUiClient.includes("from '@nexus/contracts/ui-settings-runtime'")
		|| settingsUiClient.includes("from '@nexus/contracts/ui-runtime'")
		|| !optionsSettingsClient.includes("from '@nexus/contracts/ui-settings-runtime'")
		|| !optionsSettingsClient.includes("from './revisioned-settings-client'")
		|| optionsSettingsClient.includes("from '@nexus/contracts/ui-runtime'")
		|| optionsSettingsClient.includes("from './ui-settings-spectra-client'")
		|| !settingsClient.includes("from '@nexus/contracts/full-settings-runtime'")
		|| !settingsClient.includes("from './revisioned-settings-client'")
		|| settingsClient.includes("from './ui-settings-spectra-client'")
		|| settingsClient.includes("from './ui-spectra-client'")
		|| !hotkeyTargetClient.includes("from './ui-settings-spectra-client'")
		|| !hotkeyTargetClient.includes('getHotkeyTarget(')
		|| !hotkeyTargetClient.includes('setHotkeyTarget(')
		|| !hotkeyTargetRepository.includes('createSerializedQueue')
		|| !hotkeyTargetRepository.includes('chrome.storage.session')
		|| !hotkeyTargetRepository.includes('clearIfMatches(')
		|| !uiRuntimeTest.includes('keeps the Options facade narrow and canonically equivalent')
		|| !build.includes("'@nexus/contracts/full-settings-runtime': resolve(")) {
		error('SCTRL-014/SCTRL-034/SCTRL-043: Options and the independent hotkey-target owner must use only the settings facade and serialized session state');
	}
	for (const required of [
		'export function bundleFootprint(',
		'export function analyzeProductionArtifacts(',
		'export function checkProductionArtifacts(',
		'unreachable production artifact',
		'byte-identical production artifacts',
		'repeated in shareable build domain',
		'source map reference is forbidden',
		'diagnostic console call is forbidden',
		'MV3 service worker must be one self-contained bundle',
	]) {
		if (!artifactIntegrity.includes(required)) {
			error(`SCTRL-013/SCTRL-034: production artifact integrity drifted (${required})`);
		}
	}
}

function writerMatches(content) {
	return {
		volume: /\b(?:element|media|video|audio|v)\.volume\s*=(?!=)/u.test(content),
		muted: /\b(?:element|media|video|audio|v)\.muted\s*=(?!=)/u.test(content),
		playbackRate: /\.playbackRate\s*=(?!=)/u.test(content),
		currentTime: /\b(?:element|media|video|audio|v)\.currentTime\s*=(?!=)/u.test(content),
		preservesPitch: /\.preservesPitch\s*=(?!=)/u.test(content),
		loop: /\b(?:element|media|video|audio|v)\.loop\s*=(?!=)/u.test(content),
		inlineVideoStyle: /\.style\.(?:transform|filter|objectFit|position|zIndex)\s*=(?!=)/u.test(content),
		focusRecovery: /(?:from\s+['"]\.\.\/utils\/focus-helper['"]|simulateMouseHover\s*\()/u.test(content),
	};
}

function checkWriterBoundaries(root) {
	const source = path.join(root, SOURCE_PATH);
	const debt = new Map();
	for (const key of Object.keys(LEGACY_WRITERS)) debt.set(key, new Set());

	scanDir(source, (fullPath, entry) => {
		if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) return;
		const relative = normalize(root, fullPath);
		const matches = writerMatches(fs.readFileSync(fullPath, 'utf8'));
		for (const [kind, matched] of Object.entries(matches)) {
			if (!matched) continue;
			if (CANONICAL_WRITERS[kind].has(relative)) continue;
			if (LEGACY_WRITERS[kind].has(relative)) {
				debt.get(kind).add(relative);
				continue;
			}
			error(`SCTRL-003: unowned ${kind} writer at ${relative}`);
		}
	});

	for (const [kind, files] of debt) {
		if (files.size === 0) continue;
		error(`SCTRL-003: legacy ${kind} writer remains reachable at ${[...files].sort().join(', ')}`);
	}
}

function checkForbiddenMainPatches(root) {
	const source = path.join(root, SOURCE_PATH);
	const allowedMainFile = `${SOURCE_PATH}/background/main-runtime-manager.ts`;
	const pattern = /(?:window\.AudioContext\s*=|webkitWindow\.webkitAudioContext\s*=|Object\.defineProperty\(ctx,\s*['"]destination['"]|ctx\.close\s*=|document\.createElement\s*=|document\.createElementNS\s*=|window\.Audio\s*=|history\.(?:pushState|replaceState)\s*=|HTMLMediaElement\.prototype)/u;
	scanDir(source, (fullPath, entry) => {
		if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) return;
		const relative = normalize(root, fullPath);
		const content = fs.readFileSync(fullPath, 'utf8');
		if (pattern.test(content)) {
			error(`SCTRL-004: generic MAIN patch is forbidden at ${relative}`);
		}
		if (/world\s*:\s*['"]MAIN['"]/u.test(content) && relative !== allowedMainFile) {
			error(`SCTRL-004: MAIN execution is owned only by main-runtime-manager.ts (${relative})`);
		}
		if (/window\.postMessage\s*\([\s\S]*?,\s*['"]\*['"]\s*\)/u.test(content)) {
			error(`SCTRL-004/SCTRL-006: unauthenticated cross-world postMessage is forbidden at ${relative}`);
		}
	});
}

function checkRetiredPaths(root) {
	for (const relative of [
		`${SOURCE_PATH}/content/audio/dom-volume.ts`,
		`${SOURCE_PATH}/content/audio/volume-observer.ts`,
		`${SOURCE_PATH}/content/logic/media-control.ts`,
		`${SOURCE_PATH}/content/logic/media-message-handler.ts`,
		`${SOURCE_PATH}/content/logic/site-bridge`,
		`${SOURCE_PATH}/content/utils/media-utils.ts`,
		`${SOURCE_PATH}/content/video/video-filter.ts`,
		`${SOURCE_PATH}/injector`,
	]) {
		if (fs.existsSync(path.join(root, relative))) {
			error(`SCTRL-003/SCTRL-004: retired control path returned at ${relative}`);
		}
	}

	const captureManager = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/audio/capture-manager.ts'),
		'utf8',
	);
	for (const retiredMessage of [
		'SPECTRA_CAPTURE_STATE',
		'SPECTRA_WEBAUDIO_STATE',
		'SPECTRA_VOLUME_UPDATE',
		'SPECTRA_TARGET_SPEED',
	]) {
		if (captureManager.includes(retiredMessage)) {
			error(`SCTRL-004/SCTRL-006: retired cross-world state message remains (${retiredMessage})`);
		}
	}

	const router = fs.readFileSync(
		path.join(root, 'packages/features/audio-engine/src/AudioGraphRouter.ts'),
		'utf8',
	);
	const processorContracts = fs.readFileSync(
		path.join(root, 'packages/contracts/src/audio-processor.contracts.ts'),
		'utf8',
	);
	const audioContracts = fs.readFileSync(
		path.join(root, 'packages/contracts/src/audio.contracts.ts'),
		'utf8',
	);
	const contractsIndex = fs.readFileSync(
		path.join(root, 'packages/contracts/src/index.ts'),
		'utf8',
	);
	const processorContract = processorContracts.match(
		/export interface AudioProcessorConfig \{(.*?)\n\}/su,
	)?.[1] ?? '';
	if (!processorContract.includes('boostGain: number')
		|| processorContract.includes('muted:')
		|| /^\s*volume(?:Base)?\??:/mu.test(processorContract)
		|| !processorContracts.includes("isFiniteControlValue(value.boostGain, 'boost')")
		|| !contractsIndex.includes("export { isAudioProcessorConfig } from './audio-processor.contracts.js';")
		|| !audioContracts.includes('export function audioConfigToProcessorConfig(')
		|| !audioContracts.includes('boostGain: config.boost')
		|| !router.includes("boostGain: clampControlValue(config.boostGain, 'boost', 1)")
		|| router.includes('normalized.muted')
		|| router.includes('config.muted')) {
		error('SCTRL-003/SCTRL-032: processor contracts cannot become page-volume or media-mute writers');
	}

	const nativeExecutor = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/logic/native-media-executor.ts'),
		'utf8',
	);
	const nativeMediaAsync = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/logic/native-media-async.ts'),
		'utf8',
	);
	if (!nativeMediaAsync.includes('export function nativeValuesMatch(')
		|| nativeExecutor.includes('function valuesMatch(')
		|| nativeExecutor.includes('private matches(')) {
		error('SCTRL-003/SCTRL-034: native comparison semantics must have one owner in native-media-async');
	}
	if (!nativeExecutor.includes('target: resolved?.target ?? null')) {
		error('SCTRL-005/SCTRL-006: field ACK must report the actually resolved media target');
	}
	if (!nativeExecutor.includes("if (event === 'removed')")
		|| !nativeExecutor.includes('this.pending.delete(target.mediaId)')
		|| !nativeExecutor.includes('this.effects?.release(element)')) {
		error('SCTRL-007/SCTRL-013: removed media must release pending writes and extension-owned presentation state');
	}
	const nativeReadStart = nativeExecutor.indexOf('\n\tread(request: ControlReadRequest)');
	const nativeReadEnd = nativeExecutor.indexOf('\n\tprivate async applyField(', nativeReadStart);
	const nativeRead = nativeReadStart >= 0 && nativeReadEnd > nativeReadStart
		? nativeExecutor.slice(nativeReadStart, nativeReadEnd)
		: '';
	for (const forbidden of [
		'this.primeObserved(',
		'.addEventListener(',
		'querySelector',
		'this.registry.select(',
		'this.observed.set(',
	]) {
		if (!nativeRead || nativeRead.includes(forbidden)) {
			error(`SCTRL-012/SCTRL-030: runtime actual read must remain a pure registry projection (${forbidden})`);
		}
	}
	const mediaRegistry = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/core/media-registry.ts'),
		'utf8',
	);
	const mediaRegistryTest = fs.readFileSync(
		path.join(root, APP_PATH, 'test/media-registry.spec.ts'),
		'utf8',
	);
	if (!mediaRegistry.includes("this.emit(record.target, 'removed', element, 'source-change')")
		|| !mediaRegistry.includes("this.emit(record.target, 'registered', element)")
		|| !mediaRegistry.includes('this.fullscreenMediaId')
		|| !mediaRegistry.includes("this.emit(record.target, 'selected', record.element)")
		|| !mediaRegistry.includes('visibleArea: initialVisibleArea(element)')
		|| !mediaRegistryTest.includes('seeds initial selection from visible geometry before IntersectionObserver delivery')) {
		error('SCTRL-006/SCTRL-007: source revisions and fullscreen events must retain exact media ownership');
	}
	const mediaDetection = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/audio/media-detection.ts'),
		'utf8',
	);
	const pauseTracker = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/utils/pause-tracker.ts'),
		'utf8',
	);
	for (const [name, content] of [
		['media-detection.ts', mediaDetection],
		['pause-tracker.ts', pauseTracker],
	]) {
		for (const forbidden of [
			'addEventListener(',
			'querySelector(',
			'querySelectorAll(',
			'getElementsByTagName(',
			'setupPauseTracking',
		]) {
			if (content.includes(forbidden)) {
				error(`SCTRL-012/SCTRL-030: ${name} status projection regained a side effect or DOM fallback (${forbidden})`);
			}
		}
	}
	const contentCoreIndex = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/core/index.ts'),
		'utf8',
	);
	if (fs.existsSync(path.join(root, SOURCE_PATH, 'content/core/lifecycle/fullscreen-handler.ts'))
		|| contentCoreIndex.includes('setupFullscreenHandler')
		|| !mediaRegistry.includes("this.emit(record.target, 'fullscreenchange', record.element)")
		|| !nativeExecutor.includes("} else if (event === 'fullscreenchange')")) {
		error('SCTRL-012/SCTRL-013/SCTRL-025: fullscreen must use the registry native event path without a second applyState lifecycle');
	}
	const abLoop = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/video/ab-loop.ts'),
		'utf8',
	);
	const markers = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/video/time-marker.ts'),
		'utf8',
	);
	if (!/registry\.track\(mediaRegistry\.subscribe\(\(target,\s*event(?:,\s*[^)]*)?\)\s*=>\s*\{/u.test(contentCoreIndex)
		|| !contentCoreIndex.includes('disposeABLoopSource(target)')
		|| !contentCoreIndex.includes('disposeMarkerSource(target)')
		|| !contentCoreIndex.includes("if (event !== 'removed') return;")
		|| !abLoop.includes("if (event !== 'removed') return;")
		|| !markers.includes("if (event === 'removed') disposeMarkerSource(target);")
		|| !markers.includes('markerSets.delete(sourceKey(target))')) {
		error('SCTRL-010/SCTRL-013: A/B schedulers and marker state must release immediately at the source-revision removal boundary');
	}
	const operationExecutor = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/logic/control-operation-executor.ts'),
		'utf8',
	);
	const contentPolicy = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/logic/content-control-policy.ts'),
		'utf8',
	);
	const controlContractsTest = fs.readFileSync(
		path.join(root, APP_PATH, 'test/control-contracts.spec.ts'),
		'utf8',
	);
	if (!operationExecutor.includes('isContentActiveVideoOperation(originalIntent.operation)')
		|| !operationExecutor.includes('registry?.resolveVideo(originalIntent.target)')
		|| !operationExecutor.includes('registry?.resolve(originalIntent.target)')
		|| !operationExecutor.includes('const operationTarget = resolved ??')
		|| !operationExecutor.includes('const currentTarget = (): MediaTarget | null =>')) {
		error('SCTRL-005/SCTRL-006/SCTRL-025: momentary operations must resolve their contract-scoped actual target');
	}
	for (const required of [
		'CONTENT_DOM_NATIVE_FIELDS',
		'CONTENT_EXTENSION_CSS_FIELDS',
		'CONTENT_EXTENSION_OVERLAY_FIELDS',
		'CONTENT_ACTIVE_VIDEO_OPERATIONS',
		"if (requestedCoverage !== 'active-target') return null",
	]) {
		if (!contentPolicy.includes(required)) {
			error(`SCTRL-002/SCTRL-004: narrow Content strategy projection is incomplete (${required})`);
		}
	}
	if (operationExecutor.includes('CONTROL_ALGORITHM_POLICIES')
		|| !controlContractsTest.includes('release-gates the narrow Content strategy projection against the canonical policy')) {
		error('SCTRL-002/SCTRL-004/SCTRL-016: Content projection must stay small and release-gated against the canonical policy');
	}
	for (const required of [
		"throw new Error('The marker does not exist on the selected media source')",
		"throw new Error('No adjacent marker exists on the selected media source')",
		"throw new Error('No complete A/B loop exists on the selected media source')",
	]) {
		if (!operationExecutor.includes(required)) {
			error(`SCTRL-005: momentary operation failure must not return an ok/false result (${required})`);
		}
	}
	if (!operationExecutor.includes("return ack(intent, 'observe', { shown: true }, {}, null)")
		|| !fs.readFileSync(
			path.join(root, APP_PATH, 'test/control-operation-executor.spec.ts'),
			'utf8',
		).includes('keeps a document observation ACK targetless')) {
		error('SCTRL-005/SCTRL-029/SCTRL-031: document observations must ACK target:null');
	}

	const videoTransform = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/video/video-transform.ts'),
		'utf8',
	);
	for (const duplicateWriter of ['requestFullscreen', '.style.transform', '.style.filter', '.style.objectFit', 'toggleCrop']) {
		if (videoTransform.includes(duplicateWriter)) {
			error(`SCTRL-003: video-transform.ts must stay screenshot-only (${duplicateWriter})`);
		}
	}
	if (!videoTransform.includes('{ documentId: target.documentId, generation }')
		|| !videoTransform.includes('getActiveMediaRegistry()?.resolve(target)?.element !== video')) {
		error('SCTRL-005/SCTRL-006: screenshot geometry must remain bound to the selected document, generation and media source');
	}
	const videoEffects = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/video/video-effects-controller.ts'),
		'utf8',
	);
	for (const required of [
		'video.style.removeProperty(OWNER_PROPERTIES[0])',
		'video.style.removeProperty(OWNER_PROPERTIES[1])',
		'video.style.removeProperty(OWNER_PROPERTIES[2])',
		'video.style.removeProperty(OWNER_PROPERTIES[3])',
		'this.#assertOwnerReadback(video, state, field)',
		'!hadOwnerBaseline && !hasActiveCssEffect',
		'readonly #ownerToken = crypto.randomUUID()',
		`video[\${OWNER_ATTRIBUTE}="\${ownerToken}"]`,
	]) {
		if (!videoEffects.includes(required)) {
			error(`SCTRL-003/SCTRL-005/SCTRL-026: disabled video effects must prove extension ownership was removed (${required})`);
		}
	}
	if (!videoEffects.includes('window.visualViewport?.addEventListener')
		|| !videoEffects.includes('rect.left - offsetLeft')
		|| !videoEffects.includes('this.#dimBoxes(video)')) {
		error('SCTRL-005/SCTRL-013: dim overlay must read back visual-viewport geometry only while owned');
	}
	if (videoEffects.includes('if (previousState) previousState.dimEnabled = false;\n\t\t\tthis.release(previous);')
		|| !videoEffects.includes('if (previousState) this.#commit(previous, previousState)')
		|| !videoEffects.includes('if (this.#dimTarget && this.#dimTarget !== video)')
		|| !fs.readFileSync(
			path.join(root, APP_PATH, 'test/video-effects-controller.spec.ts'),
			'utf8',
		).includes('preserves independent CSS effects when the dim target changes')) {
		error('SCTRL-003/SCTRL-009: dim owner handoff must preserve independent CSS effects on the previous video');
	}
	const videoSnapshot = videoEffects.match(
		/snapshot\(video: HTMLVideoElement\): VideoEffectState \{(.*?)\n\t\}/su,
	)?.[1] ?? '';
	if (!videoSnapshot.includes('this.#states.get(video) ?? DEFAULT_STATE')
		|| videoSnapshot.includes('this.#state(video)')) {
		error('SCTRL-012/SCTRL-026/SCTRL-030: video snapshot must not allocate target owner state');
	}

	const screenshot = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'background/handlers/screenshot.ts'),
		'utf8',
	);
	for (const required of [
		'chrome.tabs.captureVisibleTab',
		'waitForDownloadComplete(downloadId)',
		"method: 'capture-visible-tab'",
		'const documentId = message.documentId;',
		'sender.documentId !== documentId',
		'{ documentId, generation }',
	]) {
		if (!screenshot.includes(required)) {
			error(`SCTRL-005: screenshot cannot ACK before verified Chrome capture/save (${required})`);
		}
	}

	const spectraCommands = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/logic/spectra-command-handler.ts'),
		'utf8',
	);
	const messageHandler = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/logic/message-handler.ts'),
		'utf8',
	);
	const audioHandler = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'background/handlers/audio.ts'),
		'utf8',
	);
	if (messageHandler.includes("'spectra.audio.visualizer.batch'")
		|| !messageHandler.includes("'spectra.audio.visualizer.demand.set'")
		|| spectraCommands.includes('spectra.audio.visualizer')
		|| !audioHandler.includes("candidate.type === 'spectra.audio.visualizer.batch'")
		|| !audioHandler.includes('return getVisualizerBatch(message.payload)')
		|| !audioHandler.includes('OFFSCREEN_AUDIO_SET_VIZ_SUBSCRIPTIONS')
		|| !audioHandler.includes('OFFSCREEN_AUDIO_GET_VIZ_BATCH')
		|| !audioHandler.includes('captureStates.get(tabId) === true')
		|| audioHandler.includes('setVisualizerSubscribed')) {
		error('SCTRL-012/SCTRL-013: Visualizer sampling must remain Background-owned while exact Content demand uses the explicit subscription route');
	}

	const userScripts = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'background/handlers/user-scripts.ts'),
		'utf8',
	);
	const userScriptsTest = fs.readFileSync(
		path.join(root, APP_PATH, 'test/user-scripts.spec.ts'),
		'utf8',
	);
	if (!userScripts.includes('userScriptsWorldReady ??= initUserScriptsWorld()')
		|| !userScripts.includes('await ensureUserScriptsWorld()')
		|| !userScripts.includes('target: { tabId, documentIds: [documentId] }')
		|| (userScripts.match(/getFrame\(\{ tabId, frameId: 0 \}\)/gu) ?? []).length !== 2
		|| !userScripts.includes('results[0]?.documentId !== documentId')
		|| !userScriptsTest.includes('fails closed at every document-bound execution checkpoint')
		|| userScripts.includes('void initUserScriptsWorld()')) {
		error('SCTRL-001/SCTRL-006/SCTRL-015: USER_SCRIPT setup and execution must remain lazy and document-bound');
	}

	const coordinator = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'background/control-coordinator.ts'),
		'utf8',
	);
	const coordinatorValues = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'background/control-coordinator-values.ts'),
		'utf8',
	);
	const protocol = fs.readFileSync(
		path.join(root, 'packages/contracts/src/spectra.protocol.ts'),
		'utf8',
	);
	const protocolTest = fs.readFileSync(
		path.join(root, APP_PATH, 'test/spectra-protocol.spec.ts'),
		'utf8',
	);
	if (!protocol.includes("'spectra.content.target.changed'")
		|| !coordinator.includes("message.type === 'spectra.content.target.changed'")
		|| !coordinator.includes('handleTargetChanged(tabId, message.payload.target)')
		|| !coordinator.includes('ownsActiveSource ? null : snapshot.activeMedia')
		|| !coordinator.includes('ownsActiveVideo ? null : snapshot.activeVideo')
		|| !protocolTest.includes("type: 'spectra.content.target.changed'")) {
		error('SCTRL-005/SCTRL-014/SCTRL-025: active media/video selection and release must update the shared snapshot without polling');
	}
	for (const missing of missingSourceEvidence(
		{ coordinator, coordinatorValues },
		[
			{ owner: 'coordinatorValues', fragment: 'function projectControlTarget(' },
			{ owner: 'coordinatorValues', fragment: 'function assertUnambiguousTargetScope(' },
			{ owner: 'coordinatorValues', fragment: 'capabilities.map(selectControlCapabilityScope)' },
			{ owner: 'coordinatorValues', fragment: "scope === 'active-video'" },
			{ owner: 'coordinatorValues', fragment: "scope === 'active-media'" },
			{ owner: 'coordinatorValues', fragment: "scope === 'media-source'" },
			{ owner: 'coordinatorValues', fragment: "scope === 'requested-audio-scope'" },
			{ owner: 'coordinator', fragment: 'ackTarget = response.data.target' },
			{
				owner: 'coordinatorValues',
				fragment: 'Mixed media/video controls require one explicit video target',
			},
		],
	)) {
		error(`SCTRL-002/SCTRL-025/SCTRL-029: ACK target projection must remain contract-scoped (${missing.fragment})`);
	}
	if (coordinator.includes('activeMedia = response.data.target')) {
		error('SCTRL-025/SCTRL-029: an executed video target must not overwrite active media');
	}
	if (!coordinator.includes('chrome.action.openPopup({ windowId: tab.windowId })')
		|| !coordinator.includes('openerTabId: request.tabId')
		|| !coordinator.includes('index: tab.index + 1')) {
		error('SCTRL-006/SCTRL-016: browser UI and URL operations must remain adjacent to their bound source tab/window');
	}
	const backgroundOperation = coordinator.match(
		/async function commitBackgroundOperation[\s\S]*?\n\}/u,
	)?.[0] ?? '';
	const coordinatorTest = fs.readFileSync(
		path.join(root, APP_PATH, 'test/control-coordinator.spec.ts'),
		'utf8',
	);
	if (!backgroundOperation.includes('target: null')
		|| !coordinatorTest.includes("operation: 'open-popup'")
		|| !coordinatorTest.includes('expect(popupAck.target).toBeNull()')) {
		error('SCTRL-005/SCTRL-029/SCTRL-031: non-media browser and sandbox operations must ACK target:null');
	}
	if (!coordinator.includes('async function compensateControlPatch(')
		|| !coordinator.includes("code: 'transaction-rollback-failed'")
		|| (coordinator.match(/compensateControlPatch\(/gu) ?? []).length < 3) {
		error('SCTRL-003/SCTRL-005: compound reset/restore operations must compensate side effects and expose rollback failure');
	}
	const audioResetTargetPatch = coordinatorValues.match(
		/const RESET_AUDIO_TARGET_PATCH: ControlPatch = \{([\s\S]*?)\n\};/u,
	)?.[1] ?? '';
	if (!audioResetTargetPatch.includes('volumeBase: 100')
		|| !audioResetTargetPatch.includes('mediaMuted: false')
		|| audioResetTargetPatch.includes('speed')
		|| audioResetTargetPatch.includes('preservePitch')
		|| !coordinator.includes('nativeObservationFields(targetActual, baseline.revision)')
		|| !coordinatorTest.includes("not.toHaveProperty('speed')")
		|| !coordinatorTest.includes("not.toHaveProperty('preservePitch')")) {
		error('SCTRL-002/SCTRL-003: audio reset may write native volume/mute but must only observe speed and pitch preservation');
	}
	if (!coordinator.includes('if (!isControlApplyAck(acknowledgement))')
		|| !coordinator.includes('if (!isControlOperationAck(acknowledgement))')) {
		error('SCTRL-002/SCTRL-005: every coordinator result must pass capability-specific ACK validation before publication');
	}
	if (!coordinator.includes('invalidateNavigation(details.tabId, true)')
		|| (coordinator.match(/invalidateNavigation\(details\.tabId, true\)/gu) ?? []).length !== 2) {
		error('SCTRL-006/SCTRL-014: history and fragment navigation must advance generation while preserving same-document state');
	}

	const runtimeLoader = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'background/runtime-loader.ts'),
		'utf8',
	);
	for (const required of [
		'export async function reconcileHotkeyRuntimeLease(',
		'await reconcileDocumentSiteHotkeys(tabId, documentId, url, hotkeys, {',
		'forgetDocumentSiteHotkeys(tabId, documentId)',
		'export function retainSourceRuntimeLease(',
		'export function releaseSourceRuntimeLease(',
		'owned.markerCount > 0',
		'owned.abActive',
	]) {
		if (!runtimeLoader.includes(required)) {
			error(`SCTRL-010/SCTRL-013: source/hotkey runtime lease ownership is missing (${required})`);
		}
	}
	if (!contentCoreIndex.includes("'spectra.content.source.released'")
		|| !coordinator.includes("message.type === 'spectra.content.source.released'")) {
		error('SCTRL-006/SCTRL-010/SCTRL-013: source removal must release Background and Content ownership');
	}

	const bootstrap = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/core/bootstrap.ts'),
		'utf8',
	);
	const controlArchitecture = (() => {
		const idx = fs.readFileSync(
			path.join(root, APP_PATH, 'docs/control-architecture.md'),
			'utf8',
		);
		const controlDir = path.join(root, APP_PATH, 'docs/control');
		if (!fs.existsSync(controlDir)) return idx;
		const subs = fs.readdirSync(controlDir).filter(f => f.endsWith('.md'));
		return [idx, ...subs.map(f => fs.readFileSync(path.join(controlDir, f), 'utf8'))].join('\n\n');
	})();
	if (!controlArchitecture.includes('top-level document only (`frameId: 0`)')
		|| !bootstrap.includes("document.querySelectorAll<HTMLMediaElement>('video,audio')")
		|| !bootstrap.includes("request.fields.every((field) => field === 'pip' || field === 'fullscreen')")
		|| !bootstrap.includes("document.addEventListener('volumechange', onNativeMediaChange, true)")
		|| !bootstrap.includes("document.addEventListener('ratechange', onNativeMediaChange, true)")
		|| !bootstrap.includes('observationInFlight')
		|| !bootstrap.includes('pendingObservation')
		|| !bootstrap.includes('state.disposeRuntime')
		|| bootstrap.includes('new MutationObserver(')) {
		error('SCTRL-001/SCTRL-018: top-level bootstrap readback/observation must stay bounded and yield to the heavy runtime');
	}

	const shortcuts = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'background/shortcuts.ts'),
		'utf8',
	);
	const bootstrapContract = fs.readFileSync(
		path.join(root, 'packages/contracts/src/spectra.bootstrap.ts'),
		'utf8',
	);
	const hotkeyContracts = fs.readFileSync(
		path.join(root, 'packages/contracts/src/hotkeys.contracts.ts'),
		'utf8',
	);
	const pageHotkeyListener = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/input/hotkey-listener.ts'),
		'utf8',
	);
	const hotkeyEvent = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/input/hotkey-event.ts'),
		'utf8',
	);
	const leanSiteHotkeyHost = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/input/lean-site-hotkey-host.ts'),
		'utf8',
	);
	const siteHotkeyOwner = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'background/site-hotkey-owner.ts'),
		'utf8',
	);
	const defaultScalarGesture = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/input/default-scalar-gesture.ts'),
		'utf8',
	);
	const feedbackSurface = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/ui/feedback-surface.ts'),
		'utf8',
	);
	const toast = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/ui/toast.ts'),
		'utf8',
	);
	const osd = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/ui/osd.ts'),
		'utf8',
	);
	const contentRuntime = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/core/index.ts'),
		'utf8',
	);
	const contentRuntimeLifecycle = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/core/content-runtime-lifecycle.ts'),
		'utf8',
	);
	const contentRuntimeDisposeStart = contentRuntime.indexOf('dispose(handoff = false)');
	const contentRuntimeDisposeEnd = contentRuntime.indexOf(
		'function isCurrentRuntime(',
		contentRuntimeDisposeStart,
	);
	const contentRuntimeDispose = contentRuntimeDisposeStart >= 0
		&& contentRuntimeDisposeEnd > contentRuntimeDisposeStart
		? contentRuntime.slice(contentRuntimeDisposeStart, contentRuntimeDisposeEnd)
		: '';
	const scalarFeedback = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/ui/scalar-feedback.ts'),
		'utf8',
	);
	const optionsSlots = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'options/slots-editor.ts'),
		'utf8',
	);
	const shortcutManifest = JSON.parse(fs.readFileSync(
		path.join(root, APP_PATH, 'public/manifest.json'),
		'utf8',
	));
	if (shortcuts.includes('^file:')
		|| !shortcuts.includes("active?.url && /^https?:/u.test(active.url) ? active : undefined")) {
		error('SCTRL-006/SCTRL-015: Chrome shortcut targets must match the coordinator HTTP(S) origin boundary');
	}
	for (const required of [
		'const activeChromeCommands = new Set<string>()',
		'if (activeChromeCommands.has(command)) return false',
		'activeChromeCommands.add(command)',
		'activeChromeCommands.delete(command)',
		'const pageGestureBursts = new Map<string, {',
		'const MAX_REPEAT_BURST_PULSES = 160',
		'state.pendingPulses = Math.min(MAX_REPEAT_BURST_PULSES',
		'state.expiry = setTimeout(() => {',
		'export function releasePageGestureBurst(',
		'export function waitForPageGestureBurst(',
		'void runChromeCommandSingleFlight(command, execute).catch((error: unknown) => {',
	]) {
		if (!shortcuts.includes(required)) {
			error(`SCTRL-022: shortcut repeat/release gate is missing (${required})`);
		}
	}
	const defaultHotkeyMapSource = bootstrapContract.match(
		/export const SPECTRA_DEFAULT_HOTKEY_ACTION_BY_CODE = \{(.*?)\} as const/su,
	)?.[1] ?? '';
	const defaultHotkeyMappings = new Map(
		[...defaultHotkeyMapSource.matchAll(
			/\b([A-Za-z][A-Za-z0-9]*): '([^']+)'/gu,
		)].map((match) => [match[1], match[2]]),
	);
	const defaultHotkeyActions = [...defaultHotkeyMappings.values()];
	const reservedManifestKeys = [...defaultHotkeyMappings.keys()].map((code) => {
		const key = code.startsWith('Arrow')
			? code.slice('Arrow'.length)
			: code.startsWith('Key')
				? code.slice('Key'.length)
				: code;
		return `Alt+${key}`;
	});
	const suggestedKeys = Object.values(shortcutManifest.commands ?? {})
		.flatMap(command => Object.values(command.suggested_key ?? {}));
	const bootstrapDefaultResolver = bootstrap.match(
		/const defaultHotkeyAction =[\s\S]*?(?=\n\tconst sendDefaultScalarPhase)/u,
	)?.[0] ?? '';
	const bootstrapAcceptedKeydown = bootstrap.match(
		/const acceptDefaultHotkeyKeydown =[\s\S]*?(?=\n\tconst releaseDefaultScalarGesture)/u,
	)?.[0] ?? '';
	const bootstrapHotkeyClaim = bootstrap.match(
		/function claimHotkeyEvent\([\s\S]*?\n\}/u,
	)?.[0] ?? '';
	const siteHotkeyResolver = pageHotkeyListener.match(
		/function resolveSiteHotkeyBinding\([\s\S]*?(?=\nfunction handleKeydown)/u,
	)?.[0] ?? '';
	const siteHotkeyHandler = pageHotkeyListener.match(
		/function handleKeydown\([\s\S]*?(?=\nfunction modifierForCode)/u,
	)?.[0] ?? '';
	const physicalReleasePublisher = defaultScalarGesture.match(
		/export function publishPhysicalHotkeyRelease\([\s\S]*?(?=\nexport function subscribePhysicalHotkeyRelease)/u,
	)?.[0] ?? '';
	const siteHotkeyInitialization = pageHotkeyListener.match(
		/export async function initHotkeyListener\([\s\S]*?(?=\nfunction handleSettingsEvent)/u,
	)?.[0] ?? '';
	const siteHotkeySettingsChange = pageHotkeyListener.match(
		/if \(isSpectraEventEnvelope\(message\) && message\.type === 'spectra\.hotkeys\.changed'\) \{[\s\S]*?\n\t\}/u,
	)?.[0] ?? '';
	const propagationStop = /\.stop(?:Immediate)?Propagation\s*\(/u;
	const directKeyboardRegistration =
		/(?:window|document)\.(?:add|remove)EventListener\(\s*['"]key(?:down|up)['"]/u;
	const arbiterUsageCount = (source) => (
		source.match(/createWebsiteFirstKeyboardArbiter\(\{/gu) ?? []
	).length;
	const hasPropagationFallback = /const cleanupTimer = setTimeout\(\(\) => \{[\s\S]*?options\.onSettled\(event, owned\.candidate, true\);[\s\S]*?\}, 0\);/u
		.test(hotkeyEvent);
	if (defaultHotkeyMappings.size !== 5
		|| new Set(defaultHotkeyActions).size !== defaultHotkeyMappings.size
		|| !bootstrapContract.includes(
			'typeof SPECTRA_DEFAULT_HOTKEY_ACTION_BY_CODE[',
		)
		|| !bootstrapContract.includes(
			'keyof typeof SPECTRA_DEFAULT_HOTKEY_ACTION_BY_CODE',
		)
		|| !/Object\.freeze\(Object\.values\(SPECTRA_DEFAULT_HOTKEY_ACTION_BY_CODE\)\)/u
			.test(bootstrapContract)
		|| !bootstrapContract.includes(
			'Object.hasOwn(SPECTRA_DEFAULT_HOTKEY_ACTION_BY_CODE, chord.code)',
		)
		|| bootstrapContract.includes("if (chord.code === '")
		|| !bootstrapContract.includes(
			'if (!chord.altKey || chord.ctrlKey || chord.shiftKey || chord.metaKey) return null',
		)
		|| !hasNamedImports(
			bootstrap,
			'@nexus/contracts/bootstrap',
			['resolveSpectraDefaultHotkeyAction'],
		)
		|| !hasNamedImports(
			pageHotkeyListener,
			'@nexus/contracts',
			['resolveSpectraDefaultHotkeyAction'],
		)
		|| !hasNamedImports(
			bootstrap,
			'../input/hotkey-event',
			[
				'isEditableHotkeyEvent',
				'subscribeDocumentStartPhysicalHotkeyRelease',
			],
		)
		|| !hasNamedImports(
			pageHotkeyListener,
			'./hotkey-event',
			['createWebsiteFirstKeyboardArbiter', 'isEditableHotkeyEvent'],
		)
		|| arbiterUsageCount(bootstrap) !== 0
		|| arbiterUsageCount(pageHotkeyListener) !== 1
		|| arbiterUsageCount(leanSiteHotkeyHost) !== 1
		|| !leanSiteHotkeyHost.includes("nextScalarGestureId('site')")
		|| !leanSiteHotkeyHost.includes("disposition: 'site-page'")
		|| !leanSiteHotkeyHost.includes('__SPECTRA_LEAN_SITE_HOTKEY_HOST__')
		|| !siteHotkeyOwner.includes("files: [LEAN_HOST_FILE]")
		|| !siteHotkeyOwner.includes("world: 'ISOLATED'")
		|| !siteHotkeyOwner.includes("if (response === undefined) return 'absent'")
		|| !hotkeyEvent.includes('const pending = new Map<KeyboardEvent')
		|| !hotkeyEvent.includes('const candidate = options.resolveCandidate(event)')
		|| !hotkeyEvent.includes('pending.set(event, { candidate, tail, cleanupTimer })')
		|| !hotkeyEvent.includes('if (tailEvent !== event) return;')
		|| !hotkeyEvent.includes('const owned = clearPending(event)')
		|| !hotkeyEvent.includes('window.addEventListener(options.type, capture, true)')
		|| !hotkeyEvent.includes('window.addEventListener(options.type, tail)')
		|| !hotkeyEvent.includes('owned.candidate')
		|| !hotkeyEvent.includes('event.defaultPrevented || event.cancelBubble')
		|| !hasPropagationFallback
		|| hotkeyEvent.includes('queueMicrotask')
		|| !hotkeyEvent.includes('window.removeEventListener(options.type, owned.tail)')
		|| !hotkeyEvent.includes('clearTimeout(owned.cleanupTimer)')
		|| !hotkeyEvent.includes('window.removeEventListener(options.type, capture, true)')
		|| !hotkeyEvent.includes('for (const [event] of pending) clearPending(event)')
		|| !hotkeyEvent.includes("const PHYSICAL_RELEASE_OWNER_KEY = '__spectraPhysicalHotkeyReleaseV1'")
		|| !hotkeyEvent.includes("window.addEventListener('keyup'")
		|| !hotkeyEvent.includes('for (const subscriber of current.listeners) subscriber(event)')
		|| hotkeyEvent.includes("window.removeEventListener('keyup'")
		|| directKeyboardRegistration.test(pageHotkeyListener)
		|| !bootstrap.includes('if (!event.isTrusted')
		|| !(/event\.defaultPrevented[\s\S]*resolveSpectraDefaultHotkeyAction/u
			.test(bootstrapDefaultResolver)
			|| /event\.defaultPrevented[\s\S]*defaultHotkeyAction\(event\)/u
				.test(bootstrapAcceptedKeydown))
		|| !bootstrapAcceptedKeydown.includes('claimHotkeyEvent(event)')
		|| !bootstrapHotkeyClaim.includes('event.preventDefault()')
		|| !bootstrapHotkeyClaim.includes('event.stopImmediatePropagation()')
		|| !bootstrap.includes("window.addEventListener('keydown', onDefaultHotkeyKeydown, true)")
		|| !bootstrap.includes("window.addEventListener('keyup', onDefaultHotkeyKeyup, true)")
		|| !pageHotkeyListener.includes('resolveCandidate: resolveSiteHotkeyBinding')
		|| !pageHotkeyListener.includes('if (!websiteClaimed) handleKeydown(event, binding)')
		|| !pageHotkeyListener.includes('if (leanSiteHotkeyOwnsConfiguredBindings()) return null')
		|| siteHotkeyHandler.includes('resolveSiteHotkeyBinding(')
		|| !bootstrap.includes('if (isEditableHotkeyEvent(event)) return null')
		|| !pageHotkeyListener.includes('if (isEditableHotkeyEvent(e)) return null')
		|| propagationStop.test(pageHotkeyListener)
		|| propagationStop.test(hotkeyEvent)
		|| !/if \(resolveSpectraDefaultHotkeyAction\(e\) !== null\) return null;[\s\S]*const site = getSiteConfig\(\)/u
			.test(siteHotkeyResolver)
		|| !bootstrap.includes("if (active.action === 'volume_mute') return")
		|| !shortcuts.includes(
			"if (message.payload.action === 'volume_mute' && message.payload.repeated)",
		)
		|| !bootstrap.includes("sendDefaultScalarPhase(active, 'release')")
		|| !bootstrap.includes("publishDefaultScalarGesture({ ...active, phase: 'release' })")
		|| !defaultScalarGesture.includes('replayListeners: Set<HotkeyReplayListener>')
		|| !defaultScalarGesture.includes('pendingReplay: HotkeyReplaySignal[]')
		|| !defaultScalarGesture.includes("releasedSequences: Record<'default' | 'site', number>")
		|| !defaultScalarGesture.includes('releaseListeners: Set<PhysicalHotkeyReleaseListener>')
		|| !defaultScalarGesture.includes("const CHANNEL_KEY = '__spectraHotkeyGestureV4'")
		|| !defaultScalarGesture.includes("export function nextScalarGestureId(namespace: 'default' | 'site')")
		|| !defaultScalarGesture.includes('const pending = owner.pendingReplay.splice(0)')
		|| !defaultScalarGesture.includes('return () => owner.replayListeners.delete(listener)')
		|| !pageHotkeyListener.includes('!isHotkeyGestureReleased(message.payload.gesture)')
		|| !physicalReleasePublisher.includes('channel().releaseListeners')
		|| physicalReleasePublisher.includes('pending')
		|| !pageHotkeyListener.includes('subscribeHotkeyReplay((signal) =>')
		|| !pageHotkeyListener.includes('subscribePhysicalHotkeyRelease(releaseSiteHotkeys)')
		|| siteHotkeyInitialization.indexOf(
			'subscribePhysicalHotkeyRelease(releaseSiteHotkeys)',
		) >= siteHotkeyInitialization.indexOf('synchronizeKeydownListener()')
		|| siteHotkeySettingsChange.indexOf('cancelActiveBindings()')
			>= siteHotkeySettingsChange.indexOf('settings = message.payload')
		|| !pageHotkeyListener.includes('if (!e.repeat) releaseSiteHotkeys({ code: e.code })')
		|| !pageHotkeyListener.includes('addRepeatPulse(held.feedbackGesture)')
		|| !pageHotkeyListener.includes(
			'lastRepeatExecutionAt.set(held.feedbackGesture, e.timeStamp)',
		)
		|| !pageHotkeyListener.includes('inFlightGestures.has(held.feedbackGesture)')
		|| pageHotkeyListener.includes('const coalesced = new Map')
		|| pageHotkeyListener.includes('cancelCoalesced')
		|| !pageHotkeyListener.includes('advanceHotkeyTargetOSD(')
		|| !pageHotkeyListener.includes(
			'if (!admitsHotkeyActualOSDGesture(',
		)
		|| !pageHotkeyListener.includes(
			'claimHotkeyActualOSDGesture(message.payload.gesture)',
		)
		|| !bootstrap.includes('publishHotkeyActualFeedback(message)')
		|| pageHotkeyListener.includes('defaultScalarFeedbackTargets')
		|| pageHotkeyListener.includes('feedbackTarget')
		|| !shortcuts.includes("candidate.type !== 'spectra.content.default-hotkey.trigger'")
		|| !shortcuts.includes('sender.frameId !== 0')
		|| !shortcuts.includes('const identity = defaultHotkeySenderIdentity(sender)')
		|| !shortcuts.includes('if (!frame?.documentId || frame.documentId !== identity.documentId)')
		|| !shortcuts.includes("await validateHotkeyDocument(identity, 'Default hotkey')")
		|| !shortcuts.includes("await validateHotkeyDocument(identity, 'Site hotkey')")
		|| !shortcuts.includes("message.payload.disposition === 'site-page'")
		|| shortcuts.includes('before.url !== identity.url')
		|| !shortcuts.includes('{ ...identity.tab, url: before.url }')
		|| !shortcuts.includes("'builtin-page'")
		|| !shortcuts.includes('{ tabId: identity.tabId, documentId: identity.documentId }')
		|| !shortcuts.includes('message.payload.gesture')
		|| shortcuts.includes('isCancelled')
		|| shortcuts.includes('isReleased')
		|| !hotkeyContracts.includes("selectHotkeyRepeatPolicy(action) !== 'coalesce-20hz'")
		|| !hotkeyContracts.includes(
			'const DEFAULT_HOTKEY_ACTION_SET: ReadonlySet<string> = new Set(SPECTRA_DEFAULT_HOTKEY_ACTIONS)',
		)
		|| !hotkeyContracts.includes('&& !DEFAULT_HOTKEY_ACTION_SET.has(action)')
		|| !/export const DEFAULT_HOTKEY_SETTINGS:[\s\S]*?slots:\s*\{\s*\}/u
			.test(hotkeyContracts)
		|| hotkeyContracts.includes('DEFAULT_SLOTS')
		|| hotkeyContracts.includes('PRESET_BINDINGS')
		|| fs.existsSync(path.join(root, 'packages/contracts/src/hotkeys.presets.ts'))
		|| [...defaultHotkeyActions.filter(action => action !== 'volume_up'), 'toggle_mute'].some(
			(command) => Object.hasOwn(shortcutManifest.commands ?? {}, command),
		)
		|| shortcutManifest.commands?.volume_up?.suggested_key?.default !== 'Alt+Up'
		|| !shortcuts.includes("volume_up: 'volume_up'")
		|| !shortcuts.includes('const action = resolveChromeCommandAction(command)')
		|| !shortcuts.includes('await executeShortcutRoute(')
		|| reservedManifestKeys.some(
			key => key !== 'Alt+Up' && suggestedKeys.includes(key),
		)) {
		error('SCTRL-006/SCTRL-022: reserved defaults require exclusive Bootstrap or browser-command ownership; configured site hotkeys require website-first admission and timer-free cleanup');
	}
	if (!feedbackSurface.includes("host.popover = 'manual'")
		|| !feedbackSurface.includes("document.addEventListener('fullscreenchange'")
		|| !feedbackSurface.includes("document.removeEventListener('fullscreenchange'")
		|| !feedbackSurface.includes("host.matches(':popover-open')")
		|| !feedbackSurface.includes('host.showPopover()')
		|| !feedbackSurface.includes('feedbackHosts.clear()')
		|| !contentRuntime.includes('disposeOSD();')
		|| !contentRuntime.includes('disposeToast();')
		|| !contentRuntime.includes('disposeFeedbackSurfaces();')
		|| !contentRuntime.includes('contentRuntime.registry.track(disposeFeedbackUI)')
		|| !contentRuntime.includes('disposeSynchronous: () => {')
		|| contentRuntimeDispose.indexOf('disposeFeedbackUI();') < 0
		|| contentRuntimeDispose.indexOf('disposeFeedbackUI();')
			>= contentRuntimeDispose.indexOf('registry.dispose();')
		|| !/disposal\.context\?\.dispose\(\);[\s\S]*disposal\.disposeSynchronous\(\);[\s\S]*await disposal\.release\?\.\(\);[\s\S]*disposal\.finalize\(\);/u
			.test(contentRuntimeLifecycle)
		|| !osd.includes('if (state.disposed) return;')
		|| !toast.includes('if (s.disposed || !document.documentElement) return;')) {
		error('SCTRL-016/SCTRL-022: Toast and OSD require one fullscreen-safe top-layer host whose complete generation lifecycle is runtime-owned');
	}
	if (!scalarFeedback.includes('return ((clamped - scale.min) / (scale.max - scale.min)) * 100')
		|| !scalarFeedback.includes("{ value: 100, label: '100%', lane: 'lower' }")
		|| !scalarFeedback.includes("{ value: 1, label: '1×', lane: 'lower' }")
		|| !scalarFeedback.includes("{ value: 2, label: '2×', lane: 'upper' }")
		|| !osd.includes('volumeState: feedback.volumeState')
		|| !osd.includes('advanceHotkeyTargetOSD(')
		|| !osd.includes('pendingVolumeBoundary(')
		|| !osd.includes('UI_COLORS.CAPTURE')
		|| !osd.includes('UI_COLORS.NATIVE')
		|| osd.includes('resolveAudioVolumeState')
		|| osd.includes('#3b82f6')
		|| osd.includes('#8b5cf6')
		|| osd.includes('payload.capture')
		|| osd.includes('transition:width')
		|| scalarFeedback.includes('Math.log')) {
		error('SCTRL-022: scalar Toast labels, linear fills, markers and gesture-release barriers must share one owner');
	}
	if (!optionsSlots.includes('chrome.runtime.getManifest().commands')
		|| optionsSlots.includes('const PRESET_COMMANDS')
		|| optionsSlots.includes('const SLOT_COMMANDS')) {
		error('SCTRL-022: Options command rows must derive from the explicit extension manifest registry');
	}

	const tabSession = fs.readFileSync(
		path.join(root, 'packages/nexus-kernel/src/storage/tab-session.ts'),
		'utf8',
	);
	if ((tabSession.match(/await writeStoredSession\(tabId,/gu) ?? []).length < 3
		|| tabSession.includes('scheduleWrite(')
		|| tabSession.includes('pendingWrites')
		|| tabSession.includes('STORAGE_WRITE_DEBOUNCE_MS')) {
		error('SCTRL-005/SCTRL-040: acknowledged tab sessions must be physically durable before merge/rebind returns');
	}
	const tabSessionTest = fs.readFileSync(
		path.join(root, APP_PATH, 'test/tab-session.spec.ts'),
		'utf8',
	);
	if (!tabSessionTest.includes('Object.keys(completeSession).sort()')
		|| !tabSessionTest.includes('[...CONTROL_SESSION_FIELDS].sort()')
		|| !tabSessionTest.includes('propagates an undurable ACK')) {
		error('SCTRL-005/SCTRL-040: exhaustive durable tab-session regression coverage is missing');
	}
	const settingsRepository = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'background/settings-repository.ts'),
		'utf8',
	);
	const settingsApply = settingsRepository.slice(
		settingsRepository.indexOf('\tapplyPatch('),
		settingsRepository.indexOf('\n\t// post: atomically consumes'),
	);
	if (!settingsApply.includes('await this.local.set({')
		|| settingsRepository.includes('scheduleWrite(')
		|| settingsRepository.includes('SETTINGS_WRITE_DEBOUNCE_MS')) {
		error('SCTRL-005/SCTRL-040: settings revisions must be physically durable before response and broadcast');
	}
	const badge = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'background/handlers/badge.ts'),
		'utf8',
	);
	if (badge.includes('USED_BADGE_PLACEHOLDER') || badge.includes("text: '•'")) {
		error('SCTRL-014: Badge usage without a complete acknowledged volume pair must remain completely blank');
	}
	const smoke = fs.readFileSync(
		path.join(root, APP_PATH, 'test/smoke.spec.ts'),
		'utf8',
	);
	for (const required of [
		'restores durable acknowledged state and sticky badge after worker replacement plus refresh',
		'applies a site preset before the default global preset after worker replacement',
		'arbitrates configured site hotkeys website-first and releases a truncated keyup',
		'const durableProjection = await evaluateServiceWorker',
	]) {
		if (!smoke.includes(required)) {
			error(`SCTRL-034/SCTRL-040: development/production Chrome lifecycle evidence is missing (${required})`);
		}
	}
	if (!smoke.includes('retires feedback on the final runtime lease and reacquires one new generation')
		|| !smoke.includes('reacquired final runtime lease retirement')) {
		error('SCTRL-022/SCTRL-024: final Content runtime release/reacquire Chrome evidence is missing');
	}

	const visualizerLoop = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'popup/visualizer/loop.ts'),
		'utf8',
	);
	if (!visualizerLoop.includes('if (batchInFlight) return;')
		|| !controlArchitecture.includes('one visualizer IPC owns the next schedule')) {
		error('SCTRL-013/SCTRL-019: visualizer IPC must not leave a timer wake-up loop while a batch is pending');
	}
	const visualizerRunFrame = visualizerLoop.match(
		/function runFrame\(\): void \{(.*?)\n\}/su,
	)?.[1] ?? '';
	if (!visualizerLoop.includes('document.addEventListener(VISUALIZER_STATE_CHANGED_EVENT, reconcileScheduler)')
		|| !visualizerLoop.includes('subscription.params.isProcessorActive()')
		|| !visualizerRunFrame.includes('releaseSubscriptions()')
		|| visualizerRunFrame.includes('scheduleFrame()')) {
		error('SCTRL-013/SCTRL-019/SCTRL-021: visualizer scheduling requires an actual processor, explicit wake and zero-ready stop');
	}
	const visualizerRegistry = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'background/visualizer-subscriber-registry.ts'),
		'utf8',
	);
	const visualizerLeaseTest = fs.readFileSync(
		path.join(root, APP_PATH, 'test/visualizer-subscriber-registry.spec.ts'),
		'utf8',
	);
	for (const required of [
		'VISUALIZER_SUBSCRIBER_TTL_MS = 5_000',
		"state: 'active' | 'tombstone'",
		'payload.generation <= previous.generation',
		'advanceVisualizerSubscriberLeases(',
		'visualizerSubscriberUnion(',
	]) {
		if (!visualizerRegistry.includes(required)) {
			error(`SCTRL-013/SCTRL-021: visualizer subscriber lease boundary is missing (${required})`);
		}
	}
	if (!audioHandler.includes('scheduleVisualizerLeaseExpiry()')
		|| !visualizerLeaseTest.includes('preserves the other independent consumer')
		|| !visualizerLeaseTest.includes('rejects a delayed batch resurrection')) {
		error('SCTRL-013/SCTRL-021: visualizer abnormal-exit and anti-resurrection evidence is missing');
	}

	const popupInit = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'popup/card/init.ts'),
		'utf8',
	);
	const popupTypes = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'popup/card/types.ts'),
		'utf8',
	);
	const popupMessaging = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'popup/card/messaging.ts'),
		'utf8',
	);
	if (popupInit.includes('.actualConfig')
		|| popupInit.includes('status?.config')
		|| !popupInit.includes('initialControlConfig(controlSnapshot)')
		|| !popupTypes.includes('export function initialControlConfig(')
		|| popupMessaging.includes("strategies.includes('capture')")
		|| popupMessaging.includes('state.desiredMode = state.actualMode')) {
		error('SCTRL-014/SCTRL-020: Popup fields must initialize from ControlSnapshot only');
	}
	if (!popupMessaging.includes("rawMessage.type === 'spectra.audio.session.changed'")
		|| !popupMessaging.includes('state.actualMode = snapshot.actualMode')
		|| !popupMessaging.includes('state.phase = snapshot.phase')) {
		error('SCTRL-014/SCTRL-020: Popup processor lifecycle must be owned only by AudioSessionSnapshot');
	}
	const videoControls = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'popup/side-panel/video-controls.ts'),
		'utf8',
	);
	const popupMediaControls = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'popup/card/media-events.ts'),
		'utf8',
	);
	const popupPipBridge = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/input/trusted-activation-bridge.ts'),
		'utf8',
	);
	const hotkeyHelpers = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/input/hotkey-helpers.ts'),
		'utf8',
	);
	const popupPipDispatchStart = popupMediaControls.indexOf('async function dispatchPictureInPicture(');
	const popupPipDispatchEnd = popupMediaControls.indexOf(
		'function asControlUiFailure(',
		popupPipDispatchStart,
	);
	const popupPipDispatch = popupPipDispatchStart >= 0 && popupPipDispatchEnd > popupPipDispatchStart
		? popupMediaControls.slice(popupPipDispatchStart, popupPipDispatchEnd)
		: '';
	if ((videoControls.match(/target: snapshot\.activeVideo/gu) ?? []).length !== 3
		|| videoControls.includes('target: currentSnapshot?.activeMedia ?? null')
		|| videoControls.includes('target: snapshot.activeMedia')
		|| !videoControls.includes('activeMedia: currentSnapshot.activeMedia')
		|| videoControls.includes('activeMedia: ack.target ?? currentSnapshot.activeMedia')
		|| !popupMediaControls.includes('togglePictureInPicture(tabId)')
		|| !popupMediaControls.includes("world: 'ISOLATED'")
		|| !popupPipBridge.includes('navigator.userActivation.isActive')
		|| !popupPipBridge.includes("submitTrustedActivationControl('pip')")
		|| !hotkeyHelpers.includes('executor.toggleTrustedActivation(field)')
		|| !nativeExecutor.includes('this.registry.resolveVideo(intent.target)')) {
		error('SCTRL-005/SCTRL-014/SCTRL-025: video controls must target the independent active-video identity');
	}
	if ((popupPipDispatch.match(/chrome\.scripting\.executeScript/gu) ?? []).length !== 1
		|| !popupPipDispatch.includes('return new Promise<SpectraTrustedPipOutcome | null>')
		|| !popupPipDispatch.includes('new MutationObserver(readOutcome)')
		|| popupPipDispatch.includes('while (performance.now() < deadline)')
	) {
		error('ALG-038: Popup PiP must settle through one event-driven ISOLATED execution without polling');
	}
	if (!videoControls.includes('const FILTER_SEND_INTERVAL_MS = 50')
		|| !videoControls.includes('await enqueueControlAction(')
		|| !videoControls.includes('(currentFence) => submitPatch({ filter, filterEnabled: true }, currentFence)')
		|| !videoControls.includes('if (filterInFlight || !pendingFilter) return;')
		|| videoControls.includes("submitMutation({ field: 'filter'")) {
		error('SCTRL-005/SCTRL-013/SCTRL-016: Filter must use one 20 Hz latest-value intent for value plus ownership');
	}

	const hotkeyListener = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/input/hotkey-listener.ts'),
		'utf8',
	);
	if (!hotkeyContracts.includes("HotkeyFeedbackOwner = 'actual-osd' | 'handler-result' | 'listener-label' | 'none'")
		|| !hotkeyContracts.includes('feedbackOwner: HotkeyFeedbackOwner')
		|| !hotkeyListener.includes("feedbackOwner === 'listener-label'")) {
		error('SCTRL-005/SCTRL-022: every hotkey must have exactly one contract-owned feedback path');
	}

	const screenshotProtocol = fs.readFileSync(
		path.join(root, 'packages/contracts/src/spectra.protocol.ts'),
		'utf8',
	);
	const screenshotContent = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/video/video-transform.ts'),
		'utf8',
	);
	const screenshotBackground = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'background/handlers/screenshot.ts'),
		'utf8',
	);
	if (!screenshotProtocol.includes("'spectra.screenshot.target.verify'")
		|| !screenshotContent.includes('export function verifyScreenshotTarget(')
		|| !screenshotBackground.includes('await verifyTarget();')
		|| (screenshotBackground.match(/await verifyTarget\(\);/gu) ?? []).length !== 2) {
		error('SCTRL-005/SCTRL-023: screenshot source/geometry must be verified before and after capture');
	}

	const runtimeLeaseTest = fs.readFileSync(
		path.join(root, APP_PATH, 'test/runtime-loader.spec.ts'),
		'utf8',
	);
	if (!runtimeLoader.includes('const leases = new Map<string, Set<string>>()')
		|| !runtimeLoader.includes('active.add(runtimeLeaseKey(reason, capability))')
		|| !runtimeLoader.includes('function canReleaseRuntimeConsumer(')
		|| !runtimeLoader.includes("sender.url.startsWith(chrome.runtime.getURL(''))")
		|| !runtimeLeaseTest.includes('same consumer token as idempotent')
		|| !runtimeLeaseTest.includes('tab-hosted extension UI release while rejecting content documents')
		|| !runtimeLeaseTest.includes('final independent consumer releases')) {
		error('SCTRL-013/SCTRL-024: runtime reference count must use unique consumer tokens');
	}

	const nativeAckStart = nativeMediaAsync.indexOf('export async function writeWithStableEventAck<');
	const nativeAckEnd = nativeMediaAsync.indexOf('\nexport async function measureVideoFrameDuration(', nativeAckStart);
	const nativeAckFunction = nativeAckStart >= 0 && nativeAckEnd > nativeAckStart
		? nativeMediaAsync.slice(nativeAckStart, nativeAckEnd)
		: '';
	const nativeAckTest = fs.readFileSync(
		path.join(root, APP_PATH, 'test/native-media-executor.spec.ts'),
		'utf8',
	);
	if (!nativeAckFunction.includes('target.addEventListener(type, onEvent)')
		|| nativeAckFunction.indexOf('target.addEventListener(type, onEvent)')
			> nativeAckFunction.indexOf('await write()')
		|| !nativeAckFunction.includes('if (!await acknowledgement)')
		|| !nativeExecutor.includes("value ? 'playing' : 'pause'")
		|| !nativeExecutor.includes('pageCandidateRestoredBaseline(')
		|| !nativeExecutor.includes('previous === upgradeFrom')
		|| !nativeExecutor.includes("The executor's event/getter transaction owns every event")
		|| !nativeAckTest.includes('waits through microtask, rAF and 50ms page rollbacks before rejecting native ACKs')
		|| !nativeAckTest.includes('rejects a getter match when no native event acknowledges the setter')
		|| !nativeAckTest.includes('upgrades a DOM-owned restore when a page controller appears later in the same document')
		|| !nativeAckTest.includes('keeps DOM ownership after a late page controller rejects one value and upgrades on a later accepted value')
		|| !nativeAckTest.includes('falls through to standard playbackRate when an unowned page controller rejects a higher speed')
		|| !nativeAckTest.includes('restores a high speed through DOM fallback when a page controller clamps asynchronously')
		|| !smoke.includes('falls through a capped page controller and acknowledges high DOM playback speed once')
		|| !smoke.includes('upgrades restored DOM speed when a same-document SPA modal controller mounts later')
		|| !smoke.includes('replays speed when a pre-rendered same-document SPA modal becomes active')) {
		error('SCTRL-005/SCTRL-017/SCTRL-027/SCTRL-040: native ACK, rollback, writer maturation, and SPA activation replay must remain covered');
	}
	if (!nativeMediaAsync.includes('requestVideoFrameCallback')
		|| !nativeMediaAsync.includes('sourceRevision')
		|| nativeMediaAsync.includes('totalVideoFrames')) {
		error('SCTRL-005/SCTRL-010: frame-step must use bounded source-scoped frame cadence evidence');
	}

	if (!nativeExecutor.includes('document.pictureInPictureElement === element')
		|| !nativeExecutor.includes('fullscreenOwnsMedia(element)')) {
		error('SCTRL-003/SCTRL-015: disabling PiP/fullscreen must not exit another page element\'s native session');
	}

	const modeExecutor = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/logic/mode-executor.ts'),
		'utf8',
	);
	const policyExecutor = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/logic/policy-executor/index.ts'),
		'utf8',
	);
	if (/\b(?:AudioContext|MediaElementAudioSourceNode|createMediaElementSource|WebAudioController|CapabilityPlanner)\b/u.test(executableSource(modeExecutor))
		|| /\b(?:AudioContext|MediaElementAudioSourceNode|createMediaElementSource|WebAudioController|CapabilityPlanner)\b/u.test(executableSource(policyExecutor))) {
		error('SCTRL-003/SCTRL-008: Content mode and policy executors must remain Capture-only and processor-free');
	}
	const contentCore = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/logic/audio-runtime-control-delegate.ts'),
		'utf8',
	);
	if (!contentCore.includes("intent.requestedCoverage !== 'full'")
		|| !contentCore.includes("code: 'coverage-incomplete'")) {
		error('SCTRL-002/SCTRL-011: shared audio processors must reject target-only requests before activation');
	}
	if (!contentCore.includes('for (const field of AUDIO_RUNTIME_CONTROL_FIELDS) acknowledgedFields.add(field)')
		|| !contentCore.includes("phase: isDisabledRelease ? 'idle'")) {
		error('SCTRL-005/SCTRL-011: audioEnabled must expand dependent actual ACKs and expose runtime release');
	}
}

export function checkSpectraControlArchitecture(root) {
	section('检查 SPECTRA 控制架构...');
	checkDefaultRuntime(root);
	checkAudioProcessorOwners(root);
	checkSpectraV3EnvelopeOwner(root);
	checkPolicyOwner(root);
	checkProductionLoadingTopology(root);
	checkWriterBoundaries(root);
	checkForbiddenMainPatches(root);
	checkRetiredPaths(root);
	ok('SPECTRA 新控制算法均受原生优先与 writer 边界约束');
}

import fs from 'node:fs';
import path from 'node:path';
import { SPECTRA_CONTROL_ALGORITHM_ADJUDICATIONS } from './spectra-control-algorithm-catalog.mjs';
import { error, ok, scanDir, section } from './utils.js';

const APP_PATH = 'apps/extension-spectra';
const SOURCE_PATH = `${APP_PATH}/src`;

const LEGACY_WRITERS = Object.freeze({
	volume: new Set(),
	muted: new Set(),
	playbackRate: new Set([
		`${SOURCE_PATH}/content/audio/volume-observer.ts`,
		`${SOURCE_PATH}/content/core/lifecycle/media-observer.ts`,
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
	currentTime: new Set([`${SOURCE_PATH}/content/logic/native-media-executor.ts`]),
	preservesPitch: new Set([`${SOURCE_PATH}/content/logic/native-media-executor.ts`]),
	loop: new Set([`${SOURCE_PATH}/content/logic/native-media-executor.ts`]),
	inlineVideoStyle: new Set(),
	focusRecovery: new Set(),
});

function normalize(root, fullPath) {
	return path.relative(root, fullPath).replaceAll('\\', '/');
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
		'proven-safe-media-or-explicit-full-output',
		'existing-processor-only',
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
		'capability.write(request.value!);',
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

	const build = fs.readFileSync(path.join(app, 'build.mjs'), 'utf8');
	for (const forbidden of [
		"src/injector/index.ts",
		"out: 'injector.js'",
		"out: \"injector.js\"",
		'src/injector/',
	]) {
		if (build.includes(forbidden)) error(`SCTRL-004: generic MAIN bundle entry is forbidden (${forbidden})`);
	}
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
	if (!contracts.includes('CONTROL_ALGORITHM_POLICIES')) {
		error('SCTRL-002: exhaustive CONTROL_ALGORITHM_POLICIES owner is missing');
	}
	if (!contracts.includes('export const CONTROL_DIRECT_FIELDS')
		|| !contracts.includes("Exclude<ControlField, 'abLoop' | 'visualizer'>")
		|| !contracts.includes('hasOnlyKeys(value, controlDirectFields)')) {
		error('SCTRL-002/SCTRL-005: A/B and Visualizer must stay outside ordinary patch/mutation execution');
	}
	if (!/screenshot:\s*\{\s*scope:\s*'active-video',\s*kind:\s*'compound',\s*orderedStrategies:\s*\['chrome-native'\]/u.test(contracts)
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
	if (!contracts.includes('satisfies Record<ControlCapability, ControlAlgorithmPolicy>')) {
		error('SCTRL-002: control policy must be compile-time exhaustive');
	}
	if (!contracts.includes('CONTROL_STRATEGY_RULES')
		|| !contracts.includes('satisfies Record<ControlStrategy, ControlStrategyRule>')) {
		error('SCTRL-002/SCTRL-015: strategy admission and permission-boundary rules must be exhaustive');
	}
	if (!contracts.includes('CONTROL_ALGORITHM_ADJUDICATIONS')
		|| !contracts.includes('satisfies Record<ControlCapability, ControlAlgorithmAdjudication>')) {
		error('SCTRL-002: every algorithm needs an exhaustive native/augmentation adjudication');
	}
	if (!contracts.includes('export function isControlStrategyAdmittedForCapability(')
		|| !contracts.includes('isControlStrategyAdmittedForCapability(field, strategy)')
		|| !/isControlStrategyAdmittedForCapability\(\s*value\.operation as ControlOperation,/u.test(contracts)) {
		error('SCTRL-002/SCTRL-005: field and operation ACKs must reject strategies outside the exact capability policy');
	}
	const policyBlock = contracts.match(
		/export const CONTROL_ALGORITHM_POLICIES = \{(.*?)\}\s+as const satisfies Record<ControlCapability, ControlAlgorithmPolicy>/su,
	);
	if (!policyBlock) {
		error('SCTRL-002: unable to parse policy owner');
	}
	const planner = fs.readFileSync(
		path.join(root, 'packages/features/audio-engine/src/CapabilityPlanner.ts'),
		'utf8',
	);
	if (!planner.includes('CONTROL_ALGORITHM_POLICIES[field]')) {
		error('SCTRL-002: CapabilityPlanner must consume the canonical algorithm policy');
	}
	if (!planner.includes('CONTROL_STRATEGY_RULES[strategy]')) {
		error('SCTRL-002: CapabilityPlanner must consume canonical strategy admission rules');
	}
	if (!planner.includes('CONTROL_ALGORITHM_ADJUDICATIONS[field]')) {
		error('SCTRL-002: CapabilityPlanner must enforce per-algorithm augmentation admission');
	}
	if ((planner.match(/context\.requiredCoverage !== 'full'/gu) ?? []).length < 2) {
		error('SCTRL-002/SCTRL-011: Capture must not widen an active-target request to the whole tab');
	}
	const hotkeys = fs.readFileSync(path.join(root, 'packages/contracts/src/hotkeys.contracts.ts'), 'utf8');
	if (!hotkeys.includes('HOTKEY_ACTION_DESCRIPTORS')
		|| !hotkeys.includes('satisfies Record<HotkeyAction, HotkeyActionDescriptor>')
		|| !hotkeys.includes('export function isSlotHotkeyAction(')
		|| !hotkeys.includes('export function isHotkeyParamsForAction(')) {
		error('SCTRL-002: hotkey actions must map exhaustively to control capabilities');
	}
	const settingsContracts = fs.readFileSync(
		path.join(root, 'packages/contracts/src/settings.contracts.ts'),
		'utf8',
	);
	const settingsRepository = fs.readFileSync(
		path.join(root, APP_PATH, 'src/background/settings-repository.ts'),
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
	if (!settingsContracts.includes('isSlotHotkeyAction(action)')
		|| !settingsContracts.includes('isHotkeyParamsForAction(action, value.params)')
		|| !settingsRepository.includes('isSlotHotkeyAction(action)')
		|| !settingsRepository.includes('isHotkeyParamsForAction(binding.action, value.params)')
		|| !shortcuts.includes('filter(([, action]) => isSlotHotkeyAction(action))')
		|| !hotkeyActions.includes('isHotkeyParamsForAction(action, params)')) {
		error('SCTRL-002/SCTRL-016: hotkey slots and parameters must share one contract at storage, runtime and execution boundaries');
	}
	const supportedHotkeys = fs.readFileSync(
		path.join(root, APP_PATH, 'src/options/supported-hotkey-actions.ts'),
		'utf8',
	);
	if (!supportedHotkeys.includes('HOTKEY_ACTION_DESCRIPTORS[action]')) {
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
	if (!coordinator.includes('applyPageObservation(intent, resolvedRequest.observedStrategies)')
		|| !coordinator.includes("source: pageObservation ? 'system' : intent.source")
		|| !coordinator.includes('patch: routedPatch')) {
		error('SCTRL-017: page observations must commit without routing a second content write');
	}
	for (const required of [
		"intent.requestedCoverage !== 'active-target'",
		'applyChromeTabObservation(',
		'changeInfo.mutedInfo?.muted',
	]) {
		if (!coordinator.includes(required)) {
			error(`SCTRL-017: required coordinator invariant is missing (${required})`);
		}
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
			'### §9.4 Source algorithm adjudication catalog',
			'### §12.1 Media WebAudio complete-coverage admission',
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
		if (!architecture.includes('page-lifetime-after-media-binding')
			|| !architecture.includes('the smallest source -> gain -> destination route until navigation')) {
			error('SCTRL-013/SCTRL-016/SCTRL-028: Media WebAudio post-binding lifetime must be explicit and bounded');
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
		const extractCapabilities = (name) => {
			const match = contracts.match(new RegExp(`export const ${name} = \\[(.*?)\\] as const`, 'su'));
			if (!match) {
				error(`SCTRL-002: unable to read ${name} for documentation coverage`);
				return [];
			}
			return [...match[1].matchAll(/'([^']+)'/gu)].map((item) => item[1]);
		};
		for (const capability of [
			...extractCapabilities('CONTROL_FIELDS'),
			...extractCapabilities('CONTROL_OPERATIONS'),
		]) {
			if (!architecture.includes(`| \`${capability}\` |`)) {
				error(`SCTRL-016: per-capability adjudication row is missing for ${capability}`);
			}
		}

		const adjudicationBlock = contracts.match(
			/export const CONTROL_ALGORITHM_ADJUDICATIONS = \{(.*?)\}\s+as const satisfies Record<ControlCapability, ControlAlgorithmAdjudication>/su,
		);
		if (!adjudicationBlock) {
			error('SCTRL-002: unable to parse CONTROL_ALGORITHM_ADJUDICATIONS');
		} else {
			const entries = [...adjudicationBlock[1].matchAll(
				/^\s*(?:'([^']+)'|([A-Za-z][A-Za-z0-9]*)):\s*\{\s*nativePreference:\s*'([^']+)',\s*augmentationAdmission:\s*'([^']+)'\s*\},?$/gmu,
			)];
			for (const entry of entries) {
				const capability = entry[1] ?? entry[2];
				const preference = entry[3];
				const admission = entry[4];
				const exactRow = `| \`${capability}\` | \`${preference}\` | \`${admission}\` |`;
				if (!architecture.includes(exactRow)) {
					error(`SCTRL-016: executable adjudication mirror drifted for ${capability}`);
				}
			}
			const expectedCount = [
				...extractCapabilities('CONTROL_FIELDS'),
				...extractCapabilities('CONTROL_OPERATIONS'),
			].length;
			if (expectedCount !== 51) {
				error(`SCTRL-002: canonical capability count must be 51, found ${expectedCount}`);
			}
			if (entries.length !== expectedCount) {
				error(`SCTRL-002: parsed ${entries.length}/${expectedCount} algorithm adjudications`);
			}
			const totals = entries.reduce((counts, entry) => {
				counts.set(entry[3], (counts.get(entry[3]) ?? 0) + 1);
				return counts;
			}, new Map());
			for (const [preference, expected] of Object.entries({
				'native-only': 17,
				'hybrid-extension-native': 6,
				'augmentation-only': 26,
				'observation-only': 2,
			})) {
				if ((totals.get(preference) ?? 0) !== expected) {
					error(`SCTRL-002: ${preference} count drifted (${totals.get(preference) ?? 0}/${expected})`);
				}
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
		if (!sourceEligibility.includes('never binds or samples a source as a probe')
			|| !sourceEligibility.includes('same-origin URL or CORS mode established before')
			|| sourceEligibility.includes('cors-handler.ts')
			|| sourceEligibility.includes('media-probe.ts')) {
			error('SCTRL-008/SCTRL-016: Media WebAudio eligibility narrative regained probe-based admission');
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
	const build = fs.readFileSync(path.join(root, APP_PATH, 'build.mjs'), 'utf8');
	const externalBoundary = fs.readFileSync(
		path.join(root, APP_PATH, 'scripts/external-boundary-properties.mjs'),
		'utf8',
	);
	const remoteHost = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'offscreen-remote/remote-host.ts'),
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
	const registryClient = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'shared/registry-client.ts'),
		'utf8',
	);
	const uiRuntimeTest = fs.readFileSync(
		path.join(root, APP_PATH, 'test/ui-runtime-contract.spec.ts'),
		'utf8',
	);
	const artifactIntegrity = fs.readFileSync(
		path.join(root, APP_PATH, 'scripts/check-production-artifacts.mjs'),
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
		"const moduleEntries = entries.filter(({ out }) => !out.startsWith('content-'))",
		'const moduleEntryGroups = [',
		"name: 'extension'",
		"sharingDomain: 'extension-pages'",
		'chunkNames: `chunks/${group.name}/[name]-[hash]`',
		'plugins: [contractRuntimeFacadePlugin()]',
		'const addEsmExportProperties = (source) => {',
		'const addCrossContextSingletonProperties = (source) => {',
		"import { collectExternalBoundaryProperties } from './scripts/external-boundary-properties.mjs'",
		"import { checkProductionArtifacts } from './scripts/check-production-artifacts.mjs'",
		"out: 'peerjs-vendor.js'",
		"format: 'iife'",
		"path.endsWith('peerjs-vendor.js')",
		"'target', 'documentIds', 'frameIds', 'allFrames', 'world', 'func', 'args'",
		"keep_quoted: true",
		'splitting: true',
	]) {
		if (!build.includes(required)) {
			error(`SCTRL-001/SCTRL-034: production loading topology drifted (${required})`);
		}
	}
	if (!popup.includes('<script type="module" src="popup.js"></script>')) {
		error('SCTRL-034: Popup must remain an extension-origin module before sharing private chunks');
	}
	const offscreen = fs.readFileSync(path.join(root, APP_PATH, 'public/offscreen.html'), 'utf8');
	if (!externalBoundary.includes("const EXTERNAL_TRANSPORT_METHODS = new Set(['postMessage', 'send', 'sendMessage'])")
		|| !externalBoundary.includes('export function collectExternalBoundaryProperties(')
		|| !externalBoundary.includes('collectLiteralProperties(argument, names)')
		|| !offscreen.includes('<script src="peerjs-vendor.js"></script>')
		|| !remoteHost.includes("import type Peer from 'peerjs'")
		|| !remoteHost.includes("import type { DataConnection } from 'peerjs'")
		|| /(?:^|\n)import\s+(?!type\b)[^;\n]*\bfrom\s+['"]peerjs['"]/u.test(remoteHost)
		|| !remoteHost.includes("throw new Error('Local PeerJS vendor runtime is unavailable')")
		|| !build.includes("sharingDomain: 'offscreen-vendor'")) {
		error('SCTRL-004/SCTRL-014/SCTRL-034/SCTRL-044: production external ABI and opaque PeerJS vendor boundary drifted');
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
		|| !settingsClient.includes("from '@nexus/contracts/ui-settings-runtime'")
		|| !settingsClient.includes("from './ui-settings-spectra-client'")
		|| !registryClient.includes("from './ui-settings-spectra-client'")
		|| settingsClient.includes("from './ui-spectra-client'")
		|| registryClient.includes("from './ui-spectra-client'")
		|| !uiRuntimeTest.includes('keeps the Options facade narrow and canonically equivalent')) {
		error('SCTRL-014/SCTRL-034/SCTRL-043: Options must not load Popup control/session validators');
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
	const audioContracts = fs.readFileSync(
		path.join(root, 'packages/contracts/src/audio.contracts.ts'),
		'utf8',
	);
	const processorContract = audioContracts.match(
		/export interface AudioProcessorConfig \{(.*?)\n\}/su,
	)?.[1] ?? '';
	if (!processorContract.includes('boostGain: number')
		|| processorContract.includes('muted:')
		|| /^\s*volume(?:Base)?\??:/mu.test(processorContract)
		|| !audioContracts.includes('isFiniteInRange(value.boostGain, 1, 8)')
		|| !router.includes('boostGain: clamp(config.boostGain, 1, 8, 1)')
		|| router.includes('normalized.muted')
		|| router.includes('config.muted')) {
		error('SCTRL-003/SCTRL-032: processor contracts cannot become page-volume or media-mute writers');
	}

	const nativeExecutor = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/logic/native-media-executor.ts'),
		'utf8',
	);
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
	if (!mediaRegistry.includes("this.emit(record.target, 'removed', element, 'source-change')")
		|| !mediaRegistry.includes("this.emit(record.target, 'registered', element)")
		|| !mediaRegistry.includes('this.fullscreenMediaId')
		|| !mediaRegistry.includes("this.emit(record.target, 'selected', record.element)")) {
		error('SCTRL-006/SCTRL-007: source revisions and fullscreen events must retain exact media ownership');
	}
	const mediaDetection = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/audio/media-detection.ts'),
		'utf8',
	);
	const mediaObserver = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/core/lifecycle/media-observer.ts'),
		'utf8',
	);
	const pauseTracker = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/utils/pause-tracker.ts'),
		'utf8',
	);
	for (const [name, content] of [
		['media-detection.ts', mediaDetection],
		['media-observer.ts', mediaObserver],
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
	if (mediaObserver.includes('CustomEvent(')
		|| mediaObserver.includes('.dispatchEvent(')
		|| mediaObserver.includes('MEDIA_REGISTRY_CHANGED_EVENT')) {
		error('SCTRL-012/SCTRL-030: MediaRegistry must not emit a second synthetic status event');
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
	if (!contentCoreIndex.includes('registry.track(observeABLoopSources(mediaRegistry, (target) => {')
		|| !contentCoreIndex.includes('registry.track(observeMarkerSources(mediaRegistry))')
		|| !abLoop.includes("if (event !== 'removed') return;")
		|| !markers.includes("if (event === 'removed') markerSets.delete(sourceKey(target));")) {
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
		|| !operationExecutor.includes('const intent = { ...originalIntent, target: resolvedTarget }')) {
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
		|| nativeExecutor.includes('CapabilityPlanner')
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
		"video.style.removeProperty('--spectra-rotate')",
		"video.style.removeProperty('--spectra-scale-x')",
		"video.style.removeProperty('--spectra-filter')",
		'assertOwnerReadback(video, state, field)',
		'!this.ownerBaselines.has(video) && !this.hasActiveCssEffect(predicted)',
		'private readonly ownerToken = crypto.randomUUID()',
		'video[${OWNER_ATTRIBUTE}="${ownerToken}"]',
	]) {
		if (!videoEffects.includes(required)) {
			error(`SCTRL-003/SCTRL-005/SCTRL-026: disabled video effects must prove extension ownership was removed (${required})`);
		}
	}
	if (!videoEffects.includes('window.visualViewport?.addEventListener')
		|| !videoEffects.includes('rect.left - offsetLeft')
		|| !videoEffects.includes('this.dimBoxes(video)')) {
		error('SCTRL-005/SCTRL-013: dim overlay must read back visual-viewport geometry only while owned');
	}
	if (videoEffects.includes('if (previousState) previousState.dimEnabled = false;\n\t\t\tthis.release(previous);')
		|| !videoEffects.includes('if (previousState && !this.hasActiveEffect(previousState))')
		|| !videoEffects.includes('if (this.dimTarget && this.dimTarget !== video)')
		|| !fs.readFileSync(
			path.join(root, APP_PATH, 'test/video-effects-controller.spec.ts'),
			'utf8',
		).includes('preserves independent CSS effects when the dim target changes')) {
		error('SCTRL-003/SCTRL-009: dim owner handoff must preserve independent CSS effects on the previous video');
	}
	const videoSnapshot = videoEffects.match(
		/snapshot\(video: HTMLVideoElement\): VideoEffectState \{(.*?)\n\t\}/su,
	)?.[1] ?? '';
	if (!videoSnapshot.includes('this.states.get(video) ?? DEFAULT_STATE')
		|| videoSnapshot.includes('this.state(video)')) {
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
		'sender.documentId !== message.documentId',
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
	const visualizerGet = spectraCommands.match(
		/case 'spectra\.audio\.visualizer\.get':\s*\{(.*?)case 'spectra\.audio\.visualizer\.subscription\.set'/su,
	)?.[1] ?? '';
	if (!messageHandler.includes("message.type === 'spectra.audio.visualizer.subscription.set'")
		|| !audioHandler.includes("'spectra.audio.visualizer.subscription.set'")
		|| !visualizerGet.includes('deps.getVisualizerData()')
		|| visualizerGet.includes('setVisualizerSubscribed')) {
		error('SCTRL-012/SCTRL-013: Visualizer GET must be a pure read and analyser ownership must use the explicit subscription route');
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
	for (const required of [
		'function projectControlTarget(',
		'function assertUnambiguousTargetScope(',
		'CONTROL_ALGORITHM_POLICIES[capability].scope',
		"scope === 'active-video'",
		"scope === 'active-media'",
		"scope === 'media-source'",
		"scope === 'requested-audio-scope'",
		'ackTarget = response.data.target',
		'Mixed media/video controls require one explicit video target',
	]) {
		if (!coordinator.includes(required)) {
			error(`SCTRL-002/SCTRL-025/SCTRL-029: ACK target projection must remain contract-scoped (${required})`);
		}
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
	const audioResetTargetPatch = coordinator.match(
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
		'const hotkeyLeases = new Map<string, string>()',
		"ensureContentRuntime(tabId, documentId, 'hotkey', capability)",
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
		|| bootstrap.includes('new MutationObserver(')) {
		error('SCTRL-001/SCTRL-018: top-level passive bootstrap readback must stay bounded and observer-free');
	}

	const shortcuts = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'background/shortcuts.ts'),
		'utf8',
	);
	if (shortcuts.includes('^file:')
		|| !shortcuts.includes("active?.url && /^https?:/u.test(active.url) ? active : undefined")) {
		error('SCTRL-006/SCTRL-015: Chrome shortcut targets must match the coordinator HTTP(S) origin boundary');
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
	if ((videoControls.match(/target: currentSnapshot\?\.activeVideo \?\? null/gu) ?? []).length !== 3
		|| videoControls.includes('target: currentSnapshot?.activeMedia ?? null')
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
	if (!videoControls.includes('const FILTER_SEND_INTERVAL_MS = 50')
		|| !videoControls.includes('await submitPatch({ filter, filterEnabled: true })')
		|| !videoControls.includes('if (filterInFlight || !pendingFilter) return;')
		|| videoControls.includes("submitMutation({ field: 'filter'")) {
		error('SCTRL-005/SCTRL-013/SCTRL-016: Filter must use one 20 Hz latest-value intent for value plus ownership');
	}

	const hotkeyContracts = fs.readFileSync(
		path.join(root, 'packages/contracts/src/hotkeys.contracts.ts'),
		'utf8',
	);
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
		|| !runtimeLeaseTest.includes('same consumer token as idempotent')
		|| !runtimeLeaseTest.includes('final independent consumer releases')) {
		error('SCTRL-013/SCTRL-024: runtime reference count must use unique consumer tokens');
	}

	const nativeAckStart = nativeExecutor.indexOf('async function writeWithStableEventAck<');
	const nativeAckEnd = nativeExecutor.indexOf('\nasync function measureVideoFrameDuration(', nativeAckStart);
	const nativeAckFunction = nativeAckStart >= 0 && nativeAckEnd > nativeAckStart
		? nativeExecutor.slice(nativeAckStart, nativeAckEnd)
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
		|| !nativeAckTest.includes('waits through microtask, rAF and 50ms page rollbacks before rejecting native ACKs')
		|| !nativeAckTest.includes('rejects a getter match when no native event acknowledges the setter')) {
		error('SCTRL-005/SCTRL-017: native event listeners and rollback regression coverage must precede actual ACK');
	}
	if (!nativeExecutor.includes('requestVideoFrameCallback')
		|| !nativeExecutor.includes('sourceRevision')
		|| nativeExecutor.includes('totalVideoFrames')) {
		error('SCTRL-005/SCTRL-010: frame-step must use bounded source-scoped frame cadence evidence');
	}

	if (!nativeExecutor.includes('document.pictureInPictureElement === element')
		|| !nativeExecutor.includes('fullscreenOwnsMedia(element)')) {
		error('SCTRL-003/SCTRL-015: disabling PiP/fullscreen must not exit another page element\'s native session');
	}

	const webAudio = fs.readFileSync(
		path.join(root, 'packages/features/audio-engine/src/webaudio/controller.ts'),
		'utf8',
	);
	if (webAudio.includes('querySelectorAll')) {
		error('SCTRL-013: WebAudio command paths must consume the event registry, not scan the document');
	}
	if (!webAudio.includes('private readonly ownedSources = new Set<HTMLMediaElement>()')
		|| !webAudio.includes('if (!this.ownedSources.delete(element)) return;')) {
		error('SCTRL-003/SCTRL-008/SCTRL-013: each WebAudio controller may detach only sources it owns');
	}
	if (!webAudio.includes('async cleanup(): Promise<void>')
		|| !webAudio.includes('await this.runtime.router.bypass()')) {
		error('SCTRL-011/SCTRL-013: WebAudio cleanup must await an acknowledged transparent bypass');
	}
	const webAudioCleanup = webAudio.match(
		/async cleanup\(\): Promise<void> \{(.*?)\n\t\}/su,
	)?.[1] ?? '';
	if (!webAudioCleanup || webAudioCleanup.includes('setVisualizerSubscribed(false)')) {
		error('SCTRL-013/SCTRL-021: processor cleanup cannot release an independent visualizer subscriber lease');
	}
	for (const required of [
		'assessMediaSourceCoverage(',
		'ensureAttached(',
		'hasCompleteCoverage(',
		'hasKnownBindingFailure(',
		'this.runtime.router.disconnectSource(source)',
	]) {
		if (!webAudio.includes(required)) {
			error(`SCTRL-008/SCTRL-011/SCTRL-013: WebAudio complete-coverage ownership is missing (${required})`);
		}
	}
	const modeExecutor = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/logic/mode-executor.ts'),
		'utf8',
	);
	if (!modeExecutor.includes('const previousAppliedConfig = cloneAudioConfig(state.appliedConfig)')
		|| !modeExecutor.includes('restoreWebAudioState(previousAppliedConfig, deps)')
		|| !modeExecutor.includes('async function restoreWebAudioState(')) {
		error('SCTRL-003/SCTRL-011/SCTRL-038: mode handoff must have one transition owner and restore only proven previous actual WebAudio');
	}
	for (const required of [
		'assessMediaSourceCoverage(mediaElements, evidenceFor)',
		'audioController.ensureAttached(element, evidenceFor(element))',
		'audioController.hasCompleteCoverage(mediaElements, evidenceFor)',
	]) {
		if (!modeExecutor.includes(required)) {
			error(`SCTRL-008/SCTRL-011: mode transition may not claim partial Media WebAudio coverage (${required})`);
		}
	}
	const captureBranch = modeExecutor.match(
		/if \(mode === AudioMode\.CAPTURE\) \{(.*?)\} else if \(mode === AudioMode\.DISABLED\)/su,
	)?.[1] ?? '';
	const webAudioBranch = modeExecutor.match(
		/else if \(mode === AudioMode\.NATIVE_WEBAUDIO\) \{(.*?)\n\t\}/su,
	)?.[1] ?? '';
	const modeTransitionTest = fs.readFileSync(
		path.join(root, APP_PATH, 'test/mode-executor-actual-config.spec.ts'),
		'utf8',
	);
	if (!captureBranch
		|| captureBranch.indexOf('await audioController.cleanup()')
			> captureBranch.indexOf('captureManager.request(true')
		|| !webAudioBranch
		|| webAudioBranch.indexOf('captureManager.syncConfig(transparentAudioConfig()')
			> webAudioBranch.indexOf('audioController.initialize(true)')
		|| webAudioBranch.indexOf('applyWebAudioState(config, deps)')
			> webAudioBranch.lastIndexOf('captureManager.request(false')
		|| !modeTransitionTest.includes('neutralizes Media WebAudio before Capture')
		|| !modeTransitionTest.includes('uses Capture as a unity relay')) {
		error('SCTRL-003/SCTRL-005/SCTRL-011: cross-processor handoff must neutralize the old DSP, verify the candidate and only then release');
	}
	const policyExecutor = fs.readFileSync(
		path.join(root, SOURCE_PATH, 'content/logic/policy-executor/index.ts'),
		'utf8',
	);
	if (policyExecutor.includes('state.activeMode === AudioMode.NATIVE_WEBAUDIO) await deps.audioController.cleanup()')) {
		error('SCTRL-003/SCTRL-011/SCTRL-038: PolicyExecutor cannot pre-release the old WebAudio path');
	}
	if (!policyExecutor.includes('evaluateMediaSourceEligibility(')
		|| !policyExecutor.includes('deps.audioController.hasKnownBindingFailure(element)')) {
		error('SCTRL-008/SCTRL-011: policy must route unknown, unsafe or failed full coverage away from Media WebAudio');
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
	checkPolicyOwner(root);
	checkProductionLoadingTopology(root);
	checkWriterBoundaries(root);
	checkForbiddenMainPatches(root);
	checkRetiredPaths(root);
	ok('SPECTRA 新控制算法均受原生优先与 writer 边界约束');
}

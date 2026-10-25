// goal: handles browser command slots and the five page-owned default shortcuts
// rule: configurable slots and page gestures converge only after immutable document routing

import type {
	ControlApplyAck,
	ControlMutation,
	ControlOperationAck,
	HotkeySettings,
	HotkeyAction,
	SpectraDefaultHotkeyAction,
	SpectraHotkeyActualFeedback,
} from '@nexus/contracts';
import {
	createSpectraEvent,
	DEFAULT_HOTKEY_SETTINGS,
	isSlotHotkeyAction,
	resolveSpectraHotkeyActualFeedback,
	rpcFailure,
	rpcSuccess,
	SPECTRA_PROTOCOL_VERSION,
} from '@nexus/contracts';
import { swLog } from '../shared/logger';
import { settingsRepository } from './settings-repository';
import { hotkeyTargetRepository } from './hotkey-target-repository';
import {
	submitExtensionInvokedControlOperation,
	submitExtensionInvokedControlRequest,
} from './control-coordinator';
import type { ExtensionInvocationContext } from './extension-invocation';
import { ensureContentRuntime, releaseContentRuntimeLease } from './runtime-loader';
import { isBackgroundRequestEnvelope, RPC_INVALID_REQUEST } from './background-rpc';
import { RPC_DEADLINE_MS, withDeadline } from '../shared/timeout';
const HOTKEY_SEEK_RELATIVE = 'seek-relative' as const;
const HOTKEY_EFFECTIVE_VOLUME = 'effective-volume' as const;
const PROTO_DEFAULT_HOTKEY_TRIGGER = 'spectra.content.default-hotkey.trigger' as const;

let slotMapping: Record<string, HotkeyAction> = { ...DEFAULT_HOTKEY_SETTINGS.slots };
const BUILTIN_CHROME_COMMAND_ACTIONS = {
	volume_up: 'volume_up',
} as const satisfies Record<string, HotkeyAction>;

export function resolveChromeCommandAction(command: string): HotkeyAction | undefined {
	return BUILTIN_CHROME_COMMAND_ACTIONS[
		command as keyof typeof BUILTIN_CHROME_COMMAND_ACTIONS
	] ?? slotMapping[command];
}

export interface ShortcutRuntimePort {
	ensure(tabId: number, documentId: string, capability: string): Promise<{ documentId: string }>;
	release(tabId: number, documentId: string, capability: string): void;
}

const shortcutRuntimePort: ShortcutRuntimePort = {
	ensure: (tabId, documentId, capability) => (
		ensureContentRuntime(tabId, documentId, 'hotkey', capability)
	),
	release: (tabId, documentId, capability) => {
		releaseContentRuntimeLease(tabId, documentId, 'hotkey', capability);
	},
};

const activeChromeCommands = new Set<string>();
const pageGestureBursts = new Map<string, {
	active: boolean;
	pendingPulses: number;
	expiry: ReturnType<typeof setTimeout> | null;
	lastPulseAt: number;
	settleWaiters: Set<() => void>;
}>();
const MAX_REPEAT_BURST_PULSES = 160;
const REPEAT_BURST_IDLE_MS = 250;

export async function runChromeCommandSingleFlight(
	command: string,
	operation: () => Promise<void>,
): Promise<boolean> {
	if (activeChromeCommands.has(command)) return false;
	activeChromeCommands.add(command);
	try {
		await operation();
		return true;
	} finally {
		activeChromeCommands.delete(command);
	}
}

export async function runPageGestureBurst(
	gesture: string,
	operation: (pulses: number) => Promise<void>,
): Promise<boolean> {
	const state = pageGestureBursts.get(gesture) ?? {
		active: false,
		pendingPulses: 0,
		expiry: null,
		lastPulseAt: 0,
		settleWaiters: new Set(),
	};
	pageGestureBursts.set(gesture, state);
	const pulseAt = Date.now();
	if (state.active) {
		state.pendingPulses = Math.min(MAX_REPEAT_BURST_PULSES, state.pendingPulses + 1);
		state.lastPulseAt = pulseAt;
		return false;
	}
	if (state.expiry) clearTimeout(state.expiry);
	state.expiry = null;
	if (pulseAt - state.lastPulseAt >= REPEAT_BURST_IDLE_MS) state.pendingPulses = 0;
	const pulses = Math.min(MAX_REPEAT_BURST_PULSES, state.pendingPulses + 1);
	state.pendingPulses = 0;
	state.lastPulseAt = pulseAt;
	state.active = true;
	let succeeded = false;
	try {
		await operation(pulses);
		succeeded = true;
		return true;
	} finally {
		state.active = false;
		for (const settle of state.settleWaiters) settle();
		state.settleWaiters.clear();
		if (!succeeded || state.pendingPulses === 0) {
			pageGestureBursts.delete(gesture);
		} else {
			const remainingIdleMs = REPEAT_BURST_IDLE_MS - (Date.now() - state.lastPulseAt);
			if (remainingIdleMs <= 0) {
				pageGestureBursts.delete(gesture);
			} else {
				state.expiry = setTimeout(() => {
					if (!state.active && pageGestureBursts.get(gesture) === state) pageGestureBursts.delete(gesture);
				}, remainingIdleMs);
			}
		}
	}
}

export function waitForPageGestureBurst(gesture: string): Promise<void> {
	const state = pageGestureBursts.get(gesture);
	if (!state?.active) return Promise.resolve();
	return new Promise((resolve) => state.settleWaiters.add(resolve));
}

export function releasePageGestureBurst(gesture: string): void {
	const state = pageGestureBursts.get(gesture);
	if (!state) return;
	state.pendingPulses = 0;
	if (state.expiry) clearTimeout(state.expiry);
	state.expiry = null;
	if (!state.active) pageGestureBursts.delete(gesture);
}

export async function runWithShortcutRuntime<T>(
	tabId: number,
	documentId: string,
	operation: (readyDocumentId: string) => Promise<T>,
	port: ShortcutRuntimePort = shortcutRuntimePort,
): Promise<T> {
	const capability = `command:${crypto.randomUUID()}`;
	const ready = await port.ensure(tabId, documentId, capability);
	try {
		if (ready.documentId !== documentId) throw new Error('Shortcut runtime READY belongs to a stale target document');
		return await operation(ready.documentId);
	} finally {
		port.release(tabId, ready.documentId, capability);
	}
}

async function loadSlotMapping(): Promise<void> {
	try {
		updateShortcutSettings((await settingsRepository.getSnapshot()).hotkeySettings);
	} catch (error) {
		swLog.warn('Unable to load browser shortcut slots', error);
	}
}

export function updateShortcutSettings(settings: HotkeySettings): void {
	slotMapping = Object.fromEntries(
		Object.entries(settings.slots).filter(([, action]) => isSlotHotkeyAction(action)),
	);
}

export function setupShortcutListeners(): void {
	void loadSlotMapping();

	chrome.commands.onCommand.addListener((command) => {
		const action = resolveChromeCommandAction(command);
		if (!action || action === 'none') return;
		const execute = async (): Promise<void> => {
			/* @__PURE__ */ swLog.debug(`Shortcut command: ${command}`);
			const route = await resolveShortcutTarget();
			if (!route) return;
			try {
				await executeShortcutRoute(action, route, 1);
			} catch (error) {
				swLog.warn(`Shortcut ${action} failed`, error);
			}
		};
		void runChromeCommandSingleFlight(command, execute).catch((error: unknown) => {
			swLog.warn(`Shortcut command ${command} failed before execution`, error);
		});
	});

	chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
		if (!message || typeof message !== 'object') return false;
		const candidate = message as { protocolVersion?: unknown; type?: unknown };
		if (candidate.protocolVersion !== SPECTRA_PROTOCOL_VERSION
			|| candidate.type !== 'spectra.content.default-hotkey.trigger') return false;
		if (!isBackgroundRequestEnvelope(message)
			|| message.type !== PROTO_DEFAULT_HOTKEY_TRIGGER) {
			sendResponse(rpcFailure(RPC_INVALID_REQUEST, 'Malformed default hotkey trigger'));
			return false;
		}
		const identity = defaultHotkeySenderIdentity(sender);
		if (!identity) {
			sendResponse(rpcFailure(
				'forbidden',
				'Hotkeys require the current top-level HTTP document',
			));
			return false;
		}
		const burstKey = defaultHotkeyBurstKey(
			identity.tabId,
			identity.documentId,
			message.payload.action,
			message.payload.gesture,
		);
		if (message.payload.phase === 'release') {
			if (message.payload.repeated) releasePageGestureBurst(burstKey);
			void waitForPageGestureBurst(burstKey).then(
				() => sendResponse(rpcSuccess({ accepted: true as const })),
				(error) => sendResponse(rpcFailure(
					'hotkey_release_failed',
					error instanceof Error ? error.message : String(error),
					true,
				)),
			);
			return true;
		}
		if (message.payload.action === 'volume_mute' && message.payload.repeated) {
			sendResponse(rpcSuccess({ accepted: true as const }));
			return false;
		}
		const execution = message.payload.disposition === 'site-page'
			? runSitePageHotkey(identity, message.payload.action, message.payload.gesture, burstKey)
			: runDefaultPageHotkey(identity, message.payload.action, message.payload.gesture, burstKey);
		void execution.then(
			() => sendResponse(rpcSuccess({ accepted: true as const })),
			(error) => sendResponse(rpcFailure(
				message.payload.disposition === 'site-page' ? 'site_hotkey_failed' : 'default_hotkey_failed',
				error instanceof Error ? error.message : String(error),
				true,
			)),
		);
		return true;
	});

	chrome.tabs.onRemoved.addListener((tabId) => {
		void clearRemovedShortcutTarget(tabId);
	});
}

interface DefaultHotkeyIdentity {
	tabId: number;
	documentId: string;
	tab: chrome.tabs.Tab;
}

function defaultHotkeySenderIdentity(sender: chrome.runtime.MessageSender): DefaultHotkeyIdentity | null {
	const tab = sender.tab;
	const tabId = tab?.id;
	if (sender.id !== chrome.runtime.id
		|| sender.frameId !== 0
		|| !tabId
		|| !sender.documentId
		|| !sender.url
		|| !/^https?:/u.test(sender.url)) return null;
	return {
		tabId,
		documentId: sender.documentId,
		tab: { ...tab, id: tabId, url: sender.url },
	};
}

function defaultHotkeyBurstKey(
	tabId: number,
	documentId: string,
	action: SpectraDefaultHotkeyAction,
	gesture: string,
): string {
	return `page:${tabId}:${documentId}:${action}:${gesture}`;
}

async function validateHotkeyDocument(identity: DefaultHotkeyIdentity, label: string) {
	const frame = await chrome.webNavigation.getFrame({ tabId: identity.tabId, frameId: 0 });
	if (!frame?.documentId || frame.documentId !== identity.documentId) {
		throw new Error(`${label} belongs to a stale document`);
	}
	return frame;
}

async function runDefaultPageHotkey(
	identity: DefaultHotkeyIdentity,
	action: SpectraDefaultHotkeyAction,
	gesture: string,
	burstKey: string,
): Promise<void> {
	await runPageGestureBurst(burstKey, async (repeatPulses) => {
		const before = await validateHotkeyDocument(identity, 'Default hotkey');
		const route = await resolveShortcutTargetFromActive(
			{ ...identity.tab, url: before.url },
			'builtin-page',
			{ tabId: identity.tabId, documentId: identity.documentId },
		);
		if (!route) return;
		await executeShortcutRoute(action, route, repeatPulses, gesture);
	});
}

async function runSitePageHotkey(
	identity: DefaultHotkeyIdentity,
	action: SpectraDefaultHotkeyAction,
	gesture: string,
	burstKey: string,
): Promise<void> {
	await runPageGestureBurst(burstKey, async (repeatPulses) => {
		const before = await validateHotkeyDocument(identity, 'Site hotkey');
		const document = { tabId: identity.tabId, documentId: identity.documentId };
		const tab = { ...identity.tab, url: before.url };
		await executeShortcutRoute(action, {
			target: tab,
			active: tab,
			invocation: {
				origin: 'site-page',
				foreground: document,
				target: document,
			},
		}, repeatPulses, gesture);
	});
}

interface ShortcutRoute {
	target: chrome.tabs.Tab;
	active: chrome.tabs.Tab | undefined;
	invocation: ExtensionInvocationContext;
}

async function resolveShortcutTarget(): Promise<ShortcutRoute | undefined> {
	const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
	const active = tabs[0];
	const activeTab = active?.url && /^https?:/u.test(active.url) ? active : undefined;
	const foreground = activeTab ? await resolveShortcutDocument(activeTab) : null;
	return resolveShortcutTargetFromActive(activeTab, 'chrome-command', foreground);
}

async function resolveShortcutTargetFromActive(
	activeTab: chrome.tabs.Tab | undefined,
	origin: 'builtin-page' | 'chrome-command',
	foreground: ExtensionInvocationContext['foreground'],
): Promise<ShortcutRoute | undefined> {
	const { tabId: targetId } = await hotkeyTargetRepository.get();
	if (targetId !== null) {
		try {
			const target = await chrome.tabs.get(targetId);
			if (target.url && /^https?:/u.test(target.url)) {
				const targetDocument = foreground?.tabId === targetId
					? foreground
					: await resolveShortcutDocument(target);
				if (!targetDocument) return undefined;
				return {
					target,
					active: activeTab,
					invocation: { origin, foreground, target: targetDocument },
				};
			}
		} catch {
			await hotkeyTargetRepository.clearIfMatches(targetId);
		}
	}
	if (!activeTab || !foreground) return undefined;
	return {
		target: activeTab,
		active: activeTab,
		invocation: { origin, foreground, target: foreground },
	};
}

async function resolveShortcutDocument(tab: chrome.tabs.Tab): Promise<ExtensionInvocationContext['target'] | null> {
	if (tab.id === undefined) return null;
	const frame = await chrome.webNavigation.getFrame({ tabId: tab.id, frameId: 0 }).catch(() => null);
	return frame?.documentId ? { tabId: tab.id, documentId: frame.documentId } : null;
}

async function executeShortcutRoute(
	action: HotkeyAction,
	route: ShortcutRoute,
	repeatPulses: number,
	feedbackGesture?: string,
): Promise<void> {
	const tab = route.target;
	if (!tab.id || !tab.url) return;
	const tabId = tab.id;
	let domain: string;
	try {
		domain = new URL(tab.url).hostname;
	} catch {
		return;
	}
	const feedback = await runWithShortcutRuntime(
		tabId,
		route.invocation.target.documentId,
		() => executeAction(action, tabId, route.invocation, repeatPulses),
	);
	if (route.active?.id !== undefined) {
		await notifyShortcutFeedback(
			route.active,
			tab,
			action,
			domain,
			feedback,
			feedbackGesture,
			route.invocation.foreground?.documentId,
		);
	}
}

async function notifyShortcutFeedback(
	active: chrome.tabs.Tab,
	target: chrome.tabs.Tab,
	action: HotkeyAction,
	targetHostname: string,
	feedback?: SpectraHotkeyActualFeedback,
	gesture?: string,
	expectedDocumentId?: string,
	runtimePort: ShortcutRuntimePort = shortcutRuntimePort,
): Promise<void> {
	if (active.id === undefined || target.id === undefined) return;
	const capability = `feedback:${crypto.randomUUID()}`;
	let documentId: string | null = null;
	try {
		const initialFrame = await chrome.webNavigation.getFrame({ tabId: active.id, frameId: 0 });
		if (!initialFrame?.documentId
			|| expectedDocumentId && initialFrame.documentId !== expectedDocumentId) return;
		const ready = await runtimePort.ensure(
			active.id,
			expectedDocumentId ?? initialFrame.documentId,
			capability,
		);
		documentId = ready.documentId;
		const currentFrame = await chrome.webNavigation.getFrame({ tabId: active.id, frameId: 0 });
		if (currentFrame?.documentId !== ready.documentId) return;
		const event = createSpectraEvent('spectra.hotkey.target.feedback', {
			action,
			targetTabId: target.id,
			targetTitle: target.title?.trim() || targetHostname,
			targetHostname,
			...(gesture ? { gesture } : {}),
			...(feedback ? { feedback } : {}),
		}, {
			tabId: active.id,
			documentId: ready.documentId,
		});
		await withDeadline(
			chrome.tabs.sendMessage(active.id, event, { documentId: ready.documentId }),
			RPC_DEADLINE_MS.contentRequest,
			'shortcut feedback',
		);
	} catch (error) {
		/* @__PURE__ */ swLog.debug(`Shortcut feedback was unavailable: ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		if (documentId) runtimePort.release(active.id, documentId, capability);
	}
}

async function clearRemovedShortcutTarget(tabId: number): Promise<void> {
	await hotkeyTargetRepository.clearIfMatches(tabId);
}

const FULL_OUTPUT_FIELDS = new Set<ControlMutation['field']>([
	'boost', 'eqValues', 'bass', 'compressor', 'mono', 'pan', 'delay', 'tabMuted', 'tabPinned',
]);
async function submitMutations(
	tabId: number,
	invocation: ExtensionInvocationContext,
	mutations: ControlMutation[],
): Promise<ControlApplyAck | undefined> {
	let acknowledgement: ControlApplyAck | undefined;
	for (const requestedCoverage of ['active-target', 'full'] as const) {
		const selected = mutations.filter((mutation) =>
			FULL_OUTPUT_FIELDS.has(mutation.field) === (requestedCoverage === 'full'));
		if (selected.length === 0) continue;
		const request = {
			tabId,
			source: 'hotkey',
			requestedCoverage,
			target: null,
			mutations: selected,
		} as const;
		acknowledgement = await submitExtensionInvokedControlRequest(request, invocation);
		const failure = Object.values(acknowledgement.fields)
			.find((field) => field?.phase !== 'applied');
		if (failure) throw new Error(failure.lastError?.message ?? 'Shortcut control was not applied');
	}
	return acknowledgement;
}

async function executeAction(
	action: HotkeyAction,
	tabId: number,
	invocation: ExtensionInvocationContext,
	repeatPulses = 1,
): Promise<SpectraHotkeyActualFeedback | undefined> {
	const speedDelta = Math.round(0.1 * repeatPulses * 100) / 100;
	const volumeDelta = Math.min(800, 10 * repeatPulses);
	const operation = async (
			type: Parameters<typeof submitExtensionInvokedControlOperation>[0]['operation'],
			payload: Parameters<typeof submitExtensionInvokedControlOperation>[0]['payload'] = {},
		) => submitExtensionInvokedControlOperation(
			{
				tabId,
				source: 'hotkey',
				target: null,
				operation: type,
				payload,
			} as Parameters<typeof submitExtensionInvokedControlOperation>[0],
			invocation,
		);
	let acknowledgement: ControlApplyAck | ControlOperationAck | undefined;
	switch (action) {
		case 'none':
		case 'pitch_up':
		case 'pitch_down':
		case 'pitch_reset':
		case 'capture_toggle':
		case 'run_js':
		case 'open_url': return;
		case 'play_pause': acknowledgement = await operation('playback-toggle'); break;
		case 'seek_forward_5s': acknowledgement = await operation(HOTKEY_SEEK_RELATIVE, { delta: 5 }); break;
		case 'seek_forward_10s': acknowledgement = await operation(HOTKEY_SEEK_RELATIVE, { delta: 10 }); break;
		case 'seek_forward_30s': acknowledgement = await operation(HOTKEY_SEEK_RELATIVE, { delta: 30 }); break;
		case 'seek_backward_5s': acknowledgement = await operation(HOTKEY_SEEK_RELATIVE, { delta: -5 }); break;
		case 'seek_backward_10s': acknowledgement = await operation(HOTKEY_SEEK_RELATIVE, { delta: -10 }); break;
		case 'seek_backward_30s': acknowledgement = await operation(HOTKEY_SEEK_RELATIVE, { delta: -30 }); break;
		case 'seek_frame_forward': acknowledgement = await operation('frame-step', { direction: 1 }); break;
		case 'seek_frame_backward': acknowledgement = await operation('frame-step', { direction: -1 }); break;
		case 'audio_reset': acknowledgement = await operation('audio-reset'); break;
		case 'screenshot': acknowledgement = await operation('screenshot'); break;
		case 'marker_add': acknowledgement = await operation('marker-add'); break;
		case 'marker_jump_prev': acknowledgement = await operation('marker-jump-previous'); break;
		case 'marker_jump_next': acknowledgement = await operation('marker-jump-next'); break;
		case 'ab_set_a': acknowledgement = await operation('ab-set-a'); break;
		case 'ab_set_b': acknowledgement = await operation('ab-set-b'); break;
		case 'ab_clear': acknowledgement = await operation('ab-clear'); break;
		case 'ab_skip': acknowledgement = await operation('ab-skip'); break;
		case 'fx_toggle': acknowledgement = await operation('video-effects-toggle'); break;
		case 'fx_reset': acknowledgement = await operation('video-effects-reset'); break;
		case 'show_info': acknowledgement = await operation('show-info'); break;
		case 'open_popup': acknowledgement = await operation('open-popup'); break;
		case 'open_options': acknowledgement = await operation('open-options'); break;
		case 'speed_up': acknowledgement = await submitMutations(tabId, invocation, [{ field: 'speed', operation: 'delta', value: speedDelta }]); break;
		case 'speed_down': acknowledgement = await submitMutations(tabId, invocation, [{ field: 'speed', operation: 'delta', value: -speedDelta }]); break;
		case 'speed_reset': acknowledgement = await submitMutations(tabId, invocation, [{ field: 'speed', operation: 'set', value: 1 }]); break;
		case 'speed_set': return;
		case 'volume_up': acknowledgement = await operation(HOTKEY_EFFECTIVE_VOLUME, { operation: 'delta', value: volumeDelta }); break;
		case 'volume_down': acknowledgement = await operation(HOTKEY_EFFECTIVE_VOLUME, { operation: 'delta', value: -volumeDelta }); break;
		case 'volume_mute': acknowledgement = await submitMutations(tabId, invocation, [{ field: 'mediaMuted', operation: 'toggle' }]); break;
		case 'volume_set': return;
		case 'gain_up': acknowledgement = await operation(HOTKEY_EFFECTIVE_VOLUME, { operation: 'delta', value: volumeDelta }); break;
		case 'gain_down': acknowledgement = await operation(HOTKEY_EFFECTIVE_VOLUME, { operation: 'delta', value: -volumeDelta }); break;
		case 'delay_up': acknowledgement = await submitMutations(tabId, invocation, [{ field: 'delay', operation: 'delta', value: 10 }]); break;
		case 'delay_down': acknowledgement = await submitMutations(tabId, invocation, [{ field: 'delay', operation: 'delta', value: -10 }]); break;
		case 'delay_reset': acknowledgement = await submitMutations(tabId, invocation, [{ field: 'delay', operation: 'set', value: 0 }]); break;
		case 'pan_left': acknowledgement = await submitMutations(tabId, invocation, [{ field: 'pan', operation: 'delta', value: -0.1 }]); break;
		case 'pan_right': acknowledgement = await submitMutations(tabId, invocation, [{ field: 'pan', operation: 'delta', value: 0.1 }]); break;
		case 'pan_reset': acknowledgement = await submitMutations(tabId, invocation, [{ field: 'pan', operation: 'set', value: 0 }]); break;
		case 'mono_toggle': acknowledgement = await submitMutations(tabId, invocation, [{ field: 'mono', operation: 'toggle' }]); break;
		case 'fullscreen_toggle': acknowledgement = await submitMutations(tabId, invocation, [{ field: 'fullscreen', operation: 'toggle' }]); break;
		case 'pip_toggle': acknowledgement = await submitMutations(tabId, invocation, [{ field: 'pip', operation: 'toggle' }]); break;
		case 'rotate_cw': acknowledgement = await submitMutations(tabId, invocation, [{ field: 'rotation', operation: 'delta', value: 90 }]); break;
		case 'rotate_ccw': acknowledgement = await submitMutations(tabId, invocation, [{ field: 'rotation', operation: 'delta', value: -90 }]); break;
		case 'mirror_toggle': acknowledgement = await submitMutations(tabId, invocation, [{ field: 'mirrored', operation: 'toggle' }]); break;
		case 'dim_background': acknowledgement = await submitMutations(tabId, invocation, [{ field: 'dimEnabled', operation: 'toggle' }]); break;
		case 'loop_toggle': acknowledgement = await submitMutations(tabId, invocation, [{ field: 'loop', operation: 'toggle' }]); break;
		case 'tab_pin': acknowledgement = await submitMutations(tabId, invocation, [{ field: 'tabPinned', operation: 'toggle' }]); break;
		case 'tab_mute': acknowledgement = await submitMutations(tabId, invocation, [{ field: 'tabMuted', operation: 'toggle' }]); break;
	}
	return resolveSpectraHotkeyActualFeedback(action, acknowledgement);
}

export const shortcutTestApi = {
	defaultHotkeySenderIdentity,
	runDefaultPageHotkey,
	runSitePageHotkey,
	notifyShortcutFeedback,
};

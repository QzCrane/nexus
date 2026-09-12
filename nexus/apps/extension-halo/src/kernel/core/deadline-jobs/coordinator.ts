// goal: one background owner for Timer and Pomodoro deadlines, durable state
// transitions, alarm recovery, and replaceable completion notifications

import { conditionalLedgerWrite, readLedgerEntry } from '../safe-storage';
import {
	moduleInstallationStorageKey,
	readOptionalPackagedModuleEnabled,
} from '../module-installation-runtime';
import {
	INITIAL_TIMER_STATE,
	TIMER_STORAGE_KEY,
	applyTimerCommand,
	normalizeTimerState,
	reconcileTimerDeadline,
	timerDeadline,
} from '../../../tools/timer/core';
import type { TimerState } from '../../../tools/timer/types';
import {
	POMODORO_CONFIG_STORAGE_KEY,
	POMODORO_STATE_STORAGE_KEY,
	applyPomodoroCommand,
	createInitialState,
	normalizePomodoroConfig,
	normalizePomodoroState,
	reconcilePomodoroDeadline,
} from '../../../tools/pomodoro/core';
import { DEFAULT_CONFIG, type PomodoroConfig, type PomodoroState } from '../../../tools/pomodoro/types';
import type { DeadlineCommandMessage, DeadlineCommandResponse, DeadlineJobCommand } from './protocol';

const TIMER_ALARM = 'halo-deadline:timer';
const POMODORO_ALARM = 'halo-deadline:pomodoro';
const POMODORO_MODULE_ID = 'pomodoro';
const POMODORO_MODULE_STORAGE_KEY = moduleInstallationStorageKey(POMODORO_MODULE_ID);
const MAX_WRITE_ATTEMPTS = 4;

function isPomodoroModuleEnabled(): Promise<boolean> {
	return readOptionalPackagedModuleEnabled(POMODORO_MODULE_ID);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDeadlineCommand(value: unknown): value is DeadlineJobCommand {
	if (!isRecord(value) || !isRecord(value.command)) return false;
	if (value.job === 'timer') {
		const type = value.command.type;
		if (type === 'toggle' || type === 'reset' || type === 'lap') return true;
		if (type === 'set-mode') {
			return (value.command.mode === 'countdown' || value.command.mode === 'stopwatch')
				&& Number.isSafeInteger(value.command.target) && (value.command.target as number) >= 0;
		}
		return type === 'set-target' && Number.isSafeInteger(value.command.target)
			&& (value.command.target as number) >= 0;
	}
	if (value.job === 'pomodoro') {
		if (value.command.type === 'toggle') return true;
		if (value.command.type !== 'reset' && value.command.type !== 'skip') return false;
		try {
			normalizePomodoroConfig(value.command.config);
			return true;
		} catch {
			return false;
		}
	}
	return false;
}

function isDeadlineCommandMessage(value: unknown): value is DeadlineCommandMessage {
	return isRecord(value) && value.type === 'HALO_DEADLINE_COMMAND' && isDeadlineCommand(value.payload);
}

function isTrustedSidepanelSender(sender: chrome.runtime.MessageSender): boolean {
	return sender.id === chrome.runtime.id
		&& typeof sender.url === 'string'
		&& sender.url.startsWith(`chrome-extension://${chrome.runtime.id}/`)
		&& !sender.tab;
}

let timerTail: Promise<void> = Promise.resolve();
let pomodoroTail: Promise<void> = Promise.resolve();

function enqueue(job: DeadlineJobCommand['job'], operation: () => Promise<void>): Promise<void> {
	const prior = job === 'timer' ? timerTail : pomodoroTail;
	const next = prior.catch(() => undefined).then(operation);
	if (job === 'timer') timerTail = next;
	else pomodoroTail = next;
	return next;
}

function parseTimer(value: unknown): TimerState {
	try { return normalizeTimerState(value); } catch { return INITIAL_TIMER_STATE; }
}

function parsePomodoroConfig(value: unknown): PomodoroConfig {
	try { return normalizePomodoroConfig(value); } catch { return DEFAULT_CONFIG; }
}

function parsePomodoro(value: unknown, config: PomodoroConfig): PomodoroState {
	try { return normalizePomodoroState(value); } catch { return createInitialState(config); }
}

async function mutateStored<T>(
	key: string,
	parse: (value: unknown) => T,
	mutate: (current: T) => T,
): Promise<T> {
	let base = await readLedgerEntry<T>(key, { area: 'local' });
	for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
		const current = parse(base.value);
		const next = mutate(current);
		if (next === current) return current;
		const outcome = await conditionalLedgerWrite(key, {
			area: 'local',
			baseRevision: base.revision,
			value: next,
			remerge: (stored, remergeAttempt) => {
				if (remergeAttempt >= MAX_WRITE_ATTEMPTS) return null;
				const concurrent = parse(stored);
				const merged = mutate(concurrent);
				return merged === concurrent ? null : merged;
			},
		});
		if (outcome.kind === 'committed') return parse(outcome.value);
		if (outcome.kind === 'external') {
			base = { value: outcome.value as T | undefined, revision: outcome.revision };
			continue;
		}
		throw new Error(`deadline state write ${outcome.kind}`);
	}
	throw new Error('deadline state write conflicted repeatedly');
}

async function scheduleTimer(state: TimerState): Promise<void> {
	const deadline = timerDeadline(state);
	if (deadline === null) {
		await chrome.alarms.clear(TIMER_ALARM);
		return;
	}
	chrome.alarms.create(TIMER_ALARM, { when: deadline });
}

async function schedulePomodoro(state: PomodoroState): Promise<void> {
	if (!state.isRunning || typeof state.endsAt !== 'number') {
		await chrome.alarms.clear(POMODORO_ALARM);
		return;
	}
	chrome.alarms.create(POMODORO_ALARM, { when: state.endsAt });
}

async function markTimerNotificationDelivered(completionId: string): Promise<void> {
	await mutateStored(TIMER_STORAGE_KEY, parseTimer, (state) => {
		if (state.completion?.id !== completionId || state.completion.status !== 'pending') return state;
		return { ...state, completion: { ...state.completion, status: 'delivered' as const } };
	});
}

async function markPomodoroNotificationDelivered(completionId: string): Promise<void> {
	const configEntry = await readLedgerEntry(POMODORO_CONFIG_STORAGE_KEY, { area: 'local' });
	const config = parsePomodoroConfig(configEntry.value);
	await mutateStored(POMODORO_STATE_STORAGE_KEY, (value) => parsePomodoro(value, config), (state) => {
		if (state.completion?.id !== completionId || state.completion.status !== 'pending') return state;
		return { ...state, completion: { ...state.completion, status: 'delivered' as const } };
	});
}

async function deliverTimerNotification(state: TimerState): Promise<void> {
	if (state.completion?.status !== 'pending') return;
	await chrome.notifications.create(state.completion.id, {
		type: 'basic', iconUrl: 'icon128.png', title: 'HALO Timer', message: 'Countdown complete.',
	});
	await markTimerNotificationDelivered(state.completion.id);
}

async function deliverPomodoroNotification(state: PomodoroState): Promise<void> {
	if (state.completion?.status !== 'pending') return;
	await chrome.notifications.create(state.completion.id, {
		type: 'basic', iconUrl: 'icon128.png', title: 'HALO Pomodoro', message: 'Pomodoro phase complete.',
	});
	await markPomodoroNotificationDelivered(state.completion.id);
}

async function settleJobEffects(...effects: Promise<void>[]): Promise<void> {
	const outcomes = await Promise.allSettled(effects);
	const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
	if (failures.length > 0) throw new AggregateError(failures.map((failure) => failure.reason), 'deadline side effect failed');
}

async function reconcileTimer(now = Date.now()): Promise<void> {
	const state = await mutateStored(TIMER_STORAGE_KEY, parseTimer, (current) => reconcileTimerDeadline(current, now));
	await settleJobEffects(scheduleTimer(state), deliverTimerNotification(state));
}

async function reconcilePomodoro(now = Date.now()): Promise<void> {
	// The optional Pomodoro packaged module fails closed when uninstalled: no
	// deadline alarm, no notification, and the persisted phase stays frozen
	// until a later enable event reconciles it forward.
	if (!(await isPomodoroModuleEnabled())) {
		await chrome.alarms.clear(POMODORO_ALARM);
		return;
	}
	const configEntry = await readLedgerEntry(POMODORO_CONFIG_STORAGE_KEY, { area: 'local' });
	const config = parsePomodoroConfig(configEntry.value);
	const state = await mutateStored(POMODORO_STATE_STORAGE_KEY, (value) => parsePomodoro(value, config), (current) => reconcilePomodoroDeadline(current, config, now));
	await settleJobEffects(schedulePomodoro(state), deliverPomodoroNotification(state));
}

async function applyCommand(payload: DeadlineJobCommand, now = Date.now()): Promise<void> {
	if (payload.job === 'timer') {
		const state = await mutateStored(TIMER_STORAGE_KEY, parseTimer, (current) => applyTimerCommand(current, payload.command, now));
		await settleJobEffects(scheduleTimer(state), deliverTimerNotification(state));
		return;
	}
	// A disabled optional module never accepts sidepanel commands; the panel
	// itself hides the tool, so this is a fail-closed defense boundary.
	if (!(await isPomodoroModuleEnabled())) {
		throw new Error('pomodoro module is disabled');
	}
	const configEntry = await readLedgerEntry(POMODORO_CONFIG_STORAGE_KEY, { area: 'local' });
	const config = parsePomodoroConfig(configEntry.value);
	const state = await mutateStored(POMODORO_STATE_STORAGE_KEY, (value) => parsePomodoro(value, config), (current) => applyPomodoroCommand(current, payload.command, now));
	await settleJobEffects(schedulePomodoro(state), deliverPomodoroNotification(state));
}

let initialized = false;
export function initDeadlineCoordinator(): void {
	if (initialized) return;
	initialized = true;

	chrome.alarms.onAlarm.addListener((alarm) => {
		if (alarm.name === TIMER_ALARM) void enqueue('timer', () => reconcileTimer()).catch(console.error);
		if (alarm.name === POMODORO_ALARM) void enqueue('pomodoro', () => reconcilePomodoro()).catch(console.error);
	});
	chrome.runtime.onStartup.addListener(() => {
		void enqueue('timer', () => reconcileTimer()).catch(console.error);
		void enqueue('pomodoro', () => reconcilePomodoro()).catch(console.error);
	});
	chrome.runtime.onMessage.addListener((message, sender, sendResponse: (response: DeadlineCommandResponse) => void) => {
		if (!isDeadlineCommandMessage(message)) return false;
		if (!isTrustedSidepanelSender(sender)) {
			sendResponse({ success: false, error: 'untrusted_sender' });
			return false;
		}
		void enqueue(message.payload.job, () => applyCommand(message.payload)).then(
			() => sendResponse({ success: true }),
			(error: unknown) => sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) }),
		);
		return true;
	});

	// A service-worker cold start is itself a recovery signal. Reconciliation is
	// idempotent, so duplicate startup/alarm delivery cannot advance a job twice.
	void enqueue('timer', () => reconcileTimer()).catch(console.error);
	void enqueue('pomodoro', () => reconcilePomodoro()).catch(console.error);

	// Reinstalling the optional Pomodoro module re-arms its deadline runtime from
	// the persisted state machine; uninstalling it clears any pending alarm.
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== 'local' || !changes[POMODORO_MODULE_STORAGE_KEY]) return;
		void enqueue('pomodoro', () => reconcilePomodoro()).catch(console.error);
	});
}

export const deadlineCoordinatorTestApi = {
	isDeadlineCommand,
};

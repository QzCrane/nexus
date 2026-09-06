import { useState, useEffect, useCallback, useRef } from 'react';
import type { ToolId } from '../core/types';
import { safeStorageGet } from '../core/safe-storage';
import { conditionalLedgerWrite, ledgerRevisionKey } from '../core/safe-storage';
import type { LedgerWriteOutcome } from '../core/safe-storage';
import { reportStorageHealth } from '../core/storage-health';
import { subscribeHaloStorageChanges } from '../core/storage-change-bus';

export interface UseToolStateOptions<T = unknown> {
	/** Storage area: 'local' (default) or 'sync' */
	area?: 'local' | 'sync';
	/** Debounce delay for writes (default: 300ms) */
	debounceMs?: number;
	/** Custom storage key override */
	storageKey?: string;
	/** Normalize values at every storage and local-update boundary */
	normalize?: (value: unknown) => T;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function hasOnlyJsonObjectProperties(value: object): boolean {
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') return false;
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !('value' in descriptor)) return false;
	}
	return true;
}

function hasOnlyDenseArrayItems(value: unknown[]): boolean {
	const ownKeys = Reflect.ownKeys(value);
	if (ownKeys.length !== value.length + 1 || !ownKeys.includes('length')) {
		return false;
	}
	for (let index = 0; index < value.length; index++) {
		const key = String(index);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !('value' in descriptor)) return false;
	}
	return true;
}

function isJsonRoundTripStorageValue(
	value: unknown,
	ancestors = new Set<object>(),
): boolean {
	if (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'boolean'
	) {
		return true;
	}
	if (typeof value === 'number') return Number.isFinite(value);
	if (typeof value !== 'object') return false;
	if (ancestors.has(value)) return false;

	ancestors.add(value);
	let valid = false;
	if (Array.isArray(value)) {
		valid = hasOnlyDenseArrayItems(value)
			&& value.every((entry) => isJsonRoundTripStorageValue(entry, ancestors));
	} else if (isPlainRecord(value)) {
		valid = hasOnlyJsonObjectProperties(value)
			&& Object.values(value).every(
				(entry) => isJsonRoundTripStorageValue(entry, ancestors),
			);
	}
	ancestors.delete(value);
	return valid;
}

function hasCompatibleStorageKind<T>(
	value: unknown,
	fallback: T,
): value is T {
	if (!isJsonRoundTripStorageValue(value)) return false;
	if (fallback === null) return true;
	if (Array.isArray(fallback)) return Array.isArray(value);
	if (isPlainRecord(fallback)) return isPlainRecord(value);
	return typeof value === typeof fallback;
}

/**
 * Runtime floor for callers whose state is only a primitive or homogeneous
 * JSON container. Rich, polymorphic, or versioned state must provide the
 * `normalize` option so its domain owner validates the complete contract.
 */
export function normalizeUnschematizedToolState<T>(
	value: unknown,
	fallback: T,
): T {
	if (!isJsonRoundTripStorageValue(fallback)) {
		throw new TypeError('useToolState fallback must be JSON-roundtrip-safe');
	}
	return hasCompatibleStorageKind(value, fallback) ? value : fallback;
}

function storageValuesEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (
		typeof left !== 'object' ||
		left === null ||
		typeof right !== 'object' ||
		right === null
	) {
		return false;
	}
	if (Array.isArray(left) || Array.isArray(right)) {
		return Array.isArray(left) &&
			Array.isArray(right) &&
			left.length === right.length &&
			left.every((value, index) => storageValuesEqual(value, right[index]));
	}
	if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	return leftKeys.length === rightKeys.length &&
		leftKeys.every(
			(key) =>
				Object.hasOwn(right, key) &&
				storageValuesEqual(left[key], right[key]),
		);
}

export interface ToolStateWriteRequest<T> {
	readonly epoch: symbol;
	readonly token: number;
	readonly revision: number;
	readonly value: T;
}

export type ToolStateStorageDecision<T> =
	| { readonly kind: 'own-echo' }
	| { readonly kind: 'external'; readonly value: T };

interface ActiveToolStateWrite<T> extends ToolStateWriteRequest<T> {
	echoObserved: boolean;
}

interface OwnWriteEcho<T> {
	readonly token: number;
	readonly value: T;
}

const MAX_RECENT_OWN_WRITE_ECHOES = 4;

/**
 * Mount-scoped admission for setters captured by asynchronous consumers.
 *
 * React StrictMode may stop and restart effects for the same hook instance, so
 * an epoch can reopen. A key/area change creates a different epoch; reopening
 * the new instance can never reactivate callbacks captured from the old one.
 */
export class UseToolStateLifecycleEpoch {
	private accepting = false;

	open(): void {
		this.accepting = true;
	}

	seal(): void {
		this.accepting = false;
	}

	runIfAccepting(action: () => void): boolean {
		if (!this.accepting) return false;
		action();
		return true;
	}
}

/**
 * Per-hook write authority for the raw Chrome storage value ABI.
 *
 * A revision identifies the latest local or external intent. A queued request
 * may begin only while it still matches that authority. An already-started
 * stale write is followed by one replaceable latest-winner repair slot.
 */
export class UseToolStatePendingAuthority<T> {
	private readonly epoch = Symbol('use-tool-state-authority');
	private revision = 0;
	private nextToken = 0;
	private authorityValue: T;
	private pending: ToolStateWriteRequest<T> | null = null;
	private desired: ToolStateWriteRequest<T> | null = null;
	private pendingTimer: ReturnType<typeof setTimeout> | null = null;
	private active: ActiveToolStateWrite<T> | null = null;
	private readonly recentOwnWriteEchoes: OwnWriteEcho<T>[] = [];
	private lastSuccessful: ToolStateWriteRequest<T> | null = null;
	private readonly areEqual: (left: T, right: T) => boolean;
	private readonly cancelTimer: (timer: ReturnType<typeof setTimeout>) => void;

	constructor(
		initialValue: T,
		areEqual?: (left: T, right: T) => boolean,
		cancelTimer: (timer: ReturnType<typeof setTimeout>) => void = (timer) => clearTimeout(timer),
	) {
		this.authorityValue = initialValue;
		this.areEqual = areEqual ??
			((left, right) => storageValuesEqual(left, right));
		this.cancelTimer = cancelTimer;
	}

	get authorityRevision(): number {
		return this.revision;
	}

	acceptLoaded(value: T, requestedRevision: number): boolean {
		if (requestedRevision !== this.revision) return false;
		this.authorityValue = value;
		return true;
	}

	stageLocal(value: T): ToolStateWriteRequest<T> {
		this.cancelPendingTimer();
		this.revision++;
		this.authorityValue = value;
		this.desired = null;
		const request = this.createRequest(value);
		this.pending = request;
		return request;
	}

	attachPendingTimer(
		token: number,
		timer: ReturnType<typeof setTimeout>,
	): void {
		if (this.pending?.token !== token) {
			this.cancelTimer(timer);
			return;
		}
		this.cancelPendingTimer();
		this.pendingTimer = timer;
	}

	flushPending(expectedToken?: number): boolean {
		if (
			!this.pending ||
			(expectedToken !== undefined && this.pending.token !== expectedToken)
		) {
			return false;
		}
		this.cancelPendingTimer();
		this.desired = this.pending;
		this.pending = null;
		return true;
	}

	observeStorage(value: T): ToolStateStorageDecision<T> {
		if (this.active && this.areEqual(this.active.value, value)) {
			this.active.echoObserved = true;
			return { kind: 'own-echo' };
		}
		const recentEchoIndex = this.recentOwnWriteEchoes.findIndex(
			(echo) => this.areEqual(echo.value, value),
		);
		if (recentEchoIndex >= 0) {
			this.recentOwnWriteEchoes.splice(recentEchoIndex, 1);
			return { kind: 'own-echo' };
		}

		this.recentOwnWriteEchoes.length = 0;
		this.cancelPendingTimer();
		this.pending = null;
		this.desired = null;
		this.revision++;
		this.authorityValue = value;
		return { kind: 'external', value };
	}

	beginNextWrite(): ToolStateWriteRequest<T> | null {
		if (this.active) return null;
		const request = this.desired;
		this.desired = null;
		if (
			!request ||
			request.epoch !== this.epoch ||
			request.revision !== this.revision ||
			!this.areEqual(request.value, this.authorityValue) ||
			(
				this.lastSuccessful?.revision === request.revision &&
				this.areEqual(this.lastSuccessful.value, request.value)
			)
		) {
			return null;
		}
		this.active = { ...request, echoObserved: false };
		return request;
	}

	completeWrite(
		succeeded: boolean,
	): void {
		const active = this.active;
		if (!active) return;
		this.active = null;
		if (!succeeded) return;

		if (!active.echoObserved) {
			this.recentOwnWriteEchoes.push({
				token: active.token,
				value: active.value,
			});
			if (this.recentOwnWriteEchoes.length > MAX_RECENT_OWN_WRITE_ECHOES) {
				this.recentOwnWriteEchoes.shift();
			}
		}

		if (
			active.revision === this.revision &&
			this.areEqual(active.value, this.authorityValue)
		) {
			this.lastSuccessful = active;
			return;
		}
		if (
			(
				this.pending?.revision === this.revision &&
				this.areEqual(this.pending.value, this.authorityValue)
			) ||
			(
				this.desired?.revision === this.revision &&
				this.areEqual(this.desired.value, this.authorityValue)
			)
		) {
			return;
		}
		this.desired = this.createRequest(this.authorityValue);
	}

	private createRequest(value: T): ToolStateWriteRequest<T> {
		return {
			epoch: this.epoch,
			token: ++this.nextToken,
			revision: this.revision,
			value,
		};
	}

	private cancelPendingTimer(): void {
		if (this.pendingTimer === null) return;
		this.cancelTimer(this.pendingTimer);
		this.pendingTimer = null;
	}
}

/**
 * goal: Standardized tool state persistence with performance optimization
 * features: 
 *   1. Auto-loading from chrome.storage
 *   2. Debounced writes to prevent storage bottlenecks
 *   3. Global sync across multiple sidepanels
 *   4. Configurable storage area (sync/local)
 */
export function useToolState<T>(
	toolId: ToolId | string,
	initialState: T | (() => T),
	options: UseToolStateOptions<T> = {}
) {
	const {
		area = 'local',
		debounceMs = 300,
		storageKey: customKey,
		normalize,
	} = options;

	const getInitialValue = useCallback(() => {
		return typeof initialState === 'function' ? (initialState as () => T)() : initialState;
	}, [initialState]);
	const normalizeValue = useCallback((value: unknown, fallback: T): T => {
		if (!normalize) return normalizeUnschematizedToolState(value, fallback);
		const normalized = normalize(value);
		return isJsonRoundTripStorageValue(normalized)
			? normalized
			: normalizeUnschematizedToolState(fallback, fallback);
	}, [normalize]);

	const [state, setState] = useState<T>(() => {
		const initialValue = getInitialValue();
		return normalizeValue(initialValue, initialValue);
	});
	const [isReady, setIsReady] = useState(false);
	const stateRef = useRef(state);
	const storageKey = customKey ?? `halo_tool_state_${toolId}`;
	const baseRevisionRef = useRef(0);
	const authorityIdentity = `${area}\u0000${storageKey}`;
	const pendingAuthorityRef = useRef<{
		identity: string;
		controller: UseToolStatePendingAuthority<T>;
		lifecycle: UseToolStateLifecycleEpoch;
		hydrated: boolean;
		healthOwner: symbol;
	} | null>(null);
	if (pendingAuthorityRef.current?.identity !== authorityIdentity) {
		pendingAuthorityRef.current = {
			identity: authorityIdentity,
			controller: new UseToolStatePendingAuthority(stateRef.current),
			lifecycle: new UseToolStateLifecycleEpoch(),
			hydrated: false,
			healthOwner: Symbol("tool-state-storage-health"),
		};
	}
	const authorityEpoch = pendingAuthorityRef.current;
	const pendingAuthority = authorityEpoch.controller;

	const initialValueRef = useRef(getInitialValue);
	useEffect(() => { initialValueRef.current = getInitialValue; }, [getInitialValue]);
	const normalizeValueRef = useRef(normalizeValue);
	useEffect(() => { normalizeValueRef.current = normalizeValue; }, [normalizeValue]);

	const persistNextState = useCallback(function persistNextForEpoch(): void {
		if (!authorityEpoch.hydrated) return;
		const request = pendingAuthority.beginNextWrite();
		if (!request) return;
		void (async () => {
			let outcome: LedgerWriteOutcome;
			try {
				outcome = await conditionalLedgerWrite(storageKey, {
					area,
					baseRevision: baseRevisionRef.current,
					value: request.value,
					remerge: (_current, attempt) => {
						// Concede to the stored value unless a newer local edit exists;
						// then revalidate against the fresh revision with that intent.
						if (attempt >= 2 || storageValuesEqual(stateRef.current, request.value)) return null;
						try { return normalizeValueRef.current(stateRef.current, request.value); }
						catch { return null; }
					},
				});
			} catch {
				outcome = { kind: 'rejected' };
			}
			if (outcome.kind === 'committed') {
				baseRevisionRef.current = outcome.revision;
				authorityEpoch.lifecycle.runIfAccepting(() => reportStorageHealth(authorityEpoch.healthOwner, null));
			} else if (outcome.kind === 'external') {
				baseRevisionRef.current = outcome.revision;
				authorityEpoch.lifecycle.runIfAccepting(() => reportStorageHealth(authorityEpoch.healthOwner, null));
				let stored: T | null = null;
				try { stored = normalizeValueRef.current(outcome.value, stateRef.current); }
				catch { stored = null; }
				if (stored !== null) {
					const decision = pendingAuthority.observeStorage(stored);
					if (decision.kind === 'external') {
						stateRef.current = decision.value;
						setState(decision.value);
					}
				}
			} else if (outcome.kind === 'unknown') {
				authorityEpoch.lifecycle.runIfAccepting(() => reportStorageHealth(authorityEpoch.healthOwner, 'write-unknown'));
			}
			// Keep this authority busy until actual completion, including after
			// an observation timeout. A timeout cannot authorize an overlapping write.
			pendingAuthority.completeWrite(outcome.kind === 'committed');
			if (outcome.kind === 'rejected') {
				authorityEpoch.lifecycle.runIfAccepting(() => reportStorageHealth(
					authorityEpoch.healthOwner, 'write-error', () => {
						const retry = pendingAuthority.stageLocal(stateRef.current);
						pendingAuthority.flushPending(retry.token);
						persistNextForEpoch();
					},
				));
			}
			persistNextForEpoch();
		})();
	}, [storageKey, area, authorityEpoch, pendingAuthority]);

	const [loadAttempt, setLoadAttempt] = useState(0);
	useEffect(() => {
		let isMounted = true;
		const requestedRevision = 0;
		const initialValue = initialValueRef.current();
		const baseValue = normalizeValueRef.current(initialValue, initialValue);
		authorityEpoch.hydrated = false;
		setIsReady(false);
		void safeStorageGet([storageKey, ledgerRevisionKey(storageKey)], { [storageKey]: baseValue }, { area })
			.then((res) => {
				if (!isMounted) return;
				const loaded = normalizeValueRef.current(res[storageKey] !== undefined ? res[storageKey] : baseValue, baseValue);
				baseRevisionRef.current = typeof res[ledgerRevisionKey(storageKey)] === 'number'
					&& Number.isSafeInteger(res[ledgerRevisionKey(storageKey)])
					&& (res[ledgerRevisionKey(storageKey)] as number) >= 0
					? (res[ledgerRevisionKey(storageKey)] as number)
					: 0;
				authorityEpoch.hydrated = true;
				setIsReady(true);
				reportStorageHealth(authorityEpoch.healthOwner, null);
				if (pendingAuthority.acceptLoaded(loaded, requestedRevision)) {
					stateRef.current = loaded;
					setState(loaded);
				}
				persistNextState();
			})
			.catch(() => {
				if (!isMounted) return;
				// Never convert a failed read into an empty initialized record.
				reportStorageHealth(authorityEpoch.healthOwner, 'read-error', () => setLoadAttempt(loadAttempt + 1));
			});
		return () => { isMounted = false; };
	}, [storageKey, area, pendingAuthority, authorityEpoch, persistNextState, loadAttempt]);

	const flushPendingState = useCallback((expectedToken?: number) => {
		if (pendingAuthority.flushPending(expectedToken)) persistNextState();
	}, [pendingAuthority, persistNextState]);

	const saveState = useCallback((newState: T) => {
		authorityEpoch.lifecycle.runIfAccepting(() => {
			const request = pendingAuthority.stageLocal(newState);
			if (debounceMs <= 0) {
				flushPendingState(request.token);
				return;
			}
			const timer = setTimeout(
				() => flushPendingState(request.token),
				debounceMs,
			);
			pendingAuthority.attachPendingTimer(request.token, timer);
		});
	}, [authorityEpoch, debounceMs, flushPendingState, pendingAuthority]);

	const updateState = useCallback((action: React.SetStateAction<T>) => {
		authorityEpoch.lifecycle.runIfAccepting(() => {
			const previous = stateRef.current;
			const candidate = typeof action === 'function'
				? (action as (prev: T) => T)(previous)
				: action;
			let next: T;
			try { next = normalizeValueRef.current(candidate, previous); }
			catch {
				reportStorageHealth(authorityEpoch.healthOwner, 'write-error');
				return;
			}
			stateRef.current = next;
			setState(next);
			saveState(next);
		});
	}, [authorityEpoch, saveState]);

	useEffect(() => {
		authorityEpoch.lifecycle.open();
		const unsubscribeStorageChanges = subscribeHaloStorageChanges((
			changes: Record<string, chrome.storage.StorageChange>,
			changedArea: string,
		) => {
			const change = changes[storageKey];
			if (changedArea !== area || !change) return;
			let next: T;
			try { next = normalizeValueRef.current(change.newValue, stateRef.current); }
			catch {
				reportStorageHealth(authorityEpoch.healthOwner, 'read-error');
				return;
			}
			const decision = pendingAuthority.observeStorage(next);
			if (decision.kind === 'external') {
				stateRef.current = decision.value;
				setState(decision.value);
			}
		});
		return () => {
			authorityEpoch.lifecycle.seal();
			unsubscribeStorageChanges();
			reportStorageHealth(authorityEpoch.healthOwner, null);
			flushPendingState();
		};
	}, [storageKey, area, authorityEpoch, pendingAuthority, flushPendingState]);

	return [state, updateState, isReady] as const;
}

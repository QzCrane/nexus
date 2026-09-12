// goal: centralized in-memory state management for the Background Service Worker lifecycle

import { StorageRepository } from '@nexus/kernel';
import { UI_COLORS } from '../shared/ui-colors';

export interface BadgeInfo {
	volume: number;
	muted: boolean;
	enabled: boolean;
	isCapture: boolean;
	userInteracted: boolean;
	authority: 'control' | 'session';
	text: string;
	documentId: string | null;
	origin: string | null;
	generation: number | null;
}

export const BADGE_COLORS = UI_COLORS;

export const storage = new StorageRepository();

// tabId -> isCaptureActive
export const captureStates = new Map<number, boolean>();

// tabId -> BadgeInfo
export const badgeState = new Map<number, BadgeInfo>();

// goal: tracks bounded media/audio eligibility for Popup prioritization
export interface TabAudioState {
	hasMediaElement: boolean;
	documentId: string;
	reportRevision: number;
	// lastAudibleTime: timestamp when the tab last produced sound
	lastAudibleTime: number;
	// lastActivatedTime is meaningful only after a media/audio state exists. A
	// generic browser tab activation must never create a synthetic media lease.
	lastActivatedTime: number;
	isAudible: boolean;
}

// currentSessionId: unique identifier for the current service worker execution context
export const currentSessionId = Date.now();

// tabId -> TabAudioState
export const tabAudioStates = new Map<number, TabAudioState>();
const tabDocumentGenerations = new Map<number, number>();

export function tabDocumentGeneration(tabId: number): number {
	return tabDocumentGenerations.get(tabId) ?? 0;
}

export function advanceTabDocumentGeneration(tabId: number): number {
	const next = tabDocumentGeneration(tabId) + 1;
	tabDocumentGenerations.set(tabId, next);
	return next;
}

export function forgetTabDocumentGeneration(tabId: number): void {
	tabDocumentGenerations.delete(tabId);
}

export function getOrCreateTabAudioState(tabId: number, documentId = 'browser-audible'): TabAudioState {
	const existing = tabAudioStates.get(tabId);
	if (existing?.documentId === documentId) return existing;
	const state: TabAudioState = {
		hasMediaElement: false,
		documentId,
		reportRevision: 0,
		lastAudibleTime: existing?.lastAudibleTime ?? 0,
		lastActivatedTime: existing?.lastActivatedTime ?? 0,
		isAudible: existing?.isAudible ?? false,
	};
	tabAudioStates.set(tabId, state);
	return state;
}

export function markTabActivated(tabId: number, now = Date.now()): void {
	// Activation is only a bounded grace signal for an already known media/audio
	// tab. Worker restart or first discovery reconstructs unknown media via the
	// exact-document probe rather than by treating every active browser tab as media.
	const state = tabAudioStates.get(tabId);
	if (!state) return;
	state.lastActivatedTime = now;
}

export function markTabAudible(tabId: number, audible: boolean, now = Date.now()): void {
	const existing = tabAudioStates.get(tabId);
	// Chrome can report `audible: false` for a tab that never produced sound.
	// Do not let that create a synthetic recent-audio lease.
	if (!audible && !existing?.isAudible) return;
	const state = existing ?? getOrCreateTabAudioState(tabId);
	state.isAudible = audible;
	state.lastAudibleTime = now;
}

export function retireTabMediaDocument(tabId: number): void {
	tabAudioStates.delete(tabId);
}

// TAB_VISIBLE_THRESHOLD_MS: cutoff for bounded media/audio grace after activity
export const TAB_VISIBLE_THRESHOLD_MS = 60 * 1000;

// eff: clears all volatile in-memory state associated with a tabId
export function cleanupTabState(
	tabId: number,
	options: { preserveCapture?: boolean; preserveMedia?: boolean } = {},
): void {
	if (!options.preserveCapture) captureStates.delete(tabId);
	badgeState.delete(tabId);
	if (!options.preserveMedia) tabAudioStates.delete(tabId);
}

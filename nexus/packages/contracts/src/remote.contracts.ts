// goal: extension-internal UI/background boundary for authenticated remote sessions

import type { ControlCapability } from './control.contracts.js';
import { compileEffectiveVolume, isFiniteControlValue } from './control-value-limits.js';
import type {
	AudioSessionPhase,
	AudioVolumeState,
	SpectraAudioMode,
} from './audio.contracts.js';

export const REMOTE_PROTOCOL_VERSION = 3 as const;

export interface RemotePublicSession {
	protocolVersion: typeof REMOTE_PROTOCOL_VERSION;
	sessionId: string;
	peerId: string;
	secret: string;
	createdAt: number;
	pairingExpiresAt: number;
	tabId: number;
	connected: boolean;
}

/**
 * A session as the UI may read it back. Identical to {@link RemotePublicSession}
 * except that the pairing secret is absent.
 *
 * The secret is bearer authority: anyone holding it can pair a new device to
 * this tab. Exactly one place may hand it out — the `create` response, whose
 * caller has just minted the session and needs the QR payload. Every read path
 * uses this view instead, so a status query can never become a second way to
 * obtain pairing authority (SP-30).
 */
export interface RemoteSessionView {
	protocolVersion: typeof REMOTE_PROTOCOL_VERSION;
	sessionId: string;
	peerId: string;
	createdAt: number;
	pairingExpiresAt: number;
	tabId: number;
	connected: boolean;
}

export interface RemoteSessionStatus {
	session: RemoteSessionView | null;
	connected: boolean;
}

export interface RemoteSessionChangedEvent {
	tabId: number;
	sessionId: string;
	connected: boolean;
}

export interface RemoteSessionClosedEvent {
	tabId: number;
	sessionId: string;
}

export const REMOTE_COMMANDS = [
	'volume_up',
	'volume_down',
	'volume_max',
	'volume_100',
	'mute',
	'play_pause',
	'seek_forward',
	'seek_backward',
	'seek_forward_30',
	'seek_backward_30',
	'speed_up',
	'speed_down',
	'speed_reset',
] as const;

export type RemoteCommand = (typeof REMOTE_COMMANDS)[number];

/**
 * Bounded replay/deduplication memory for one authenticated Remote epoch.
 * The Offscreen authority and Background admission ledger intentionally use
 * the same window so a long-lived session cannot grow either owner without
 * limit.
 */
export const REMOTE_COMMAND_RECEIPT_LIMIT = 512;

/** Maximum number of authenticated Remote commands admitted but not settled. */
export const REMOTE_COMMAND_PENDING_LIMIT = 32;

/**
 * A command must leave the Background admission queue within this window. The
 * physical control owner may finish a non-cancellable browser operation later,
 * but its late result is fenced by the command ticket and cannot publish as a
 * Remote success.
 */
export const REMOTE_COMMAND_TIMEOUT_MS = 15_000;

/** Maximum number of pre-authentication data channels retained by one host. */
export const REMOTE_PENDING_CONNECTION_LIMIT = 8;

/** Maximum number of pairings retained by the standalone Remote page. */
export const REMOTE_PAIRING_LIMIT = 16;

/** UTF-8 storage budget for the standalone Remote page's pairing ledger. */
export const REMOTE_PAIRING_STORAGE_LIMIT_BYTES = 64 * 1024;

export type RemoteCommandOperation = 'delta' | 'set' | 'toggle';

export interface RemoteCommandDescriptor {
	capability: ControlCapability;
	operation: RemoteCommandOperation;
	value?: number;
}

const remoteDescriptor = (
	capability: ControlCapability,
	operation: RemoteCommandOperation,
	value?: number,
): RemoteCommandDescriptor => value === undefined
	? { capability, operation }
	: { capability, operation, value };

// Remote buttons are surface aliases, never independent algorithms. This
// exhaustive map fixes their canonical capability and transform so handler,
// phone UI and tests cannot silently diverge on steps or volume/Boost meaning.
export const REMOTE_COMMAND_DESCRIPTORS = {
	volume_up: remoteDescriptor('effective-volume', 'delta', 10),
	volume_down: remoteDescriptor('effective-volume', 'delta', -10),
	volume_max: remoteDescriptor('effective-volume', 'set', 800),
	volume_100: remoteDescriptor('effective-volume', 'set', 100),
	mute: remoteDescriptor('mediaMuted', 'toggle'),
	play_pause: remoteDescriptor('playback-toggle', 'toggle'),
	seek_forward: remoteDescriptor('seek-relative', 'delta', 10),
	seek_backward: remoteDescriptor('seek-relative', 'delta', -10),
	seek_forward_30: remoteDescriptor('seek-relative', 'delta', 30),
	seek_backward_30: remoteDescriptor('seek-relative', 'delta', -30),
	speed_up: remoteDescriptor('speed', 'delta', 0.25),
	speed_down: remoteDescriptor('speed', 'delta', -0.25),
	speed_reset: remoteDescriptor('speed', 'set', 1),
} as const satisfies Record<RemoteCommand, RemoteCommandDescriptor>;

export interface RemoteState {
	generation: number;
	/** Monotonic control snapshot revision within the current generation. */
	revision: number;
	/** Effective volume used directly by the Remote presentation. */
	volume: number;
	volumeBase: number;
	boost: number;
	actualMode: SpectraAudioMode;
	phase: AudioSessionPhase;
	/** Canonical color/state projection derived from acknowledged processor state. */
	volumeState: AudioVolumeState;
	muted: boolean;
	playing: boolean;
	speed: number;
	tabTitle?: string;
	tabDomain?: string;
}

const REMOTE_PUBLIC_SESSION_KEYS = new Set<keyof RemotePublicSession>([
	'protocolVersion',
	'sessionId',
	'peerId',
	'secret',
	'createdAt',
	'pairingExpiresAt',
	'tabId',
	'connected',
]);
const REMOTE_SESSION_VIEW_KEYS = new Set<keyof RemoteSessionView>([
	'protocolVersion',
	'sessionId',
	'peerId',
	'createdAt',
	'pairingExpiresAt',
	'tabId',
	'connected',
]);
const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/u;
const PEER_ID_RE = /^spectra-[a-f0-9]{32}$/u;
const remoteCommandSet: ReadonlySet<string> = new Set(REMOTE_COMMANDS);

export function isRemotePeerId(value: unknown): value is string {
	return typeof value === 'string' && PEER_ID_RE.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The identity fields both session shapes share, checked once. */
function isSessionIdentity(value: Record<string, unknown>): boolean {
	return value.protocolVersion === REMOTE_PROTOCOL_VERSION
		&& typeof value.sessionId === 'string'
		&& TOKEN_RE.test(value.sessionId)
		&& isRemotePeerId(value.peerId)
		&& typeof value.createdAt === 'number'
		&& Number.isSafeInteger(value.createdAt)
		&& value.createdAt >= 0
		&& typeof value.pairingExpiresAt === 'number'
		&& Number.isSafeInteger(value.pairingExpiresAt)
		&& value.pairingExpiresAt > value.createdAt
		&& typeof value.tabId === 'number'
		&& Number.isInteger(value.tabId)
		&& value.tabId > 0
		&& typeof value.connected === 'boolean';
}

export function isRemoteSessionView(value: unknown): value is RemoteSessionView {
	if (!isRecord(value)
		|| !Object.keys(value).every((key) => REMOTE_SESSION_VIEW_KEYS.has(key as keyof RemoteSessionView))) {
		return false;
	}
	return isSessionIdentity(value);
}

export function isRemotePublicSession(value: unknown): value is RemotePublicSession {
	if (!isRecord(value) || !Object.keys(value).every((key) => REMOTE_PUBLIC_SESSION_KEYS.has(key as keyof RemotePublicSession))) {
		return false;
	}
	return isSessionIdentity(value)
		&& typeof value.secret === 'string'
		&& TOKEN_RE.test(value.secret);
}

export function isRemoteSessionToken(value: unknown): value is string {
	return typeof value === 'string' && TOKEN_RE.test(value);
}

/**
 * A session epoch is minted by the offscreen Remote authority after every
 * successful authentication. It is deliberately separate from the pairing
 * identity and is monotonic for the lifetime of the authority.
 */
export function isRemoteSessionEpoch(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

/** Command ids are opaque, one-shot receipts generated by the controller. */
export function isRemoteCommandId(value: unknown): value is string {
	return isRemoteSessionToken(value);
}

export function isRemoteCommand(value: unknown): value is RemoteCommand {
	return typeof value === 'string' && remoteCommandSet.has(value);
}

export function isRemoteState(value: unknown): value is RemoteState {
	if (!isRecord(value)) return false;
	const keys = Object.keys(value);
	if (!keys.every((key) => [
		'generation',
		'revision',
		'volume',
		'volumeBase',
		'boost',
		'actualMode',
		'phase',
		'volumeState',
		'muted',
		'playing',
		'speed',
		'tabTitle',
		'tabDomain',
	].includes(key))) return false;
	return Number.isSafeInteger(value.generation)
		&& (value.generation as number) >= 0
		&& Number.isSafeInteger(value.revision)
		&& (value.revision as number) >= 0
		&& isFiniteControlValue(value.volume, 'volume')
		&& isFiniteControlValue(value.volumeBase, 'volumeBase')
		&& isFiniteControlValue(value.boost, 'boost')
		&& value.volume === compileEffectiveVolume(value.volumeBase, value.boost)
		&& (value.actualMode === 'bypass' || value.actualMode === 'webaudio'
			|| value.actualMode === 'capture')
		&& (value.phase === 'idle' || value.phase === 'starting' || value.phase === 'active'
			|| value.phase === 'stopping' || value.phase === 'error')
		&& (value.volumeState === 'silent'
			|| value.volumeState === 'native' || value.volumeState === 'capture')
		&& typeof value.muted === 'boolean'
		&& typeof value.playing === 'boolean'
		&& isFiniteControlValue(value.speed, 'speed')
		&& (value.tabTitle === undefined
			|| (typeof value.tabTitle === 'string' && value.tabTitle.length <= 512))
		&& (value.tabDomain === undefined
			|| (typeof value.tabDomain === 'string' && value.tabDomain.length <= 253));
}

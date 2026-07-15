// goal: extension-internal UI/background boundary for authenticated remote sessions

export interface RemotePublicSession {
	protocolVersion: 2;
	sessionId: string;
	peerId: string;
	secret: string;
	createdAt: number;
	pairingExpiresAt: number;
	tabId: number;
	connected: boolean;
}

export interface RemoteSessionStatus {
	session: RemotePublicSession | null;
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
	'fullscreen',
	'pip',
] as const;

export type RemoteCommand = (typeof REMOTE_COMMANDS)[number];

export interface RemoteState {
	generation: number;
	volume: number;
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
const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/u;
const remoteCommandSet: ReadonlySet<string> = new Set(REMOTE_COMMANDS);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isRemotePublicSession(value: unknown): value is RemotePublicSession {
	if (!isRecord(value) || !Object.keys(value).every((key) => REMOTE_PUBLIC_SESSION_KEYS.has(key as keyof RemotePublicSession))) {
		return false;
	}
	return value.protocolVersion === 2
		&& typeof value.sessionId === 'string'
		&& TOKEN_RE.test(value.sessionId)
		&& typeof value.peerId === 'string'
		&& /^spectra-[a-f0-9]{32}$/u.test(value.peerId)
		&& typeof value.secret === 'string'
		&& TOKEN_RE.test(value.secret)
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

export function isRemoteSessionToken(value: unknown): value is string {
	return typeof value === 'string' && TOKEN_RE.test(value);
}

export function isRemoteCommand(value: unknown): value is RemoteCommand {
	return typeof value === 'string' && remoteCommandSet.has(value);
}

export function isRemoteState(value: unknown): value is RemoteState {
	if (!isRecord(value)) return false;
	const keys = Object.keys(value);
	if (!keys.every((key) => [
		'generation',
		'volume',
		'muted',
		'playing',
		'speed',
		'tabTitle',
		'tabDomain',
	].includes(key))) return false;
	return Number.isSafeInteger(value.generation)
		&& (value.generation as number) >= 0
		&& isFiniteInRange(value.volume, 0, 800)
		&& typeof value.muted === 'boolean'
		&& typeof value.playing === 'boolean'
		&& isFiniteInRange(value.speed, 0.1, 16)
		&& (value.tabTitle === undefined
			|| (typeof value.tabTitle === 'string' && value.tabTitle.length <= 512))
		&& (value.tabDomain === undefined
			|| (typeof value.tabDomain === 'string' && value.tabDomain.length <= 253));
}

function isFiniteInRange(value: unknown, minimum: number, maximum: number): value is number {
	return typeof value === 'number'
		&& Number.isFinite(value)
		&& value >= minimum
		&& value <= maximum;
}

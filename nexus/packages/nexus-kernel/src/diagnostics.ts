// goal: one privacy-bounded local diagnostic contract for NEXUS browser products
// inv: callers supply static event/owner tokens, never user-derived values; the bundle omits browser URLs and storage payloads

export type DiagnosticProduct = 'SPECTRA' | 'HALO';
export type DiagnosticLevel = 'info' | 'warn' | 'error';
export type DiagnosticScalar = boolean | number | null;
export type DiagnosticOwnerSummary = Readonly<Record<string, DiagnosticScalar>>;

export interface DiagnosticEvent {
	readonly sequence: number;
	readonly timestamp: number;
	readonly level: DiagnosticLevel;
	readonly scope: string;
	readonly code: string;
}

export interface LocalDiagnosticBundle {
	readonly schemaVersion: 1;
	readonly product: DiagnosticProduct;
	readonly generatedAt: string;
	readonly manifestVersion: string;
	readonly browser: {
		readonly userAgentFamily: 'Chromium';
		readonly major: number | null;
	};
	readonly permissions: readonly string[];
	readonly origins: {
		readonly grantCount: number;
		readonly broadGrant: boolean;
	};
	readonly contexts: Readonly<Record<string, number>>;
	readonly owners: DiagnosticOwnerSummary;
	readonly recentEvents: readonly DiagnosticEvent[];
}

export interface DiagnosticEventBuffer {
	record(level: DiagnosticLevel, scope: string, code: string, timestamp?: number): void;
	read(): readonly DiagnosticEvent[];
	clear(): void;
}

export interface LocalDiagnosticRawFacts {
	readonly manifestVersion: string;
	readonly userAgent: string;
	readonly permissions: readonly string[];
	readonly origins: readonly string[];
	readonly contextTypes: readonly string[];
}

const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/u;
const SAFE_PERMISSION = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/u;
const MAX_EVENTS = 64;
const DIAGNOSTIC_PORT = 'nexus.local-diagnostics.v1';
const BROAD_ORIGINS = new Set(['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*']);

function safeToken(value: string, field: string): string {
	if (!SAFE_TOKEN.test(value)) throw new Error(`diagnostic ${field} must be a bounded non-PII token`);
	return value;
}

function browserMajor(userAgent: string): number | null {
	const match = /(?:Chrome|Chromium)\/([0-9]+)/u.exec(userAgent);
	if (!match?.[1]) return null;
	const value = Number.parseInt(match[1], 10);
	return Number.isSafeInteger(value) ? value : null;
}

function validateOwnerSummary(value: DiagnosticOwnerSummary): DiagnosticOwnerSummary {
	const result: Record<string, DiagnosticScalar> = {};
	for (const [key, entry] of Object.entries(value)) {
		safeToken(key, 'owner key');
		if (entry !== null && typeof entry !== 'boolean' && (typeof entry !== 'number' || !Number.isFinite(entry))) {
			throw new Error(`diagnostic owner ${key} must be boolean, finite number or null`);
		}
		result[key] = entry;
	}
	return Object.freeze(result);
}

export function createDiagnosticEventBuffer(maxEvents = MAX_EVENTS): DiagnosticEventBuffer {
	if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > MAX_EVENTS) {
		throw new Error(`diagnostic maxEvents must be 1..${MAX_EVENTS}`);
	}
	let sequence = 0;
	let events: DiagnosticEvent[] = [];
	return {
		record(level, scope, code, timestamp = Date.now()) {
			if (level !== 'info' && level !== 'warn' && level !== 'error') {
				throw new Error(`unsupported diagnostic level: ${String(level)}`);
			}
			if (!Number.isFinite(timestamp) || timestamp < 0) throw new Error('diagnostic timestamp must be finite and non-negative');
			const event = Object.freeze({
				sequence: ++sequence,
				timestamp,
				level,
				scope: safeToken(scope, 'scope'),
				code: safeToken(code, 'code'),
			});
			events = [...events, event].slice(-maxEvents);
		},
		read() {
			return Object.freeze([...events]);
		},
		clear() {
			events = [];
		},
	};
}

export function assembleLocalDiagnosticBundle({
	product,
	facts,
	owners,
	events,
	generatedAt,
}: {
	product: DiagnosticProduct;
	facts: LocalDiagnosticRawFacts;
	owners: DiagnosticOwnerSummary;
	events: readonly DiagnosticEvent[];
	generatedAt: string;
}): LocalDiagnosticBundle {
	if (product !== 'SPECTRA' && product !== 'HALO') throw new Error('unsupported diagnostic product');
	if (!/^\d+\.\d+\.\d+$/u.test(facts.manifestVersion)) throw new Error('diagnostic manifest version must be SemVer');
	const permissions = [...new Set(facts.permissions.filter((permission) => SAFE_PERMISSION.test(permission)))].sort();
	const contextCounts: Record<string, number> = {};
	for (const contextType of facts.contextTypes) {
		if (!SAFE_TOKEN.test(contextType)) continue;
		contextCounts[contextType] = (contextCounts[contextType] ?? 0) + 1;
	}
	const safeEvents = events.slice(-MAX_EVENTS).map((event) => Object.freeze({
		sequence: event.sequence,
		timestamp: event.timestamp,
		level: event.level,
		scope: safeToken(event.scope, 'scope'),
		code: safeToken(event.code, 'code'),
	}));
	return Object.freeze({
		schemaVersion: 1,
		product,
		generatedAt,
		manifestVersion: facts.manifestVersion,
		browser: Object.freeze({
			userAgentFamily: 'Chromium' as const,
			major: browserMajor(facts.userAgent),
		}),
		permissions: Object.freeze(permissions),
		origins: Object.freeze({
			grantCount: facts.origins.length,
			broadGrant: facts.origins.some((origin) => BROAD_ORIGINS.has(origin)),
		}),
		contexts: Object.freeze(Object.fromEntries(
			Object.entries(contextCounts).sort(([left], [right]) => left.localeCompare(right)),
		)),
		owners: validateOwnerSummary(owners),
		recentEvents: Object.freeze(safeEvents),
	});
}

async function collectBrowserFacts(): Promise<LocalDiagnosticRawFacts> {
	const grants = await chrome.permissions.getAll();
	const contexts = await chrome.runtime.getContexts({});
	return {
		manifestVersion: chrome.runtime.getManifest().version,
		userAgent: navigator.userAgent,
		permissions: grants.permissions ?? [],
		origins: grants.origins ?? [],
		contextTypes: contexts.map((context) => String(context.contextType)),
	};
}

export async function buildLocalDiagnosticBundle({
	product,
	owners,
	events,
	generatedAt = new Date().toISOString(),
}: {
	product: DiagnosticProduct;
	owners: DiagnosticOwnerSummary | (() => DiagnosticOwnerSummary | Promise<DiagnosticOwnerSummary>);
	events: DiagnosticEventBuffer;
	generatedAt?: string;
}): Promise<LocalDiagnosticBundle> {
	const [facts, ownerState] = await Promise.all([
		collectBrowserFacts(),
		typeof owners === 'function' ? owners() : owners,
	]);
	return assembleLocalDiagnosticBundle({
		product,
		facts,
		owners: ownerState,
		events: events.read(),
		generatedAt,
	});
}

const DIAGNOSTIC_TIMEOUT_MS = 5_000;

function disconnectDiagnosticPort(port: chrome.runtime.Port): void {
	try { port.disconnect(); } catch { console.debug('[NEXUS diagnostics] Port already retired'); }
}

export function installLocalDiagnosticPort({
	product,
	owners,
	events,
}: {
	product: DiagnosticProduct;
	owners: DiagnosticOwnerSummary | (() => DiagnosticOwnerSummary | Promise<DiagnosticOwnerSummary>);
	events: DiagnosticEventBuffer;
}): () => void {
	const retirements = new Set<() => void>();
	const listener = (port: chrome.runtime.Port): void => {
		if (port.name !== DIAGNOSTIC_PORT) return;
		if (port.sender?.tab || port.sender?.id && port.sender.id !== chrome.runtime.id) {
			disconnectDiagnosticPort(port);
			return;
		}
		let alive = true;
		const retire = () => {
			if (!alive) return;
			alive = false;
			clearTimeout(timer);
			port.onDisconnect.removeListener(retire);
			retirements.delete(retire);
			disconnectDiagnosticPort(port);
		};
		const timer = setTimeout(retire, DIAGNOSTIC_TIMEOUT_MS);
		retirements.add(retire);
		port.onDisconnect.addListener(retire);
		const respond = (message: unknown) => {
			if (!alive) return;
			try { port.postMessage(message); } catch { events.record('warn', 'diagnostics', 'consumer-retired'); }
			finally { retire(); }
		};
		void buildLocalDiagnosticBundle({ product, owners, events }).then(
			(bundle) => respond({ ok: true, bundle }),
			() => respond({ ok: false, code: 'diagnostic-collection-failed' }),
		);
	};
	chrome.runtime.onConnect.addListener(listener);
	return () => {
		chrome.runtime.onConnect.removeListener(listener);
		for (const retire of [...retirements]) retire();
	};
}

export async function requestLocalDiagnosticBundle(): Promise<LocalDiagnosticBundle> {
	return new Promise((resolveBundle, reject) => {
		const port = chrome.runtime.connect(chrome.runtime.id, { name: DIAGNOSTIC_PORT });
		let settled = false;
		const finish = (bundle: LocalDiagnosticBundle | null, error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			port.onMessage.removeListener(onMessage);
			port.onDisconnect.removeListener(onDisconnect);
			disconnectDiagnosticPort(port);
			if (bundle) resolveBundle(bundle);
			else reject(error ?? new Error('diagnostic-collection-failed'));
		};
		const onMessage = (message: unknown) => {
			if (!message || typeof message !== 'object' || Array.isArray(message)) return;
			const response = message as { ok?: unknown; bundle?: unknown };
			if (response.ok === true && isLocalDiagnosticBundle(response.bundle)) finish(response.bundle);
			else finish(null, new Error('diagnostic-collection-failed'));
		};
		const onDisconnect = () => {
			// chrome-types does not currently declare lastError; access its actual
			// optional property without changing the shared Chrome declaration.
			void Reflect.get(chrome.runtime, 'lastError');
			finish(null, new Error('diagnostic port disconnected before response'));
		};
		const timer = setTimeout(() => finish(null, new Error('diagnostic collection timed out')), DIAGNOSTIC_TIMEOUT_MS);
		port.onMessage.addListener(onMessage);
		port.onDisconnect.addListener(onDisconnect);
	});
}

export function isLocalDiagnosticBundle(value: unknown): value is LocalDiagnosticBundle {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const row = value as Record<string, unknown>;
	const isRecord = (entry: unknown): entry is Record<string, unknown> =>
		Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry);
	const count = (entry: unknown) => typeof entry === 'number' && Number.isSafeInteger(entry) && entry >= 0;
	const allowed = new Set(['schemaVersion', 'product', 'generatedAt', 'manifestVersion', 'browser', 'permissions', 'origins', 'contexts', 'owners', 'recentEvents']);
	if (Object.keys(row).some((key) => !allowed.has(key))) return false;
	if (row.schemaVersion !== 1 || row.product !== 'SPECTRA' && row.product !== 'HALO'
		|| typeof row.generatedAt !== 'string' || !Number.isFinite(Date.parse(row.generatedAt))
		|| typeof row.manifestVersion !== 'string' || !/^\d+\.\d+\.\d+$/u.test(row.manifestVersion)) return false;
	if (!isRecord(row.browser) || Object.keys(row.browser).some((key) => key !== 'userAgentFamily' && key !== 'major')
		|| row.browser.userAgentFamily !== 'Chromium' || row.browser.major !== null && !count(row.browser.major)) return false;
	if (!Array.isArray(row.permissions) || row.permissions.length > 128
		|| !row.permissions.every((permission) => typeof permission === 'string' && SAFE_PERMISSION.test(permission))) return false;
	if (!isRecord(row.origins) || Object.keys(row.origins).some((key) => key !== 'grantCount' && key !== 'broadGrant')
		|| !count(row.origins.grantCount) || typeof row.origins.broadGrant !== 'boolean') return false;
	if (!isRecord(row.contexts) || !isRecord(row.owners)) return false;
	if (Object.entries(row.contexts).some(([key, entry]) => !SAFE_TOKEN.test(key) || !count(entry))) return false;
	if (Object.entries(row.owners).some(([key, entry]) => !SAFE_TOKEN.test(key)
		|| entry !== null && typeof entry !== 'boolean' && (typeof entry !== 'number' || !Number.isFinite(entry)))) return false;
	if (!Array.isArray(row.recentEvents) || row.recentEvents.length > MAX_EVENTS) return false;
	return row.recentEvents.every((event) => isRecord(event)
		&& Object.keys(event).every((key) => ['sequence', 'timestamp', 'level', 'scope', 'code'].includes(key))
		&& count(event.sequence) && typeof event.timestamp === 'number' && Number.isFinite(event.timestamp) && event.timestamp >= 0
		&& (event.level === 'info' || event.level === 'warn' || event.level === 'error')
		&& typeof event.scope === 'string' && SAFE_TOKEN.test(event.scope)
		&& typeof event.code === 'string' && SAFE_TOKEN.test(event.code));
}

export function downloadLocalDiagnosticBundle(bundle: LocalDiagnosticBundle): void {
	const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	try {
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `${bundle.product.toLowerCase()}-diagnostics-v${bundle.manifestVersion}.json`;
		anchor.click();
	} finally {
		URL.revokeObjectURL(url);
	}
}

export function installUnhandledDiagnosticEvents(
	events: DiagnosticEventBuffer,
	scope = 'background',
): () => void {
	const errorListener = () => events.record('error', scope, 'unhandled-error');
	const rejectionListener = () => events.record('error', scope, 'unhandled-rejection');
	globalThis.addEventListener('error', errorListener);
	globalThis.addEventListener('unhandledrejection', rejectionListener);
	return () => {
		globalThis.removeEventListener('error', errorListener);
		globalThis.removeEventListener('unhandledrejection', rejectionListener);
	};
}

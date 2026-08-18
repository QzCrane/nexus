// goal: one privacy-bounded local diagnostic contract for NEXUS browser products
// inv: no URL/title/storage value/token/secret can enter the bundle through this API

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

async function collectBrowserFacts(): Promise<{
	permissions: string[];
	originGrantCount: number;
	broadOriginGrant: boolean;
	contexts: Record<string, number>;
}> {
	const grants = await chrome.permissions.getAll();
	const permissions = (grants.permissions ?? []).filter((permission) => SAFE_PERMISSION.test(permission)).sort();
	const origins = grants.origins ?? [];
	const contexts = await chrome.runtime.getContexts({});
	const contextCounts: Record<string, number> = {};
	for (const context of contexts) {
		const type = String(context.contextType);
		if (!SAFE_TOKEN.test(type)) continue;
		contextCounts[type] = (contextCounts[type] ?? 0) + 1;
	}
	return {
		permissions,
		originGrantCount: origins.length,
		broadOriginGrant: origins.some((origin) => BROAD_ORIGINS.has(origin)),
		contexts: Object.fromEntries(Object.entries(contextCounts).sort(([left], [right]) => left.localeCompare(right))),
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
	if (product !== 'SPECTRA' && product !== 'HALO') throw new Error('unsupported diagnostic product');
	const [facts, ownerState] = await Promise.all([
		collectBrowserFacts(),
		typeof owners === 'function' ? owners() : owners,
	]);
	return Object.freeze({
		schemaVersion: 1,
		product,
		generatedAt,
		manifestVersion: chrome.runtime.getManifest().version,
		browser: Object.freeze({
			userAgentFamily: 'Chromium' as const,
			major: browserMajor(navigator.userAgent),
		}),
		permissions: Object.freeze(facts.permissions),
		origins: Object.freeze({
			grantCount: facts.originGrantCount,
			broadGrant: facts.broadOriginGrant,
		}),
		contexts: Object.freeze(facts.contexts),
		owners: validateOwnerSummary(ownerState),
		recentEvents: events.read(),
	});
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
	const listener = (port: chrome.runtime.Port): void => {
		if (port.name !== DIAGNOSTIC_PORT) return;
		// Only extension-owned pages may request a diagnostic export. Content
		// scripts carry a tab sender and are deliberately excluded.
		if (port.sender?.tab) {
			port.disconnect();
			return;
		}
		void buildLocalDiagnosticBundle({ product, owners, events }).then((bundle) => {
			port.postMessage({ ok: true, bundle });
		}).catch(() => {
			port.postMessage({ ok: false, code: 'diagnostic-collection-failed' });
		}).finally(() => {
			port.disconnect();
		});
	};
	chrome.runtime.onConnect.addListener(listener);
	return () => chrome.runtime.onConnect.removeListener(listener);
}

export async function requestLocalDiagnosticBundle(): Promise<LocalDiagnosticBundle> {
	return new Promise((resolveBundle, reject) => {
		const port = chrome.runtime.connect({ name: DIAGNOSTIC_PORT });
		let settled = false;
		port.onMessage.addListener((message: unknown) => {
			if (settled || !message || typeof message !== 'object' || Array.isArray(message)) return;
			const response = message as { ok?: unknown; bundle?: unknown; code?: unknown };
			if (response.ok === true && response.bundle && typeof response.bundle === 'object') {
				settled = true;
				resolveBundle(response.bundle as LocalDiagnosticBundle);
				return;
			}
			if (response.ok === false) {
				settled = true;
				reject(new Error(typeof response.code === 'string' ? response.code : 'diagnostic-collection-failed'));
			}
		});
		port.onDisconnect.addListener(() => {
			if (settled) return;
			settled = true;
			reject(new Error(chrome.runtime.lastError?.message ?? 'diagnostic port disconnected before response'));
		});
	});
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

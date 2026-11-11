// goal: own one shared SPECTRA built-extension smoke fixture, browser session, and helper surface
// inv: each suite owns its own browser/profile/server lifecycle; this module only holds the active session

import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setDefaultTimeout } from 'bun:test';
import puppeteer from 'puppeteer';
import type { Browser, CDPSession, EvaluateFunc, Page, Target, WebWorker } from 'puppeteer';
import type { AudioSessionSnapshot, RegistrySnapshot, SettingsPatch, SettingsSnapshot } from '@nexus/contracts';

// A smoke case waits on a browser, not on a function call: the waits it declares
// are up to 15s (`waitForContentStatus`) and 10s (`eventually`), so the runner's
// 5s default aborts cases that are still inside their own budget - and reports a
// bare timeout instead of the wait's diagnostic. One ceiling above every declared
// wait keeps a slow build's failure message meaningful, and every spec imports
// this module, so this is the only place that owns it.
setDefaultTimeout(30_000);

export const EXTENSION_DIR = resolve(process.env.SPECTRA_EXTENSION_DIR ?? join(import.meta.dir, '..', '..', 'dist'));

export const FIXTURE_PATH = join(import.meta.dir, '..', 'fixtures', 'smoke-test.html');

export const FIXTURE_HTML = readFileSync(FIXTURE_PATH, 'utf8');

export const REMOTE_SITE_DIR = resolve(import.meta.dir, '..', '..', '..', '..', '..', 'remote-site');

export const SMOKE_LOCALE = process.env.SPECTRA_SMOKE_LOCALE?.trim() || 'en-US';

export const EXPLICIT_CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim();

/**
 * The browser the product actually runs on. Puppeteer's own download is a
 * pinned, often older Chrome; a suite that installs the extension there tests
 * an extension model Chrome 137+ no longer has.
 */
function systemChromeExecutable(): string | undefined {
	const candidates = process.platform === 'win32'
		? [
			join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
			join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
			join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
		]
		: process.platform === 'darwin'
			? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
			: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'];
	return candidates.find((candidate) => candidate.length > 0 && existsSync(candidate));
}

if (!/^[a-z]{2}(?:-[A-Z]{2})?$/u.test(SMOKE_LOCALE)) {
	throw new Error(`Unsupported SPECTRA smoke locale: ${SMOKE_LOCALE}`);
}

if (!existsSync(join(EXTENSION_DIR, 'manifest.json'))) {
	throw new Error(`SPECTRA extension directory is missing manifest.json: ${EXTENSION_DIR}`);
}

export const EXTENSION_COMMAND_COUNT = Object.keys((
	JSON.parse(readFileSync(join(EXTENSION_DIR, 'manifest.json'), 'utf8')) as {
		commands?: Record<string, unknown>;
	}
).commands ?? {}).length;

export let browser: Browser;

export let serviceWorkerConnection: Browser | null = null;

export let fixturePage: Page;

export let serviceWorkerTarget: Target;

export let serviceWorker: WebWorker;

export let extensionId = '';

export let fixtureUrl = '';

export let server: ReturnType<typeof Bun.serve>;

export let browserProfileDir = '';

export let runtimeLeaseClient: Page | null = null;
export let runtimeLeaseClientPromise: Promise<Page> | null = null;

export let serviceWorkerRefreshPromise: Promise<void> | null = null;

export let peerRuntimeDebugClient: CDPSession | null = null;

export const peerRuntimeDebugEvents: string[] = [];

export const fixtureErrors: string[] = [];

export const smokeRuntimeLeases = new Map<string, SmokeRuntimeLease>();

export interface ContentStatus {
	config?: {
		volume?: number;
		volumeBase?: number;
		boost?: number;
		muted?: boolean;
		speed?: number;
	};
	hasAudio: boolean;
	mode: string;
	actualMode?: string;
	phase?: string;
	generation?: number;
}

export interface ContentBootstrapStatus {
	bootstrapRevision: string;
	runtimeRevision: string | null;
	ready: boolean;
	ownedSources: Array<{
		mediaId: string;
		sourceRevision: number;
	}>;
	mediaIntentState?: 'unset' | 'retained' | 'released';
}

export type BootstrapListenerKey = readonly [
	target: 'document' | 'window',
	type: string,
	capture: boolean,
];

export interface BootstrapListenerProbe {
	added: BootstrapListenerKey[];
	removed: BootstrapListenerKey[];
	originalAdd: typeof EventTarget.prototype.addEventListener;
	originalRemove: typeof EventTarget.prototype.removeEventListener;
}

export interface BootstrapReinjectionResult {
	same: boolean;
	revision: string | undefined;
	listenerChanges?: {
		added: BootstrapListenerKey[];
		removed: BootstrapListenerKey[];
	};
}

export interface SmokeRuntimeLease {
	tabId: number;
	documentId: string;
	runtimeRevision: string;
	capability: string;
}

export interface PeerRuntimeBreakpoint {
	url: string;
	lineNumber: number;
	columnNumber: number;
	constructorBinding: string;
}

export interface AudioConfig {
	enabled: boolean;
	volume: number;
	volumeBase: number;
	boost: number;
	muted: boolean;
	compressor: boolean;
	mono: boolean;
	bass: boolean;
	eqValues: number[];
	pan: number;
	delay: number;
	speed: number;
	preservePitch: boolean;
}

export interface CaptureState {
	tabId: number;
	generation: number;
	phase: 'idle' | 'starting' | 'active' | 'stopping' | 'error';
	active: boolean;
	actualMode: 'bypass' | 'webaudio' | 'capture';
	lastError: { code: string; message: string; retryable: boolean } | null;
}

export interface CaptureResponse {
	ok: boolean;
	data?: CaptureState;
	error?: { code: string; message: string; retryable: boolean };
}

export interface OffscreenHostSnapshot {
	audioTabs: Array<{ tabId: number; generation: number }>;
	remoteTabs: Array<{ tabId: number; sessionId: string }>;
}

export interface PeerRuntimeProbe {
	peerType: string;
	vendorAssignments: number;
	peerConstructions: number;
	peerDestructions: number;
}

export interface RemotePublicSession {
	protocolVersion: 3;
	sessionId: string;
	peerId: string;
	secret: string;
	createdAt: number;
	pairingExpiresAt: number;
	tabId: number;
	connected: boolean;
}

export interface SyntheticCaptureState {
	calls: number;
	pending: boolean;
	processorStates: string[];
}

export interface ContentRuntimeProbe {
	listenersReady: boolean;
	runtimeRevision: string | null;
	sameRuntime: boolean | null;
	oldRuntimeDisposed: boolean | null;
}

export interface PopupVolumePresentation {
	sliderCount: number;
	min: string;
	max: string;
	value: string;
	fillColor: string;
	valueColor: string;
	sliderAccent: string;
}

export interface SmokeRpcResult<T> {
	ok: boolean;
	data: T;
	error?: { message?: string };
}

export interface PageMediaControllerState {
	volumeBase: number;
	mediaMuted: boolean;
	speed: number;
	domVolume: number;
	domMuted: boolean;
	domSpeed: number;
}

export interface OsdFeedbackFrame {
	at: number;
	label: string;
	width: number;
	color: string;
}

export interface OsdFeedbackSnapshot {
	actual: number;
	muted: boolean;
	visible: boolean;
	label: string;
	width: number;
	tone: string;
	color: string;
	frames: OsdFeedbackFrame[];
}

export const DEFAULT_AUDIO_CONFIG: AudioConfig = {
	enabled: true,
	volume: 100,
	volumeBase: 100,
	boost: 1,
	muted: false,
	compressor: false,
	mono: false,
	bass: false,
	eqValues: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
	pan: 0,
	delay: 0,
	speed: 1,
	preservePitch: true,
};

export function createSmokeToneWav(): Uint8Array {
	const sampleRate = 8_000;
	const sampleCount = sampleRate;
	const bytes = new Uint8Array(44 + sampleCount * 2);
	const view = new DataView(bytes.buffer);
	const writeAscii = (offset: number, value: string) => {
		for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
	};
	writeAscii(0, 'RIFF');
	view.setUint32(4, bytes.length - 8, true);
	writeAscii(8, 'WAVE');
	writeAscii(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	writeAscii(36, 'data');
	view.setUint32(40, sampleCount * 2, true);
	for (let index = 0; index < sampleCount; index++) {
		view.setInt16(44 + index * 2, Math.round(Math.sin(2 * Math.PI * 440 * index / sampleRate) * 12_000), true);
	}
	return bytes;
}

export const SMOKE_TONE_WAV = createSmokeToneWav();

export function collectPageErrors(page: Page, errors: string[]): void {
	page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
}

export type DefaultShortcutKey = 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'KeyM';

export async function tapDefaultShortcut(page: Page, key: DefaultShortcutKey): Promise<void> {
	await page.keyboard.down('Alt');
	await page.keyboard.press(key);
	await page.keyboard.up('Alt');
}

export async function triggerDefaultHotkeyFromContent(
	tabId: number,
	action: 'volume_up',
): Promise<void> {
	await evaluateServiceWorker(async ({ targetTabId, targetAction }) => {
		const [execution] = await chrome.scripting.executeScript({
			target: { tabId: targetTabId },
			world: 'ISOLATED',
			func: async (isolatedAction) => {
				const gesture = `default:${Date.now()}`;
				const send = (phase: 'press' | 'release') => chrome.runtime.sendMessage({
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					type: 'spectra.content.default-hotkey.trigger',
					payload: {
						action: isolatedAction,
						gesture,
						phase,
						repeated: false,
					},
				});
				const press = await send('press');
				const release = await send('release');
				return { press, release };
			},
			args: [targetAction],
		});
		const result = execution?.result;
		if (!result?.press?.ok || !result.release?.ok) {
			throw new Error(`Default hotkey trigger failed: ${JSON.stringify(result)}`);
		}
	}, { targetTabId: tabId, targetAction: action });
}

/**
 * Fires the accepted Content envelope for a built-in chord without waiting for
 * the gesture burst. A real browser hands a document's first Alt+Up to the
 * manifest `volume_up` command, which a headless Input domain cannot dispatch;
 * smoke tests therefore drive the same Content path directly and must not await
 * gated press responses.
 */
export async function pressDefaultHotkeyFromContent(
	tabId: number,
	action: 'volume_up',
): Promise<void> {
	await evaluateServiceWorker(async ({ targetTabId, targetAction }) => {
		await chrome.scripting.executeScript({
			target: { tabId: targetTabId },
			world: 'ISOLATED',
			func: (isolatedAction) => {
				// OSD admission accepts only `default:<positive integer>` gestures.
				const gesture = `default:${Date.now() * 1_000 + Math.floor(Math.random() * 1_000)}`;
				const send = (phase: 'press' | 'release') => {
					void chrome.runtime.sendMessage({
						protocolVersion: 2,
						requestId: crypto.randomUUID(),
						type: 'spectra.content.default-hotkey.trigger',
						payload: {
							action: isolatedAction,
							gesture,
							phase,
							repeated: false,
						},
					}).catch(() => undefined);
				};
				send('press');
				setTimeout(() => send('release'), 0);
			},
			args: [targetAction],
		});
	}, { targetTabId: tabId, targetAction: action });
}

export async function holdDefaultShortcut(
	page: Page,
	key: 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp',
	repeats: number,
	releaseDelayMs = 0,
	repeatIntervalMs = 35,
	beforeRelease?: () => Promise<void>,
): Promise<void> {
	await page.keyboard.down('Alt');
	await page.keyboard.down(key);
	for (let index = 0; index < repeats; index += 1) {
		await new Promise((resolveWait) => setTimeout(resolveWait, repeatIntervalMs));
		await page.keyboard.down(key);
	}
	if (releaseDelayMs > 0) await new Promise((resolveWait) => setTimeout(resolveWait, releaseDelayMs));
	await beforeRelease?.();
	await page.keyboard.up(key);
	await page.keyboard.up('Alt');
}

export async function startOsdFeedbackProbe(
	page: Page,
	labelSuffix: '%' | '×',
	includeCurrent = false,
): Promise<void> {
	await page.evaluate(({ suffix, recordCurrent }) => {
		const root = document.querySelector<HTMLElement>('#spectra-osd-host')?.shadowRoot;
		const text = root?.getElementById('t');
		const fill = root?.getElementById('f');
		if (!root || !text || !fill) throw new Error('OSD feedback surface is unavailable');
		const scope = window as Window & {
			__spectraOsdFeedbackProbe?: { frames: OsdFeedbackFrame[]; observer: MutationObserver };
		};
		scope.__spectraOsdFeedbackProbe?.observer.disconnect();
		const frames: OsdFeedbackFrame[] = [];
		const record = () => {
			const label = text.textContent ?? '';
			const width = Number.parseFloat(fill.style.width);
			if (label.endsWith(suffix) && Number.isFinite(width)) frames.push({
				at: performance.now(),
				label,
				width,
				color: getComputedStyle(fill).backgroundColor,
			});
		};
		const observer = new MutationObserver(record);
		scope.__spectraOsdFeedbackProbe = { frames, observer };
		observer.observe(root, {
			attributes: true,
			attributeFilter: ['style'],
			childList: true,
			characterData: true,
			subtree: true,
		});
		if (recordCurrent) record();
	}, { suffix: labelSuffix, recordCurrent: includeCurrent });
}

export async function readOsdFeedback(
	page: Page,
	metric: 'speed' | 'volume',
	stopProbe = false,
): Promise<OsdFeedbackSnapshot> {
	return page.evaluate(({ actualMetric, stop }) => {
		const scope = window as Window & {
			__spectraOsdFeedbackProbe?: { frames: OsdFeedbackFrame[]; observer: MutationObserver };
		};
		if (stop) scope.__spectraOsdFeedbackProbe?.observer.disconnect();
		const media = document.querySelector<HTMLMediaElement>('video,audio');
		const root = document.querySelector<HTMLElement>('#spectra-osd-host')?.shadowRoot;
		const osd = root?.getElementById('o');
		const fill = root?.getElementById('f');
		return {
			actual: actualMetric === 'volume'
				? Math.round((media?.volume ?? -1) * 100)
				: media?.playbackRate ?? -1,
			muted: media?.muted ?? false,
			visible: osd?.classList.contains('v') ?? false,
			label: root?.getElementById('t')?.textContent ?? '',
			width: fill ? Number.parseFloat(fill.style.width) : -1,
			tone: osd?.className ?? '',
			color: fill ? getComputedStyle(fill).backgroundColor : '',
			frames: [...scope.__spectraOsdFeedbackProbe?.frames ?? []],
		};
	}, { actualMetric: metric, stop: stopProbe });
}

export interface ExtensionLayoutAudit {
	documentOverflow: number;
	controlsOutsideViewport: string[];
	clippedText: string[];
}

export interface ExtensionAccessibilityAudit {
	interactiveCount: number;
	namelessInteractive: string[];
	missingState: string[];
	domPressedCount: number;
	axPressedCount: number;
}

export async function inspectExtensionLayout(page: Page): Promise<ExtensionLayoutAudit> {
	return page.evaluate(() => {
		const isVisible = (element: Element): element is HTMLElement => {
			if (!(element instanceof HTMLElement)) return false;
			const style = getComputedStyle(element);
			const rect = element.getBoundingClientRect();
			return style.display !== 'none'
				&& style.visibility !== 'hidden'
				&& !element.closest('[hidden], [inert]')
				&& rect.width > 4
				&& rect.height > 4;
		};
		const describe = (element: HTMLElement): string => {
			const identity = element.id
				? `#${element.id}`
				: element.classList.length > 0
					? `.${[...element.classList].slice(0, 2).join('.')}`
					: element.tagName.toLowerCase();
			return `${identity}:${element.textContent?.trim().replace(/\s+/gu, ' ').slice(0, 48) ?? ''}`;
		};
		const controls = [...document.querySelectorAll<HTMLElement>(
			'button, input, select, textarea, a[href], [role="button"], [role="tab"]',
		)].filter(isVisible);
		const controlsOutsideViewport = controls.filter((element) => {
			const rect = element.getBoundingClientRect();
			return rect.left < -1 || rect.right > window.innerWidth + 1;
		}).map(describe);
		const textElements = [...document.querySelectorAll<HTMLElement>(
			'button, a[href], label, h1, h2, h3, h4, p, [role="tab"]',
		)].filter(isVisible);
		const clippedText = textElements.filter((element) => {
			const style = getComputedStyle(element);
			if (style.textOverflow === 'ellipsis' || style.overflowX === 'auto' || style.overflowX === 'scroll') {
				return false;
			}
			return element.scrollWidth > element.clientWidth + 1;
		}).map(describe);
		return {
			documentOverflow: Math.max(
				document.documentElement.scrollWidth,
				document.body.scrollWidth,
			) - window.innerWidth,
			controlsOutsideViewport,
			clippedText,
		};
	});
}

export async function inspectExtensionAccessibility(page: Page): Promise<ExtensionAccessibilityAudit> {
	const client = await page.createCDPSession();
	try {
		await client.send('Accessibility.enable');
		const { nodes } = await client.send('Accessibility.getFullAXTree');
		const interactiveRoles = new Set([
			'button',
			'checkbox',
			'combobox',
			'link',
			'slider',
			'spinbutton',
			'switch',
			'tab',
			'textbox',
		]);
		const stateProperty = (node: (typeof nodes)[number], name: string): boolean => (
			node.properties?.some((property) => property.name === name) ?? false
		);
		const activeInteractive = nodes.filter((node) => (
			!node.ignored && interactiveRoles.has(String(node.role?.value ?? ''))
		));
		const namelessInteractive = activeInteractive.filter((node) => (
			String(node.name?.value ?? '').trim().length === 0
		)).map((node) => `${String(node.role?.value ?? 'unknown')}:${node.backendDOMNodeId ?? 'virtual'}`);
		const missingState = activeInteractive.flatMap((node) => {
			const role = String(node.role?.value ?? '');
			const descriptor = `${role}:${String(node.name?.value ?? '')}`;
			if ((role === 'checkbox' || role === 'switch') && !stateProperty(node, 'checked')) return [descriptor];
			if (role === 'tab' && !stateProperty(node, 'selected')) return [descriptor];
			if ((role === 'slider' || role === 'spinbutton') && node.value === undefined) return [descriptor];
			return [];
		});
		const domPressedCount = await page.evaluate(() => (
			[...document.querySelectorAll<HTMLElement>('[aria-pressed]')].filter((element) => {
				const style = getComputedStyle(element);
				return style.display !== 'none'
					&& style.visibility !== 'hidden'
					&& !element.closest('[hidden], [inert]');
			}).length
		));
		return {
			interactiveCount: activeInteractive.length,
			namelessInteractive,
			missingState,
			domPressedCount,
			axPressedCount: activeInteractive.filter((node) => stateProperty(node, 'pressed')).length,
		};
	} finally {
		await client.send('Accessibility.disable').catch(() => undefined);
		await client.detach().catch(() => undefined);
	}
}

export async function readContentStatus(url = fixturePage.url()): Promise<ContentStatus> {
	// A Service Worker restart intentionally loses its in-memory consumer map.
	// Heavy-runtime reads must reacquire an explicit observation lease just like
	// production Popup/remote clients do; direct tabs.sendMessage is not itself
	// runtime ownership and may correctly arrive after the 250ms final release.
	await acquireSmokeRuntime(url, 'smoke-status');
	return evaluateServiceWorker(async (targetUrl) => {
		const tabs = await chrome.tabs.query({});
		const tab = tabs.find((candidate) => candidate.url === targetUrl);
		if (tab?.id === undefined) throw new Error(`Unable to find fixture tab: ${targetUrl}`);
		const response = await chrome.tabs.sendMessage(tab.id, {
			protocolVersion: 2,
			requestId: crypto.randomUUID(),
			tabId: tab.id,
			type: 'spectra.audio.runtime.get',
			payload: {},
		});
		if (!response?.ok) throw new Error(response?.error?.message ?? 'Unable to read content runtime');
		return { ...response.data, mode: response.data.actualMode };
	}, url) as Promise<ContentStatus>;
}

export async function readContentBootstrapStatus(url = fixturePage.url()): Promise<ContentBootstrapStatus> {
	return evaluateServiceWorker(async (targetUrl) => {
		const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === targetUrl);
		if (tab?.id === undefined) throw new Error(`Unable to find bootstrap tab: ${targetUrl}`);
		const response = await chrome.tabs.sendMessage(tab.id, {
			protocolVersion: 2,
			requestId: crypto.randomUUID(),
			tabId: tab.id,
			type: 'spectra.content.runtime.status',
			payload: {},
		});
		if (!response?.ok) throw new Error(response?.error?.message ?? 'Unable to read content bootstrap');
		return response.data;
	}, url) as Promise<ContentBootstrapStatus>;
}

export async function waitForContentBootstrapStatus(
	url = fixturePage.url(),
	timeoutMs = 15_000,
): Promise<ContentBootstrapStatus> {
	return eventually(
		() => readContentBootstrapStatus(url),
		(status) => status.bootstrapRevision.length > 0,
		`content bootstrap for ${url}`,
		timeoutMs,
	);
}

export async function getRuntimeLeaseClient(): Promise<Page> {
	if (runtimeLeaseClient && !runtimeLeaseClient.isClosed()) return runtimeLeaseClient;
	if (!runtimeLeaseClientPromise) {
		runtimeLeaseClientPromise = (async () => {
			const page = await browser.newPage();
			await page.goto(`chrome-extension://${extensionId}/options.html`, {
				waitUntil: 'domcontentloaded',
			});
			runtimeLeaseClient = page;
			return page;
		})().finally(() => {
			runtimeLeaseClientPromise = null;
		});
	}
	return runtimeLeaseClientPromise;
}

export function resetRuntimeLeaseClient(): void {
	runtimeLeaseClient = null;
	runtimeLeaseClientPromise = null;
}

export function isDetachedServiceWorkerError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes('detached frame or worker')
		|| message.includes('Execution context was destroyed')
		|| message.includes('Target closed')
		|| message.includes('Session closed')
		|| message.includes('Cannot find context with specified id')
		|| message.includes('Worker was destroyed')
		|| message.includes('Target.detachedFromTarget');
}

export async function refreshSuspendedServiceWorker(): Promise<void> {
	if (!serviceWorkerRefreshPromise) {
		serviceWorkerRefreshPromise = (async () => {
			// Start the browser-owned MV3 lifecycle directly. A product RPC is not a
			// valid wake primitive because handler registration may itself be waiting
			// for offscreen recovery. The fresh connection remains necessary because
			// Puppeteer caches the destroyed WebWorker on its old target.
			const client = await fixturePage.createCDPSession();
			try {
				await client.send('ServiceWorker.enable');
				await client.send('ServiceWorker.startWorker', {
					scopeURL: `chrome-extension://${extensionId}/`,
				});
				await refreshServiceWorkerHandle(undefined, 15_000);
			} finally {
				await client.send('ServiceWorker.disable').catch(() => undefined);
				await client.detach().catch(() => undefined);
			}
		})().finally(() => {
			serviceWorkerRefreshPromise = null;
		});
	}
	await serviceWorkerRefreshPromise;
}

export async function evaluateServiceWorker<
	Params extends unknown[],
	Func extends EvaluateFunc<Params> = EvaluateFunc<Params>,
>(func: Func | string, ...args: Params): Promise<Awaited<ReturnType<Func>>> {
	const hasCurrentIdentity = async (): Promise<boolean> => {
		try {
			const runtimeId = await serviceWorker.evaluate(() => (
				typeof chrome === 'undefined' ? null : chrome.runtime?.id ?? null
			));
			return runtimeId === extensionId;
		} catch {
			return false;
		}
	};
	let lastError: unknown;
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		if (attempt > 1 || !await hasCurrentIdentity()) {
			await refreshSuspendedServiceWorker();
		}
		try {
			return await serviceWorker.evaluate<Params, Func>(func, ...args);
		} catch (error) {
			lastError = error;
			if (!isDetachedServiceWorkerError(error)) throw error;
		}
	}
	throw lastError;
}

export async function reinjectContentBootstrap(
	url: string,
	replaceCurrentRevision = false,
): Promise<BootstrapReinjectionResult> {
	return evaluateServiceWorker(async ({ targetUrl, replace }) => {
		const tabs = await chrome.tabs.query({});
		const tab = tabs.find((candidate) => candidate.url === targetUrl);
		if (tab?.id === undefined) throw new Error(`Unable to find fixture tab: ${targetUrl}`);
		await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			world: 'ISOLATED',
			func: (forceReplacement) => {
				const scope = window as Window & {
					__SPECTRA_CONTENT_BOOTSTRAP__?: { bootstrapRevision: string };
					__spectraBootstrapBefore?: object;
					__spectraBootstrapListenerProbe?: BootstrapListenerProbe;
				};
				scope.__spectraBootstrapBefore = scope.__SPECTRA_CONTENT_BOOTSTRAP__;
				if (forceReplacement && scope.__SPECTRA_CONTENT_BOOTSTRAP__) {
					const originalAdd = EventTarget.prototype.addEventListener;
					const originalRemove = EventTarget.prototype.removeEventListener;
					const probe = {
						added: [] as BootstrapListenerKey[],
						removed: [] as BootstrapListenerKey[],
						originalAdd,
						originalRemove,
					};
					const listenerKey = (
						target: EventTarget,
						type: string,
						options?: boolean | EventListenerOptions,
					): BootstrapListenerKey | null => {
						const owner = target === window
							? 'window'
							: target === document ? 'document' : null;
						if (!owner) return null;
						const capture = typeof options === 'boolean'
							? options
							: options?.capture === true;
						return [owner, type, capture];
					};
					scope.__spectraBootstrapListenerProbe = probe;
					EventTarget.prototype.addEventListener = function (
						this: EventTarget,
						type: string,
						listener: EventListenerOrEventListenerObject | null,
						options?: boolean | AddEventListenerOptions,
					): void {
						const key = listenerKey(this, type, options);
						if (key) probe.added.push(key);
						originalAdd.call(this, type, listener, options);
					};
					EventTarget.prototype.removeEventListener = function (
						this: EventTarget,
						type: string,
						listener: EventListenerOrEventListenerObject | null,
						options?: boolean | EventListenerOptions,
					): void {
						const key = listenerKey(this, type, options);
						if (key) probe.removed.push(key);
						originalRemove.call(this, type, listener, options);
					};
					scope.__SPECTRA_CONTENT_BOOTSTRAP__.bootstrapRevision = 'stale-test';
				}
			},
			args: [replace],
		});
		let injectionError: unknown;
		try {
			await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				files: ['content-bootstrap.js'],
				world: 'ISOLATED',
			});
		} catch (error) {
			injectionError = error;
		}
		const [inspection] = await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			world: 'ISOLATED',
			func: () => {
				const scope = window as Window & {
					__SPECTRA_CONTENT_BOOTSTRAP__?: { bootstrapRevision?: string };
					__spectraBootstrapBefore?: object;
					__spectraBootstrapListenerProbe?: BootstrapListenerProbe;
				};
				const probe = scope.__spectraBootstrapListenerProbe;
				if (probe) {
					EventTarget.prototype.addEventListener = probe.originalAdd;
					EventTarget.prototype.removeEventListener = probe.originalRemove;
				}
				const sorted = (keys: BootstrapListenerKey[]): BootstrapListenerKey[] => (
					[...keys].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
				);
				const result = {
					same: scope.__SPECTRA_CONTENT_BOOTSTRAP__ === scope.__spectraBootstrapBefore,
					revision: scope.__SPECTRA_CONTENT_BOOTSTRAP__?.bootstrapRevision,
					...(probe ? {
						listenerChanges: {
							added: sorted(probe.added),
							removed: sorted(probe.removed),
						},
					} : {}),
				};
				delete scope.__spectraBootstrapBefore;
				delete scope.__spectraBootstrapListenerProbe;
				return result;
			},
		});
		if (injectionError) throw injectionError;
		return inspection?.result ?? { same: false, revision: undefined };
	}, { targetUrl: url, replace: replaceCurrentRevision });
}

export async function acquireSmokeRuntime(
	url = fixturePage.url(),
	capability = 'smoke-suite',
): Promise<SmokeRuntimeLease> {
	const tabId = await getTabId(url);
	const client = await getRuntimeLeaseClient();
	const response = await client.evaluate(async ({ targetTabId, leaseCapability }) => {
		return chrome.runtime.sendMessage({
			protocolVersion: 2,
			requestId: crypto.randomUUID(),
			type: 'spectra.content.runtime.ensure',
			payload: {
				tabId: targetTabId,
				reason: 'observation',
				capability: leaseCapability,
			},
		});
	}, { targetTabId: tabId, leaseCapability: capability });
	if (!response?.ok) {
		const bootstrap = await readContentBootstrapStatus(url).catch(() => null);
		throw new Error(
			`${response?.error?.message ?? 'Unable to acquire smoke runtime'}: ${JSON.stringify({
				response,
				bootstrap,
				fixtureErrors,
			})}`,
		);
	}
	const lease: SmokeRuntimeLease = {
		tabId,
		documentId: response.data.documentId,
		runtimeRevision: response.data.runtimeRevision,
		capability,
	};
	smokeRuntimeLeases.set(`${tabId}:${lease.documentId}:${capability}`, lease);
	return lease;
}

export async function releaseSmokeRuntime(lease: SmokeRuntimeLease): Promise<void> {
	if (!runtimeLeaseClient || runtimeLeaseClient.isClosed()) {
		throw new Error('The smoke runtime lease client is unavailable');
	}
	// Release from the same tab-hosted extension UI that acquired the token.
	// Background admits this extension origin while still rejecting web Content
	// documents, and the checked ACK prevents smoke cleanup from hiding a leak.
	const response = await runtimeLeaseClient.evaluate(async (owned) => (
		chrome.runtime.sendMessage({
			protocolVersion: 2,
			requestId: crypto.randomUUID(),
			type: 'spectra.content.runtime.release',
			payload: {
				runtimeRevision: owned.runtimeRevision,
				tabId: owned.tabId,
				documentId: owned.documentId,
				reason: 'observation',
				capability: owned.capability,
			},
		})
	), lease);
	if (!response?.ok) {
		throw new Error(response?.error?.message ?? 'Unable to release smoke runtime');
	}
	smokeRuntimeLeases.delete(`${lease.tabId}:${lease.documentId}:${lease.capability}`);
}

export async function releaseSmokeRuntimes(): Promise<void> {
	if (smokeRuntimeLeases.size === 0) return;
	for (const lease of [...smokeRuntimeLeases.values()]) {
		await releaseSmokeRuntime(lease).catch(() => undefined);
	}
	smokeRuntimeLeases.clear();
}

export async function waitForContentStatus(
	predicate: (status: ContentStatus) => boolean,
	timeoutMs = 5_000,
	// A tab that drives itself with pushState changes URL under a single wait, so
	// the target may be resolved per attempt instead of once up front.
	target: string | (() => string) = () => fixturePage.url(),
): Promise<ContentStatus> {
	const deadline = Date.now() + timeoutMs;
	let lastStatus: ContentStatus | undefined;
	let lastReadError: unknown;
	while (Date.now() < deadline) {
		try {
			lastStatus = await readContentStatus(typeof target === 'string' ? target : target());
			if (predicate(lastStatus)) return lastStatus;
		} catch (error) {
			// Content initialization and service-worker startup are eventually consistent.
			lastReadError = error;
		}
		await new Promise((resolveWait) => setTimeout(resolveWait, 10));
	}
	const readFailure = lastReadError === undefined
		? ''
		: `; last read failed: ${lastReadError instanceof Error ? lastReadError.message : String(lastReadError)}`;
	throw new Error(`Timed out waiting for content status: ${JSON.stringify(lastStatus)}${readFailure}`);
}

export async function getOffscreenContextCount(worker?: WebWorker): Promise<number> {
	const evaluate = worker
		? worker.evaluate.bind(worker)
		: evaluateServiceWorker;
	return evaluate(async () => {
		const contexts = await chrome.runtime.getContexts({
			contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
		});
		return contexts.length;
	});
}

export async function eventually<T>(
	read: () => Promise<T>,
	predicate: (value: T) => boolean,
	label: string,
	timeoutMs = 10_000,
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	let lastValue: T | undefined;
	let lastError: unknown;
	while (Date.now() < deadline) {
		try {
			lastValue = await read();
			if (predicate(lastValue)) return lastValue;
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolveWait) => setTimeout(resolveWait, 10));
	}
	throw new Error(
		`Timed out waiting for ${label}: ${JSON.stringify(lastValue)}${lastError ? ` (${String(lastError)})` : ''}`,
	);
}

export async function getTabId(url: string, worker?: WebWorker): Promise<number> {
	const evaluate = worker
		? worker.evaluate.bind(worker)
		: evaluateServiceWorker;
	return evaluate(async (targetUrl: string) => {
		const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === targetUrl);
		if (tab?.id === undefined) throw new Error(`Unable to find tab: ${targetUrl}`);
		return tab.id;
	}, url);
}

export async function installPageMediaControllerHarness(
	initial: Pick<PageMediaControllerState, 'volumeBase' | 'mediaMuted' | 'speed'> = {
		volumeBase: 100,
		mediaMuted: false,
		speed: 1,
	},
): Promise<void> {
	await fixturePage.evaluate((seed) => {
		const video = document.querySelector<HTMLVideoElement>('#v');
		const host = video?.parentElement as (HTMLElement & {
			getVolume?: () => number;
			setVolume?: (value: number) => void;
			isMuted?: () => boolean;
			setMuted?: (value: boolean) => void;
			getPlaybackRate?: () => number;
			setPlaybackRate?: (value: number) => void;
		}) | null;
		if (!video || !host) throw new Error('Page-media controller fixture is missing');
		const scope = window as Window & {
			__spectraPageMediaState?: {
				volumeBase: number;
				mediaMuted: boolean;
				speed: number;
			};
		};
		const state = { ...seed };
		scope.__spectraPageMediaState = state;
		host.getVolume = () => state.volumeBase;
		host.setVolume = (value) => {
			state.volumeBase = value;
			video.volume = value / 100 * 0.6131;
		};
		host.isMuted = () => state.mediaMuted;
		host.setMuted = (value) => {
			state.mediaMuted = value;
			// The fixture deliberately keeps the DOM muted projection false. This
			// models page players whose semantic mute lives in their controller.
			video.muted = false;
		};
		host.getPlaybackRate = () => state.speed;
		host.setPlaybackRate = (value) => {
			state.speed = value;
			video.playbackRate = value;
		};
		host.setVolume(seed.volumeBase);
		host.setMuted(seed.mediaMuted);
		host.setPlaybackRate(seed.speed);
		video.dispatchEvent(new Event('volumechange'));
		video.dispatchEvent(new Event('ratechange'));
	}, initial);
}

export function cappedPageMediaFixture(maximumSpeed: number): string {
	const script = `<script>
		(() => {
			const video = document.querySelector('#v');
			const host = video && video.parentElement;
			if (!video || !host) throw new Error('Capped page-media fixture is missing');
			const state = { speed: 1 };
			window.__spectraPageMediaState = state;
			host.getPlaybackRate = () => state.speed;
			host.setPlaybackRate = (value) => {
				state.speed = Math.min(value, ${JSON.stringify(maximumSpeed)});
				video.playbackRate = state.speed;
			};
			host.setPlaybackRate(1);
		})();
	</script>`;
	return FIXTURE_HTML.replace('</body>', `${script}\n</body>`);
}

export async function updatePageMediaControllerHarness(
	patch: Partial<Pick<PageMediaControllerState, 'volumeBase' | 'mediaMuted' | 'speed'>>,
): Promise<void> {
	await fixturePage.evaluate((changes) => {
		const video = document.querySelector<HTMLVideoElement>('#v');
		const host = video?.parentElement as (HTMLElement & {
			setVolume?: (value: number) => void;
			setMuted?: (value: boolean) => void;
			setPlaybackRate?: (value: number) => void;
		}) | null;
		if (!video || !host) throw new Error('Page-media controller fixture is missing');
		if (changes.volumeBase !== undefined) host.setVolume?.(changes.volumeBase);
		if (changes.mediaMuted !== undefined) host.setMuted?.(changes.mediaMuted);
		if (changes.speed !== undefined) host.setPlaybackRate?.(changes.speed);
		if (changes.volumeBase !== undefined || changes.mediaMuted !== undefined) {
			video.dispatchEvent(new Event('volumechange'));
		}
		if (changes.speed !== undefined) video.dispatchEvent(new Event('ratechange'));
	}, patch);
}

export async function readPageMediaControllerHarness(): Promise<PageMediaControllerState> {
	return fixturePage.evaluate(() => {
		const video = document.querySelector<HTMLVideoElement>('#v');
		const state = (window as Window & {
			__spectraPageMediaState?: {
				volumeBase: number;
				mediaMuted: boolean;
				speed: number;
			};
		}).__spectraPageMediaState;
		if (!video || !state) throw new Error('Page-media controller fixture is not installed');
		return {
			...state,
			domVolume: video.volume,
			domMuted: video.muted,
			domSpeed: video.playbackRate,
		};
	});
}

export async function removePageMediaControllerHarness(): Promise<void> {
	await fixturePage.evaluate(() => {
		const video = document.querySelector<HTMLVideoElement>('#v');
		const host = video?.parentElement;
		if (host) {
			for (const key of [
				'getVolume', 'setVolume', 'isMuted', 'setMuted', 'getPlaybackRate', 'setPlaybackRate',
			]) Reflect.deleteProperty(host, key);
		}
		Reflect.deleteProperty(window, '__spectraPageMediaState');
		if (!video) return;
		video.volume = 1;
		video.muted = false;
		video.playbackRate = 1;
		video.dispatchEvent(new Event('volumechange'));
		video.dispatchEvent(new Event('ratechange'));
	}).catch(() => undefined);
}

export async function readOffscreenSnapshot(worker?: WebWorker): Promise<OffscreenHostSnapshot> {
	const evaluate = worker
		? worker.evaluate.bind(worker)
		: evaluateServiceWorker;
	return evaluate(async () => {
		const deadline = Date.now() + 5_000;
		let response: unknown;
		while (Date.now() < deadline) {
			response = await chrome.runtime.sendMessage({
				target: 'offscreen',
				type: 'OFFSCREEN_HOST_HELLO',
			}).catch(() => undefined);
			if (response
				&& typeof response === 'object'
				&& Array.isArray((response as { audioTabs?: unknown }).audioTabs)
				&& Array.isArray((response as { remoteTabs?: unknown }).remoteTabs)) {
				return response;
			}
			await new Promise((resolveWait) => setTimeout(resolveWait, 10));
		}
		throw new Error(`Invalid offscreen host snapshot: ${JSON.stringify(response)}`);
	}) as Promise<OffscreenHostSnapshot>;
}

export async function hasOffscreenAudioTab(tabId: number): Promise<boolean> {
	return evaluateServiceWorker(async (targetTabId) => {
		const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
		if (contexts.length === 0) return false;
		const response = await chrome.runtime.sendMessage({
			target: 'offscreen',
			type: 'OFFSCREEN_HOST_HELLO',
		}).catch(() => undefined) as OffscreenHostSnapshot | undefined;
		return response?.audioTabs.some((entry) => entry.tabId === targetTabId) ?? false;
	}, tabId);
}

export async function openExtensionClient(path = 'popup.html'): Promise<Page> {
	const page = await browser.newPage();
	await page.goto(`chrome-extension://${extensionId}/${path}`, { waitUntil: 'domcontentloaded' });
	return page;
}

export async function sendExtensionMessage<T>(
	client: Page,
	message: Record<string, unknown>,
): Promise<T> {
	return client.evaluate(async (request) => chrome.runtime.sendMessage(
		{ ...request, requestId: crypto.randomUUID() },
	), message) as Promise<T>;
}

export async function readCurrentAudioSession(tabId: number): Promise<SmokeRpcResult<AudioSessionSnapshot | null>> {
	return evaluateServiceWorker(async (targetTabId) => {
		const [execution] = await chrome.scripting.executeScript({
			target: { tabId: targetTabId, frameIds: [0] },
			world: 'ISOLATED',
			func: async () => chrome.runtime.sendMessage({
				protocolVersion: 2,
				requestId: crypto.randomUUID(),
				type: 'spectra.audio.session.current',
				payload: {},
			}),
		});
		if (execution?.result === undefined) throw new Error('Current-document session read returned no result');
		return execution.result;
	}, tabId) as Promise<SmokeRpcResult<AudioSessionSnapshot | null>>;
}

export async function readExtensionSettings(client: Page): Promise<SettingsSnapshot> {
	const response = await sendExtensionMessage<SmokeRpcResult<SettingsSnapshot>>(client, {
		protocolVersion: 2,
		type: 'spectra.settings.get',
		payload: {},
	});
	if (!response.ok) throw new Error(response.error?.message ?? 'Unable to read settings');
	return response.data;
}

export async function readSiteRouteRegistry(client: Page): Promise<RegistrySnapshot> {
	const response = await sendExtensionMessage<SmokeRpcResult<RegistrySnapshot>>(client, {
		protocolVersion: 2,
		type: 'spectra.registry.get',
		payload: {},
	});
	if (!response.ok) throw new Error(response.error?.message ?? 'Unable to read site routes');
	return response.data;
}

export async function patchExtensionSettings(
	client: Page,
	patch: SettingsPatch,
): Promise<{ previous: SettingsSnapshot; current: SettingsSnapshot }> {
	const previous = await readExtensionSettings(client);
	const response = await sendExtensionMessage<SmokeRpcResult<SettingsSnapshot>>(client, {
		protocolVersion: 2,
		type: 'spectra.settings.patch',
		payload: { expectedRevision: previous.revision, patch },
	});
	if (!response.ok) throw new Error(response.error?.message ?? 'Unable to update settings');
	return { previous, current: response.data };
}

export async function replaceHotkeySite(
	client: Page,
	domain: string,
	value: SettingsSnapshot['hotkeySettings']['sites'][string] | null,
): Promise<{ previous: SettingsSnapshot; current: SettingsSnapshot }> {
	const previous = await readExtensionSettings(client);
	let current = (await patchExtensionSettings(client, {
		scope: 'hotkey-site-mutation',
		domain,
		mutation: { type: 'delete-site' },
	})).current;
	if (value) {
		current = (await patchExtensionSettings(client, {
			scope: 'hotkey-site-mutation',
			domain,
			mutation: { type: 'ensure-site', enabled: value.enabled },
		})).current;
		for (const binding of value.bindings) {
			current = (await patchExtensionSettings(client, {
				scope: 'hotkey-site-mutation',
				domain,
				mutation: { type: 'upsert-binding', binding },
			})).current;
		}
	}
	return { previous, current };
}

export async function setGlobalLanguage(client: Page, language: string): Promise<string> {
	const { previous } = await patchExtensionSettings(
		client,
		{ scope: 'global', changes: { lang: language } },
	);
	return previous.globalSettings.lang;
}

export async function setHotkeyTarget(client: Page, tabId: number | null): Promise<void> {
	const selected = await sendExtensionMessage<SmokeRpcResult<{ tabId: number | null }>>(client, {
		protocolVersion: 2, type: 'spectra.hotkey-target.set', payload: { tabId },
	});
	if (!selected?.ok || selected.data.tabId !== tabId) {
		throw new Error(selected?.error?.message ?? 'Unable to update the shortcut target');
	}
}

export async function openActionPopupTarget(timeoutMs = 10_000): Promise<Target> {
	const knownTargets = new Set(browser.targets());
	const popupUrl = `chrome-extension://${extensionId}/popup.html`;
	const targetPromise = browser.waitForTarget(
		(target) => !knownTargets.has(target)
			&& (target.url() === popupUrl || target.url().startsWith(`${popupUrl}?`)),
		{ timeout: timeoutMs },
	);
	try {
		await withDiagnosticTimeout(
			'open the real extension action popup',
			() => evaluateServiceWorker(async () => chrome.action.openPopup()),
			timeoutMs,
		);
		return await withDiagnosticTimeout(
			'discover the real extension action popup',
			() => targetPromise,
			timeoutMs,
		);
	} catch (error) {
		void targetPromise.catch(() => undefined);
		throw error;
	}
}

export async function readPopupVolumePresentation(
	expectedAccent?: string,
	expectedValue?: string,
): Promise<PopupVolumePresentation> {
	await fixturePage.bringToFront();
	const target = await openActionPopupTarget();
	const popup = await target.asPage();
	try {
		await popup.waitForSelector('.glass-card .vol-slider', { timeout: 8_000 });
		if (expectedAccent || expectedValue !== undefined) {
			await popup.waitForFunction((accent, val) => {
				const slider = document.querySelector<HTMLInputElement>('.vol-slider');
				if (!slider) return false;
				if (accent && getComputedStyle(slider).getPropertyValue('--slider-accent').trim() !== accent) {
					return false;
				}
				if (val !== undefined && slider.value !== val) {
					return false;
				}
				return true;
			}, { timeout: 8_000 }, expectedAccent, expectedValue).catch(async (error) => {
				const diagnostic = await popup.evaluate(async () => {
					const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
					const slider = document.querySelector<HTMLInputElement>('.vol-slider');
					if (!slider) throw new Error('Popup volume slider is missing');
					const request = (type: string, payload: Record<string, unknown>) => chrome.runtime.sendMessage({
						protocolVersion: 2,
						requestId: crypto.randomUUID(),
						tabId: tab?.id,
						type,
						payload,
					});
					const card = slider.closest<HTMLElement>('.glass-card');
					return {
						accent: getComputedStyle(slider)
							.getPropertyValue('--slider-accent').trim(),
						value: slider.value,
						card: card ? {
							controlCoverage: card.dataset.controlCoverage ?? null,
							lifecycleCoverage: card.dataset.lifecycleCoverage ?? null,
							syncStatus: card.querySelector('.control-sync-status')?.textContent ?? null,
							syncHidden: (card.querySelector('.control-sync-status') as HTMLElement | null)?.hidden ?? null,
							volume: card.querySelector('.vol-number')?.textContent ?? null,
							tabId: card.dataset.tabId ?? null,
						} : null,
						session: tab?.id ? await request('spectra.audio.session.get', { tabId: tab.id }) : null,
						control: tab?.id ? await request('spectra.control.snapshot.get', { tabId: tab.id }) : null,
					};
				});
				throw new Error(`Popup presentation did not reach accent=${expectedAccent} value=${expectedValue}: ${JSON.stringify(diagnostic)}`, {
					cause: error,
				});
			});
		}
		return await popup.evaluate(() => {
			const sliders = [...document.querySelectorAll<HTMLInputElement>('.vol-slider')];
			const slider = sliders[0];
			const fill = document.querySelector<HTMLElement>('.slider-fill');
			const value = document.querySelector<HTMLElement>('.vol-number');
			if (!slider || !fill || !value) throw new Error('Popup volume presentation is incomplete');
			return {
				sliderCount: sliders.length,
				min: slider.min,
				max: slider.max,
				value: slider.value,
				fillColor: getComputedStyle(fill).backgroundColor,
				valueColor: getComputedStyle(value).color,
				sliderAccent: getComputedStyle(slider).getPropertyValue('--slider-accent').trim(),
			};
		});
	} finally {
		await closeActionPopup(popup);
	}
}

export async function closeActionPopup(popup: Page): Promise<void> {
	const popupTarget = popup.target();
	if (!popup.isClosed()) {
		// Let the real action-popup lifecycle dispatch blur/pagehide so analyser
		// leases reach the worker before CDP destroys the target.
		await popup.evaluate(() => window.close()).catch(() => undefined);
		await eventually(
			async () => popup.isClosed(),
			(closed) => closed,
			'action popup close',
			1_000,
		).catch(() => undefined);
		if (!popup.isClosed()) await popup.close();
	}
	await eventually(
		async () => browser.targets().includes(popupTarget),
		(present) => !present,
		'action popup target retirement',
		2_000,
	);
}

export async function submitEffectiveVolume(tabId: number, value: number): Promise<void> {
	const response = await sendFromActionPopup<{
		ok: boolean;
		error?: { message?: string };
	}>({
		protocolVersion: 2,
		tabId,
		type: 'spectra.control.operation.submit',
		payload: {
			tabId,
			source: 'popup',
			target: null,
			operation: 'effective-volume',
			payload: { operation: 'set', value },
		},
	});
	if (!response.ok) throw new Error(response.error?.message ?? `Unable to set effective volume to ${value}`);
}

export async function submitPopupControlIntent(
	tabId: number,
	intent: Record<string, unknown>,
): Promise<SmokeRpcResult<{
	fields: Record<string, { actual?: unknown; phase?: string; strategy?: string }>;
}>> {
	return sendFromActionPopup({
		protocolVersion: 2,
		tabId,
		type: 'spectra.control.intent.submit',
		payload: {
			tabId,
			source: 'popup',
			requestedCoverage: 'active-target',
			target: null,
			...intent,
		},
	});
}

export async function readBadgeColor(tabId: number): Promise<number[]> {
	return evaluateServiceWorker(
		async (targetTabId) => chrome.action.getBadgeBackgroundColor({ tabId: targetTabId }),
		tabId,
	) as Promise<number[]>;
}

export async function readBadgeText(tabId: number): Promise<string> {
	return evaluateServiceWorker(
		async (targetTabId) => chrome.action.getBadgeText({ tabId: targetTabId }),
		tabId,
	) as Promise<string>;
}

export async function sendFromActionPopup<T>(message: Record<string, unknown>): Promise<T> {
	let popup: Page | null = null;
	let popupClient: CDPSession | null = null;
	try {
		const target = await openActionPopupTarget();
		const popupPage = await target.asPage();
		if (!popupPage) throw new Error('Unable to attach to the real extension action popup page');
		popup = popupPage;
		const attachedClient = await withDiagnosticTimeout(
			'attach to the real extension action popup',
			() => popupPage.createCDPSession(),
			10_000,
		);
		popupClient = attachedClient;
		await attachedClient.send('Runtime.enable');
		const serializedMessage = JSON.stringify(message);
		const evaluation = await withDiagnosticTimeout(
			'send remote request from the real extension action popup',
			() => attachedClient.send('Runtime.evaluate', {
				expression: `(async () => {
					const request = ${serializedMessage};
					request.requestId = crypto.randomUUID();
					return chrome.runtime.sendMessage(request);
				})()`,
				awaitPromise: true,
				returnByValue: true,
			}),
			15_000,
		);
		if (evaluation.exceptionDetails) {
			throw new Error(
				evaluation.exceptionDetails.exception?.description
					?? evaluation.exceptionDetails.text
					?? 'Action popup request evaluation failed',
			);
		}
		return evaluation.result.value as T;
	} finally {
		if (popup) await closeActionPopup(popup);
		else await popupClient?.send('Runtime.evaluate', { expression: 'close()' }).catch(() => undefined);
		await popupClient?.detach().catch(() => undefined);
	}
}

export async function installVisualizerBatchProbe(): Promise<void> {
	await evaluateServiceWorker(() => {
		type ProbeEvent = {
			payload: unknown;
			senderTabId: number | null;
			senderUrl: string | null;
		};
		type Probe = {
			count: number;
			events: ProbeEvent[];
			listener: (message: unknown, sender: chrome.runtime.MessageSender) => void;
		};
		const scope = globalThis as typeof globalThis & { __spectraVisualizerProbe?: Probe };
		if (scope.__spectraVisualizerProbe) {
			chrome.runtime.onMessage.removeListener(scope.__spectraVisualizerProbe.listener);
		}
		const probe: Probe = {
			count: 0,
			events: [],
			listener(message: unknown, sender: chrome.runtime.MessageSender) {
				if (message && typeof message === 'object'
					&& (message as { type?: unknown }).type === 'spectra.audio.visualizer.batch') {
					probe.count++;
					probe.events.push({
						payload: (message as { payload?: unknown }).payload,
						senderTabId: sender.tab?.id ?? null,
						senderUrl: sender.url ?? null,
					});
				}
			},
		};
		scope.__spectraVisualizerProbe = probe;
		chrome.runtime.onMessage.addListener(probe.listener);
	});
}

export async function readVisualizerBatchProbe(): Promise<{
	count: number;
	events: Array<{ payload: unknown; senderTabId: number | null; senderUrl: string | null }>;
}> {
	return evaluateServiceWorker(() => {
		return (globalThis as typeof globalThis & {
			__spectraVisualizerProbe?: {
				count: number;
				events: Array<{ payload: unknown; senderTabId: number | null; senderUrl: string | null }>;
			};
		}).__spectraVisualizerProbe ?? { count: 0, events: [] };
	});
}

export async function readVisualizerBatchCount(): Promise<number> {
	return (await readVisualizerBatchProbe()).count;
}

export async function removeVisualizerBatchProbe(): Promise<void> {
	await evaluateServiceWorker(() => {
		type Probe = { count: number; listener: (message: unknown) => void };
		const scope = globalThis as typeof globalThis & { __spectraVisualizerProbe?: Probe };
		if (!scope.__spectraVisualizerProbe) return;
		chrome.runtime.onMessage.removeListener(scope.__spectraVisualizerProbe.listener);
		delete scope.__spectraVisualizerProbe;
	}).catch(() => undefined);
}

export async function sendCaptureRequest(
	_client: Page,
	tabId: number,
	enabled: boolean,
	generation: number,
	config: AudioConfig = DEFAULT_AUDIO_CONFIG,
): Promise<CaptureResponse> {
	return evaluateServiceWorker(async (request) => {
		const [injection] = await chrome.scripting.executeScript({
			target: { tabId: request.tabId },
			world: 'ISOLATED',
			func: async (value: typeof request) => chrome.runtime.sendMessage({
				protocolVersion: 2,
				requestId: crypto.randomUUID(),
				tabId: value.tabId,
				generation: value.generation,
				type: 'spectra.audio.capture.set',
				payload: { enabled: value.enabled, config: value.config },
			}),
			args: [request],
		});
		if (injection?.result === undefined) throw new Error('Capture caller returned no result');
		return injection.result;
	}, { tabId, enabled, generation, config }) as Promise<CaptureResponse>;
}

export async function configureRuntime(
	url: string,
	config: AudioConfig,
	worker?: WebWorker,
): Promise<ContentStatus> {
	await acquireSmokeRuntime(url);
	const evaluate = worker
		? worker.evaluate.bind(worker)
		: evaluateServiceWorker;
	return evaluate(async ({ targetUrl, nextConfig }: { targetUrl: string; nextConfig: AudioConfig }) => {
		const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === targetUrl);
		if (tab?.id === undefined) throw new Error(`Unable to find runtime tab: ${targetUrl}`);
		const response = await chrome.tabs.sendMessage(tab.id, {
			protocolVersion: 2,
			requestId: crypto.randomUUID(),
			tabId: tab.id,
			type: 'spectra.audio.runtime.configure',
			payload: { config: nextConfig },
		});
		if (!response?.ok) throw new Error(response?.error?.message ?? 'Unable to configure runtime');
		return { ...response.data, mode: response.data.actualMode };
	}, { targetUrl: url, nextConfig: config }) as Promise<ContentStatus>;
}

export async function getOffscreenTarget(): Promise<Target> {
	return browser.waitForTarget(
		(target) => target.url() === `chrome-extension://${extensionId}/offscreen.html`,
		{ timeout: 10_000 },
	);
}

export async function evaluateOffscreen<T>(expression: string): Promise<T> {
	const target = await getOffscreenTarget();
	const client = await target.createCDPSession();
	try {
		await client.send('Runtime.enable');
		const evaluation = await client.send('Runtime.evaluate', {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (evaluation.exceptionDetails) {
			throw new Error(evaluation.exceptionDetails.exception?.description ?? 'Offscreen evaluation failed');
		}
		return evaluation.result.value as T;
	} finally {
		await client.detach().catch(() => undefined);
	}
}

export async function readOffscreenPeerRuntimeProbe(): Promise<PeerRuntimeProbe> {
	return evaluateOffscreen<PeerRuntimeProbe>(`(() => {
		const scope = globalThis;
		const probe = scope.__spectraSmokePeerRuntimeProbe;
		return {
			peerType: typeof scope.Peer,
			vendorAssignments: probe?.vendorAssignments ?? 0,
			peerConstructions: probe?.peerConstructions ?? 0,
			peerDestructions: probe?.peerDestructions ?? 0,
		};
	})()`);
}

export function locatePeerRuntimeBreakpoint(): PeerRuntimeBreakpoint {
	const offscreenSource = readFileSync(join(EXTENSION_DIR, 'offscreen.js'), 'utf8');
	const runtimeImport = /import\("(\.\/chunks\/[^"\r\n]*runtime-[^"\r\n]+\.js)"\)/u
		.exec(offscreenSource)?.[1];
	// Production splits the deferred Remote owner into a chunk; the development
	// build keeps the same owner in offscreen.js. Resolve the physical owner from
	// the emitted graph instead of assuming one build topology.
	const runtimeRelativePath = runtimeImport?.replace(/^\.\//u, '') ?? 'offscreen.js';
	const runtimeSource = runtimeImport
		? readFileSync(join(EXTENSION_DIR, runtimeRelativePath), 'utf8')
		: offscreenSource;
	const unavailableMessage = runtimeSource.indexOf('Local PeerJS vendor runtime is unavailable');
	if (unavailableMessage < 0) throw new Error('PeerJS runtime constructor guard was not found');
	const constructorReturn = /return\s+new\s+([A-Za-z_$][\w$]*)\s*\(/u.exec(
		runtimeSource.slice(unavailableMessage, unavailableMessage + 1_024),
	);
	if (!constructorReturn || constructorReturn.index === undefined) {
		throw new Error('PeerJS runtime constructor call was not found');
	}
	const offset = unavailableMessage + constructorReturn.index;
	const prefix = runtimeSource.slice(0, offset);
	const lineNumber = prefix.split('\n').length - 1;
	const lastLineBreak = prefix.lastIndexOf('\n');
	return {
		url: `chrome-extension://${extensionId}/${runtimeRelativePath.replaceAll('\\', '/')}`,
		lineNumber,
		columnNumber: offset - lastLineBreak - 1,
		constructorBinding: constructorReturn[1],
	};
}

export async function installOffscreenPeerRuntimeProbe(
	forceReady = false,
	onVendorRequest?: () => void,
): Promise<void> {
	void forceReady;
	const installed = await evaluateOffscreen<boolean>(`(() => {
		const scope = globalThis;
		if (scope.__spectraSmokePeerRuntimeProbe) return true;
		if (typeof scope.Peer !== 'undefined') return false;
		const probe = {
			vendorAssignments: 0,
			peerConstructions: 0,
			peerDestructions: 0,
			peers: new Map(),
			connections: new Map(),
			nextConnectionId: 1,
		};
		class FakeConnection {
			constructor(id, peer, metadata) {
				this.connectionId = id;
				this.peer = peer;
				this.metadata = metadata;
				this.open = false;
				this.listeners = new Map();
				this.sent = [];
			}
			on(type, listener) {
				const listeners = this.listeners.get(type) ?? [];
				listeners.push(listener);
				this.listeners.set(type, listeners);
				return this;
			}
			emit(type, value) {
				for (const listener of this.listeners.get(type) ?? []) listener(value);
			}
			send(value) {
				this.sent.push(structuredClone(value));
			}
			deliver(value) {
				this.emit('data', structuredClone(value));
			}
			close() {
				if (!this.open) return;
				this.open = false;
				this.emit('close');
			}
		}
		class FakePeer {
			constructor(id) {
				this.id = id;
				this.listeners = new Map();
				const activeProbe = scope.__spectraSmokePeerRuntimeProbe;
				activeProbe.peerConstructions += 1;
				activeProbe.peers.set(id, this);
				queueMicrotask(() => {
					for (const listener of this.listeners.get('open') ?? []) listener(this.id);
				});
			}
			on(type, listener) {
				const listeners = this.listeners.get(type) ?? [];
				listeners.push(listener);
				this.listeners.set(type, listeners);
				return this;
			}
			emit(type, value) {
				for (const listener of this.listeners.get(type) ?? []) listener(value);
			}
			destroy() {
				const activeProbe = scope.__spectraSmokePeerRuntimeProbe;
				activeProbe.peerDestructions += 1;
				activeProbe.peers.delete(this.id);
			}
		}
		probe.peerConstructor = FakePeer;
		probe.openConnection = (peerId, metadata) => {
			const peer = probe.peers.get(peerId);
			if (!peer) throw new Error('Fake Peer host is unavailable');
			const connectionId = 'connection-' + probe.nextConnectionId++;
			const connection = new FakeConnection(connectionId, 'spectra-smoke-remote', metadata);
			probe.connections.set(connectionId, connection);
			peer.emit('connection', connection);
			connection.open = true;
			connection.emit('open');
			return connectionId;
		};
		probe.readMessages = (connectionId) => (
			probe.connections.get(connectionId)?.sent.map((value) => structuredClone(value)) ?? []
		);
		probe.deliver = (connectionId, value) => {
			const connection = probe.connections.get(connectionId);
			if (!connection?.open) throw new Error('Fake Peer connection is unavailable');
			connection.deliver(value);
		};
		scope.__spectraSmokePeerRuntimeProbe = probe;
		return typeof scope.Peer === 'undefined';
	})()`);
	if (!installed) throw new Error('Unable to install the offscreen Peer runtime probe');
	const existingProbe = await readOffscreenPeerRuntimeProbe();
	if (existingProbe.peerConstructions > 0) return;
	await peerRuntimeDebugClient?.detach().catch(() => undefined);
	peerRuntimeDebugClient = await (await getOffscreenTarget()).createCDPSession();
	const vendorUrl = `chrome-extension://${extensionId}/peerjs-vendor.js`;
	const runtimeBreakpoint = locatePeerRuntimeBreakpoint();
	await peerRuntimeDebugClient.send('Network.enable');
	peerRuntimeDebugClient.on('Network.requestWillBeSent', (event) => {
		if (event.request.url === vendorUrl) onVendorRequest?.();
	});
	await peerRuntimeDebugClient.send('Debugger.enable');
	let runtimeBreakpointId = '';
	peerRuntimeDebugClient.on('Debugger.paused', async (event) => {
		const client = peerRuntimeDebugClient;
		if (!client) return;
		try {
			const callFrame = event.callFrames[0];
			peerRuntimeDebugEvents.push(`paused:${event.reason}:${callFrame?.url ?? ''}`);
			if (callFrame && event.hitBreakpoints.includes(runtimeBreakpointId)) {
				const injected = await client.send('Debugger.evaluateOnCallFrame', {
					callFrameId: callFrame.callFrameId,
					expression: `${runtimeBreakpoint.constructorBinding}`
						+ '=globalThis.__spectraSmokePeerRuntimeProbe.peerConstructor',
					returnByValue: true,
				});
				if (injected.exceptionDetails) {
					throw new Error(injected.exceptionDetails.text ?? 'Peer constructor injection failed');
				}
				peerRuntimeDebugEvents.push('injected');
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			// Target/session teardown is expected while the offscreen document closes;
			// every other execution-boundary failure must reach the final smoke assertion.
			if (!/closed|detached|not attached/iu.test(message)) {
				fixtureErrors.push(`PeerJS vendor execution substitution failed: ${message}`);
			}
		} finally {
			await client.send('Debugger.resume').catch(() => undefined);
		}
	});
	const breakpoint = await peerRuntimeDebugClient.send('Debugger.setBreakpointByUrl', {
		lineNumber: runtimeBreakpoint.lineNumber,
		columnNumber: runtimeBreakpoint.columnNumber,
		url: runtimeBreakpoint.url,
	});
	runtimeBreakpointId = breakpoint.breakpointId;
	peerRuntimeDebugEvents.push(`breakpoint:${breakpoint.breakpointId}:${breakpoint.locations.length}`);
}

export async function openOffscreenTestRemote(session: RemotePublicSession): Promise<string> {
	const input = JSON.stringify({
		peerId: session.peerId,
		metadata: { protocolVersion: 3, sessionId: session.sessionId },
	});
	return evaluateOffscreen<string>(`(() => {
		const probe = globalThis.__spectraSmokePeerRuntimeProbe;
		if (!probe?.openConnection) throw new Error('Offscreen Peer harness is unavailable');
		const input = ${input};
		return probe.openConnection(input.peerId, input.metadata);
	})()`);
}

export async function readOffscreenTestRemoteMessages(
	connectionId: string,
): Promise<Array<Record<string, unknown>>> {
	return evaluateOffscreen<Array<Record<string, unknown>>>(`(() => {
		const probe = globalThis.__spectraSmokePeerRuntimeProbe;
		if (!probe?.readMessages) throw new Error('Offscreen Peer harness is unavailable');
		return probe.readMessages(${JSON.stringify(connectionId)});
	})()`);
}

export async function deliverOffscreenTestRemote(
	connectionId: string,
	message: Record<string, unknown>,
): Promise<void> {
	await evaluateOffscreen<void>(`(() => {
		const probe = globalThis.__spectraSmokePeerRuntimeProbe;
		if (!probe?.deliver) throw new Error('Offscreen Peer harness is unavailable');
		probe.deliver(${JSON.stringify(connectionId)}, ${JSON.stringify(message)});
	})()`);
}

export async function detachOffscreenPeerRuntimeDebugger(): Promise<void> {
	await peerRuntimeDebugClient?.detach().catch(() => undefined);
	peerRuntimeDebugClient = null;
}

export async function restoreOffscreenPeerRuntimeProbe(): Promise<void> {
	await detachOffscreenPeerRuntimeDebugger();
	if (!browser?.targets().some((target) => (
		target.url() === `chrome-extension://${extensionId}/offscreen.html`
	))) return;
	await evaluateOffscreen<boolean>(`(() => {
		const scope = globalThis;
		const probe = scope.__spectraSmokePeerRuntimeProbe;
		if (!probe) return false;
		delete scope.__spectraSmokePeerRuntimeProbe;
		return true;
	})()`);
}

export async function installTabCaptureStreamIdStub(worker?: WebWorker): Promise<void> {
	const evaluate = worker
		? worker.evaluate.bind(worker)
		: evaluateServiceWorker;
	const installed = await evaluate(() => {
		const api = chrome.tabCapture as typeof chrome.tabCapture & {
			__spectraSmokeOriginalGetMediaStreamId?: typeof chrome.tabCapture.getMediaStreamId;
		};
		api.__spectraSmokeOriginalGetMediaStreamId ??= api.getMediaStreamId.bind(api);
		const stub: typeof chrome.tabCapture.getMediaStreamId = (_options, callback) => {
			callback('spectra-smoke-stream-id');
		};
		try {
			Object.defineProperty(api, 'getMediaStreamId', { configurable: true, value: stub });
		} catch {
			api.getMediaStreamId = stub;
		}
		return api.getMediaStreamId === stub;
	});
	if (!installed) throw new Error('Unable to install the test-only tabCapture stream-id stub');
}

export async function ensureOffscreenHostForSyntheticHarness(): Promise<void> {
	if (await getOffscreenContextCount() > 0) return;
	// The synthetic getUserMedia harness must exist before production Capture
	// acquires its lease. Create only the shared document here; product Capture
	// remains the owner of the first real lease and every subsequent message.
	// This fixture must not acquire a Remote lease through public PeerJS merely
	// to prepare an unrelated audio test.
	await evaluateServiceWorker(async () => {
		await chrome.offscreen.createDocument({
			url: 'offscreen.html',
			reasons: ['USER_MEDIA', 'WEB_RTC'] as chrome.offscreen.Reason[],
			justification: 'SPECTRA installed-Chromium synthetic capture harness',
		});
	});
	await eventually(
		getOffscreenContextCount,
		(count) => count === 1,
		'offscreen host for the synthetic capture harness',
	);
}

export async function installSyntheticCaptureHarness(): Promise<void> {
	await ensureOffscreenHostForSyntheticHarness();
	const installed = await evaluateOffscreen<boolean>(`(() => {
		const scope = globalThis;
		if (scope.__spectraSmokeCaptureHarness) return true;
		const OriginalAudioContext = scope.AudioContext;
		const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
		const state = {
			calls: 0,
			blockNext: false,
			releaseNext: null,
			processorContexts: [],
			fixtures: [],
			originalGetUserMedia,
			OriginalAudioContext,
		};
		scope.__spectraSmokeCaptureHarness = state;
		scope.AudioContext = new Proxy(OriginalAudioContext, {
			construct(target, args) {
				const context = Reflect.construct(target, args, target);
				state.processorContexts.push(context);
				return context;
			},
		});
		Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
			configurable: true,
			value: async (constraints) => {
				const mandatory = constraints && constraints.audio && constraints.audio.mandatory;
				if (!mandatory || mandatory.chromeMediaSource !== 'tab') {
					return originalGetUserMedia(constraints);
				}
				state.calls += 1;
				if (state.blockNext) {
					state.blockNext = false;
					await new Promise((resolve) => { state.releaseNext = resolve; });
					state.releaseNext = null;
				}
				const context = new OriginalAudioContext();
				const oscillator = context.createOscillator();
				const destination = context.createMediaStreamDestination();
				oscillator.connect(destination);
				oscillator.start();
				if (context.state === 'suspended') await context.resume();
				state.fixtures.push({ context, oscillator, stream: destination.stream });
				return destination.stream;
			},
		});
		return true;
	})()`);
	if (!installed) throw new Error('Unable to install the synthetic offscreen capture harness');
}

export async function readSyntheticCaptureState(): Promise<SyntheticCaptureState> {
	return evaluateOffscreen<SyntheticCaptureState>(`(() => {
		const state = globalThis.__spectraSmokeCaptureHarness;
		if (!state) throw new Error('Synthetic capture harness is not installed');
		return {
			calls: state.calls,
			pending: typeof state.releaseNext === 'function',
			processorStates: state.processorContexts.map((context) => context.state),
		};
	})()`);
}

export async function releaseSyntheticCapture(): Promise<void> {
	await evaluateOffscreen<boolean>(`(() => {
		const release = globalThis.__spectraSmokeCaptureHarness?.releaseNext;
		if (typeof release === 'function') release();
		return true;
	})()`);
}

export async function cleanupSyntheticCaptureHarness(): Promise<void> {
	if (!browser?.targets().some((target) => (
		target.url() === `chrome-extension://${extensionId}/offscreen.html`
	))) return;
	await evaluateOffscreen<boolean>(`(async () => {
		const state = globalThis.__spectraSmokeCaptureHarness;
		if (!state) return true;
		if (typeof state.releaseNext === 'function') state.releaseNext();
		for (const fixture of state.fixtures) {
			try { fixture.oscillator.stop(); } catch {}
			for (const track of fixture.stream.getTracks()) track.stop();
			try { await fixture.context.close(); } catch {}
		}
		return true;
	})()`).catch(() => undefined);
}

export async function inspectContentRuntime(tabId: number, saveRuntime = false): Promise<ContentRuntimeProbe> {
	return evaluateServiceWorker(async ({ targetTabId, shouldSave }) => {
		const [injection] = await chrome.scripting.executeScript({
			target: { tabId: targetTabId },
			world: 'ISOLATED',
			func: (save) => {
				const scope = window as Window & {
					__SPECTRA_CONTENT_RUNTIME__?: { revision?: string; disposed?: boolean };
					__SPECTRA_LISTENERS_READY__?: boolean;
					__spectraSmokeRuntime?: { disposed?: boolean };
				};
				const runtime = scope.__SPECTRA_CONTENT_RUNTIME__;
				if (save) {
					scope.__spectraSmokeRuntime = runtime;
				}
				return {
					listenersReady: scope.__SPECTRA_LISTENERS_READY__ === true,
					runtimeRevision: runtime?.revision ?? null,
					sameRuntime: scope.__spectraSmokeRuntime
						? scope.__spectraSmokeRuntime === runtime
						: null,
					oldRuntimeDisposed: scope.__spectraSmokeRuntime
						? scope.__spectraSmokeRuntime.disposed === true
						: null,
				};
			},
			args: [shouldSave],
		});
		if (!injection?.result) throw new Error('Unable to inspect the isolated Content runtime');
		return injection.result;
	}, { targetTabId: tabId, shouldSave: saveRuntime }) as Promise<ContentRuntimeProbe>;
}

export async function reinjectContent(tabId: number): Promise<void> {
	await evaluateServiceWorker(async (targetTabId) => {
		await chrome.scripting.executeScript({
			target: { tabId: targetTabId },
			world: 'ISOLATED',
			files: ['content-runtime.js'],
		});
	}, tabId);
}

export function describeServiceWorkerTargets(): string {
	const expectedUrl = `chrome-extension://${extensionId}/background.js`;
	const targets = browser.targets()
		.filter((target) => (
			target.type() === 'service_worker'
			|| target.url() === expectedUrl
			|| target.url().startsWith(`chrome-extension://${extensionId}/`)
		))
		.map((target) => `${target.type()}:${target.url() || '<empty>'}`);
	return targets.length > 0 ? targets.join(', ') : '<none>';
}

export async function withDiagnosticTimeout<T>(
	label: string,
	operation: () => Promise<T>,
	timeoutMs = 10_000,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			operation(),
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error(
					`${label} timed out after ${timeoutMs}ms; service-worker targets: ${describeServiceWorkerTargets()}`,
				)), timeoutMs);
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

export async function waitForWorkerVersion(
	client: CDPSession,
	predicate: (version: { scriptURL: string; runningStatus: string; versionId: string; registrationId: string }) => boolean,
	timeoutMs = 10_000,
): Promise<{ scriptURL: string; runningStatus: string; versionId: string; registrationId: string }> {
	return new Promise((resolveVersion, reject) => {
		const timer = setTimeout(() => {
			client.off('ServiceWorker.workerVersionUpdated', onUpdate);
			reject(new Error('Timed out waiting for the SPECTRA service-worker version update'));
		}, timeoutMs);
		const onUpdate = (event: { versions: Array<{ scriptURL: string; runningStatus: string; versionId: string; registrationId: string }> }) => {
			const version = event.versions.find(predicate);
			if (!version) return;
			clearTimeout(timer);
			client.off('ServiceWorker.workerVersionUpdated', onUpdate);
			resolveVersion(version);
		};
		client.on('ServiceWorker.workerVersionUpdated', onUpdate);
	});
}

export async function refreshServiceWorkerHandle(
	previousMarker?: string,
	timeoutMs = 10_000,
): Promise<void> {
	const expectedUrl = `chrome-extension://${extensionId}/background.js`;
	await serviceWorkerConnection?.disconnect().catch(() => undefined);
	serviceWorkerConnection = null;

	// Chrome reuses the service-worker target id across stop/start. Puppeteer's
	// WorkerTarget caches its first WebWorker forever, so target.worker() on the
	// launch connection keeps pointing at the destroyed execution context. A
	// fresh browser connection gives this harness a fresh WorkerTarget/session
	// without relaunching Chrome or disturbing the extension pages.
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown;
	for (let attempt = 1; attempt <= 3 && Date.now() < deadline; attempt += 1) {
		let connection: Browser | null = null;
		const stageTimeout = () => Math.max(250, Math.min(5_000, deadline - Date.now()));
		try {
			const freshConnection = await withDiagnosticTimeout(
				`connect replacement service-worker session (attempt ${attempt})`,
				() => puppeteer.connect({ browserWSEndpoint: browser.wsEndpoint() }),
				stageTimeout(),
			);
			connection = freshConnection;
			const existing = freshConnection.targets().find(
				(candidate) => candidate.type() === 'service_worker' && candidate.url() === expectedUrl,
			);
			const target = existing ?? await withDiagnosticTimeout(
				`discover replacement service-worker target (attempt ${attempt})`,
				() => freshConnection.waitForTarget(
					(candidate) => candidate.type() === 'service_worker' && candidate.url() === expectedUrl,
					{ timeout: stageTimeout() },
				),
				stageTimeout(),
			);
			const worker = await withDiagnosticTimeout(
				`resolve replacement service-worker target (attempt ${attempt})`,
				() => target.worker(),
				stageTimeout(),
			);
			if (!worker) throw new Error('Replacement service-worker target has no execution context');
			const identity = await withDiagnosticTimeout(
				`probe replacement service-worker identity (attempt ${attempt})`,
				() => worker.evaluate(() => ({
					runtimeId: chrome.runtime.id,
					marker: (globalThis as typeof globalThis & {
						__spectraSmokeWorkerMarker?: string;
					}).__spectraSmokeWorkerMarker,
				})),
				stageTimeout(),
			);
			if (identity.runtimeId !== extensionId) {
				throw new Error(`Replacement worker belongs to unexpected extension ${identity.runtimeId}`);
			}
			if (previousMarker !== undefined && identity.marker === previousMarker) {
				throw new Error('Replacement worker retained the stopped execution-context marker');
			}
			serviceWorkerConnection = connection;
			serviceWorkerTarget = target;
			serviceWorker = worker;
			return;
		} catch (error) {
			lastError = error;
			await connection?.disconnect().catch(() => undefined);
		}
	}
	throw new Error('Unable to acquire a fresh replacement service-worker execution context', {
		cause: lastError,
	});
}

export async function waitForServiceWorkerMarkerToDisappear(marker: string, timeoutMs = 10_000): Promise<void> {
	const expectedUrl = `chrome-extension://${extensionId}/background.js`;
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		let oldContextAlive = false;
		for (const target of browser.targets()) {
			if (target.type() !== 'service_worker' || target.url() !== expectedUrl) continue;
			const worker = await withDiagnosticTimeout(
				'resolve stopping service-worker target',
				() => target.worker(),
				1_000,
			).catch(() => null);
			if (!worker) continue;
			const currentMarker = await withDiagnosticTimeout(
				'probe stopping service-worker marker',
				() => worker.evaluate(() => (
					(globalThis as typeof globalThis & { __spectraSmokeWorkerMarker?: string })
						.__spectraSmokeWorkerMarker
				)),
				1_000,
			).catch(() => undefined);
			if (currentMarker === marker) {
				oldContextAlive = true;
				break;
			}
		}
		if (!oldContextAlive) return;
		await new Promise((resolveWait) => setTimeout(resolveWait, 10));
	}
	throw new Error('Timed out waiting for the old SPECTRA service-worker context to stop');
}

export async function restartServiceWorker(): Promise<void> {
	let stage = 'mark current worker';
	const workerScriptUrl = `chrome-extension://${extensionId}/background.js`;
	let previousMarker = '';
	let client: CDPSession | null = null;
	try {
		previousMarker = await withDiagnosticTimeout(stage, () => evaluateServiceWorker(() => {
			const marker = crypto.randomUUID();
			(globalThis as typeof globalThis & { __spectraSmokeWorkerMarker?: string })
				.__spectraSmokeWorkerMarker = marker;
			return marker;
		}));

		stage = 'create page CDP session';
		const activeClient = await withDiagnosticTimeout(stage, () => fixturePage.createCDPSession());
		client = activeClient;
		stage = 'enable service-worker domain';
		const initialVersion = await withDiagnosticTimeout(stage, async () => {
			const initialVersionPromise = waitForWorkerVersion(
				activeClient,
				(version) => version.scriptURL === workerScriptUrl && version.runningStatus === 'running',
			);
			const [, version] = await Promise.all([
				activeClient.send('ServiceWorker.enable'),
				initialVersionPromise,
			]);
			return version;
		}, 12_000);

		stage = 'stop service worker';
		await withDiagnosticTimeout(stage, async () => {
			const stoppedPromise = waitForWorkerVersion(
				activeClient,
				(version) => version.versionId === initialVersion.versionId && version.runningStatus === 'stopped',
			);
			await Promise.all([
				activeClient.send('ServiceWorker.stopWorker', { versionId: initialVersion.versionId }),
				stoppedPromise,
			]);
		}, 12_000);
		stage = 'observe old worker shutdown';
		await withDiagnosticTimeout(stage, () => waitForServiceWorkerMarkerToDisappear(previousMarker), 12_000);

		stage = 'start service worker';
		await withDiagnosticTimeout(stage, () => activeClient.send('ServiceWorker.startWorker', {
			scopeURL: `chrome-extension://${extensionId}/`,
		}));
		stage = 'reacquire replacement worker through a fresh target session';
		await withDiagnosticTimeout(
			stage,
			() => refreshServiceWorkerHandle(previousMarker, 15_000),
			17_000,
		);
		const replacementRuntimeId = await withDiagnosticTimeout(
			'probe reacquired replacement worker',
			() => serviceWorker.evaluate(() => chrome.runtime.id),
			5_000,
		);
		if (replacementRuntimeId !== extensionId) {
			throw new Error(`Replacement worker belongs to unexpected extension ${replacementRuntimeId}`);
		}
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Service-worker restart failed during ${stage}: ${detail}`, { cause: error });
	} finally {
		const clientToClose = client;
		if (clientToClose) {
			await withDiagnosticTimeout(
				'disable service-worker CDP domain',
				() => clientToClose.send('ServiceWorker.disable'),
				2_000,
			).catch(() => undefined);
			await withDiagnosticTimeout(
				'detach service-worker CDP session',
				() => clientToClose.detach(),
				2_000,
			).catch(() => undefined);
		}
	}
}

export async function readRestartedWorkerState(): Promise<{
	settings: unknown;
	contextCount: number;
	status: unknown;
}> {
	const extensionClient = await browser.newPage();
	try {
		await extensionClient.goto(`chrome-extension://${extensionId}/popup.html`, {
			waitUntil: 'domcontentloaded',
		});
		return await extensionClient.evaluate(async ({ fixture }) => {
			const settings = await chrome.runtime.sendMessage({
				protocolVersion: 2,
				requestId: crypto.randomUUID(),
				type: 'spectra.settings.get',
				payload: {},
			});
			const contexts = await chrome.runtime.getContexts({
				contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
			});
			const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === fixture);
			if (tab?.id === undefined) throw new Error(`Unable to find restarted fixture tab: ${fixture}`);
			const status = await chrome.tabs.sendMessage(tab.id, {
				protocolVersion: 2,
				requestId: crypto.randomUUID(),
				tabId: tab.id,
				type: 'spectra.audio.runtime.get',
				payload: {},
			});
			return { settings, contextCount: contexts.length, status };
		}, { fixture: fixturePage.url() });
	} finally {
		await extensionClient.close();
	}
}

export function remotePairingUrl(session: RemotePublicSession, secret = session.secret): string {
	const fragment = new URLSearchParams({
		v: String(session.protocolVersion),
		s: session.sessionId,
		p: session.peerId,
		k: secret,
		e: String(session.pairingExpiresAt),
	});
	return `${new URL(fixtureUrl).origin}/remote/#${fragment.toString()}`;
}

export async function installRemotePagePeerHarness(
	page: Page,
	session: RemotePublicSession,
): Promise<void> {
	await page.setRequestInterception(true);
	page.on('request', (request) => {
		if (new URL(request.url()).pathname === '/remote/vendor/peerjs.min.js') {
			void request.respond({
				status: 200,
				contentType: 'text/javascript; charset=utf-8',
				body: 'const Peer = window.Peer; export { Peer }; export default Peer;',
			});
			return;
		}
		void request.continue();
	});
	await page.evaluateOnNewDocument((expected) => {
		type Listener = (value?: unknown) => void;
		interface HarnessProbe {
			commands: Array<Record<string, unknown>>;
			vendorAssignments: number;
		}
		const scope = window as typeof window & {
			Peer?: unknown;
			__spectraRemotePeerHarness?: HarnessProbe;
		};
		const nonce = 'B'.repeat(43);
		const probe: HarnessProbe = { commands: [], vendorAssignments: 0 };

		const decodeBase64Url = (value: string): Uint8Array => {
			const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
			const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
			return Uint8Array.from(binary, (character) => character.charCodeAt(0));
		};
		const encodeBase64Url = (bytes: Uint8Array): string => {
			let binary = '';
			for (const byte of bytes) binary += String.fromCharCode(byte);
			return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
		};
		const expectedProof = async (): Promise<string> => {
			const key = await crypto.subtle.importKey(
				'raw',
				decodeBase64Url(expected.secret),
				{ name: 'HMAC', hash: 'SHA-256' },
				false,
				['sign'],
			);
			const payload = new TextEncoder().encode(
				`spectra-remote-v3\n${expected.sessionId}\n${nonce}\n3`,
			);
			const signature = await crypto.subtle.sign('HMAC', key, payload);
			return encodeBase64Url(new Uint8Array(signature));
		};

		class FakeConnection {
			open = false;
			readonly listeners = new Map<string, Listener[]>();

			on(type: string, listener: Listener): this {
				const listeners = this.listeners.get(type) ?? [];
				listeners.push(listener);
				this.listeners.set(type, listeners);
				return this;
			}

			emit(type: string, value?: unknown): void {
				for (const listener of this.listeners.get(type) ?? []) listener(value);
			}

			send(value: unknown): void {
				if (!value || typeof value !== 'object' || Array.isArray(value)) return;
				const message = value as Record<string, unknown>;
				if (message.type === 'spectra.remote.authenticate') {
					void expectedProof().then((proof) => {
						const ok = message.proof === proof;
						this.emit('data', {
							type: 'spectra.remote.auth-result',
							protocolVersion: 3,
							sessionId: expected.sessionId,
							ok,
							...(ok ? { sessionEpoch: 1, reconnectUntil: Date.now() + 120_000 } : { error: 'AUTH_FAILED' }),
						});
						if (!ok) return;
						this.emit('data', {
							type: 'spectra.remote.state',
							protocolVersion: 3,
							sessionId: expected.sessionId,
							sessionEpoch: 1,
							generation: 17,
							revision: 3,
							volume: 140,
							volumeBase: 100,
							boost: 1.4,
							actualMode: 'capture',
							phase: 'active',
							volumeState: 'capture',
							muted: false,
							playing: true,
							speed: 1.25,
							tabTitle: 'SPECTRA extension smoke fixture',
							tabDomain: '127.0.0.1',
						});
					});
					return;
				}
				if (message.type === 'spectra.remote.command') {
					probe.commands.push(structuredClone(message));
				}
			}

			close(): void {
				if (!this.open) return;
				this.open = false;
				this.emit('close');
			}
		}

		class FakePeer {
			readonly listeners = new Map<string, Listener[]>();

			constructor() {
				queueMicrotask(() => this.emit('open', 'spectra-smoke-client'));
			}

			on(type: string, listener: Listener): this {
				const listeners = this.listeners.get(type) ?? [];
				listeners.push(listener);
				this.listeners.set(type, listeners);
				return this;
			}

			emit(type: string, value?: unknown): void {
				for (const listener of this.listeners.get(type) ?? []) listener(value);
			}

			connect(peerId: string, _options: { metadata?: unknown }): FakeConnection {
				if (peerId !== expected.peerId) throw new Error('Remote client selected the wrong Peer host');
				const connection = new FakeConnection();
				queueMicrotask(() => {
					connection.open = true;
					connection.emit('open');
					connection.emit('data', {
						type: 'spectra.remote.challenge',
						protocolVersion: 3,
						sessionId: expected.sessionId,
						nonce,
						pairingExpiresAt: expected.pairingExpiresAt,
					});
				});
				return connection;
			}

			destroy(): void {}
		}

		Object.defineProperty(scope, 'Peer', {
			configurable: true,
			get: () => FakePeer,
			set: () => {
				probe.vendorAssignments += 1;
			},
		});
		scope.__spectraRemotePeerHarness = probe;
	}, {
		peerId: session.peerId,
		sessionId: session.sessionId,
		secret: session.secret,
		pairingExpiresAt: session.pairingExpiresAt,
	});
}

export interface SmokeLaunchOptions {
	executablePath?: string;
	headless: true;
	enableExtensions: true;
	userDataDir: string;
	args: string[];
}

export async function prepareSmokeSession(): Promise<SmokeLaunchOptions> {
	fixtureErrors.length = 0;
	peerRuntimeDebugEvents.length = 0;
	smokeRuntimeLeases.clear();
	runtimeLeaseClient = null;
	runtimeLeaseClientPromise = null;
	serviceWorkerRefreshPromise = null;
	peerRuntimeDebugClient = null;
	serviceWorkerConnection = null;
	extensionId = '';
	fixtureUrl = '';
	browserProfileDir = '';
	server = Bun.serve({
		port: 0,
		hostname: '127.0.0.1',
		fetch(request) {
			const requestUrl = new URL(request.url);
			const pathname = requestUrl.pathname;
			const remoteFiles: Record<string, { file: string; type: string }> = {
				'/remote/': { file: 'index.html', type: 'text/html; charset=utf-8' },
				'/remote/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
				'/remote/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
				'/remote/dist/protocol.js': {
					file: join('dist', 'protocol.js'),
					type: 'text/javascript; charset=utf-8',
				},
				'/remote/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
				'/remote/vendor/peerjs.min.js': {
					file: join('vendor', 'peerjs.min.js'),
					type: 'text/javascript; charset=utf-8',
				},
			};
			const remoteFile = remoteFiles[pathname];
			if (remoteFile) {
				return new Response(Bun.file(join(REMOTE_SITE_DIR, remoteFile.file)), {
					headers: { 'content-type': remoteFile.type },
				});
			}
			if (pathname === '/captions.vtt') {
				return new Response('WEBVTT\n\n', {
					headers: { 'content-type': 'text/vtt; charset=utf-8' },
				});
			}
			if (!['/', '/smoke-test.html', '/recommend.html', '/watch/42'].includes(pathname)) {
				return new Response('Not found', { status: 404 });
			}
			const pageSpeedCap = Number(requestUrl.searchParams.get('page-speed-cap'));
			if (Number.isFinite(pageSpeedCap) && pageSpeedCap > 0) {
				return new Response(cappedPageMediaFixture(pageSpeedCap), {
					headers: { 'content-type': 'text/html; charset=utf-8' },
				});
			}
			return new Response(Bun.file(FIXTURE_PATH), {
				headers: { 'content-type': 'text/html; charset=utf-8' },
			});
		},
	});
	fixtureUrl = `http://127.0.0.1:${server.port}/smoke-test.html`;
	browserProfileDir = await mkdtemp(join(tmpdir(), 'spectra-smoke-'));
	const chromePath = EXPLICIT_CHROME ?? systemChromeExecutable();
	return {
		// The shipped browser on this machine, not a cached old download: Chrome
		// 137+ ignores `--load-extension`, and an older executable would test a
		// permission/extension model the product no longer runs on.
		...(chromePath ? { executablePath: chromePath } : {}),
		headless: true,
		enableExtensions: true,
		userDataDir: browserProfileDir,
		args: [
			// Action-popup sizing is browser-owned; pin physical/CSS rounding for geometry assertions.
			'--force-device-scale-factor=1',
			'--window-size=1280,960',
			`--lang=${SMOKE_LOCALE}`,
			`--accept-lang=${SMOKE_LOCALE}`,
			'--no-sandbox',
			'--disable-setuid-sandbox',
			'--autoplay-policy=no-user-gesture-required',
		],
	};
}

export async function startSmokeSession(launched: Browser): Promise<void> {
	browser = launched;
	// Chrome 137+ ignores `--load-extension` for an unpacked directory. The
	// Extensions CDP domain is the supported installer, and it works in the
	// current headless mode as well as headed, so the suite no longer depends
	// on a retired browser generation.
	try {
		const installer = await browser.target().createCDPSession();
		await installer.send('Extensions.loadUnpacked', { path: EXTENSION_DIR.replace(/\\/g, '/') });
		await installer.detach().catch(() => undefined);
	} catch (error) {
		throw new Error(
			`SPECTRA could not install the unpacked extension through CDP: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	try {
		serviceWorkerTarget = await browser.waitForTarget(
			(target) => target.type() === 'service_worker'
				&& /^chrome-extension:\/\/[^/]+\/background\.js$/u.test(target.url()),
			{ timeout: 30_000 },
		);
	} catch (error) {
		// The installer succeeded but no worker appeared: report exactly which
		// targets exist instead of waiting out a second 30s timeout.
		const targets = browser.targets()
			.map((target) => `${target.type()}:${target.url() || '<empty>'}`)
			.join(', ');
		throw new Error(
			`SPECTRA service worker did not start; browser targets: ${targets || '<none>'}`,
			{ cause: error },
		);
	}
	extensionId = new URL(serviceWorkerTarget.url()).host;
	const worker = await serviceWorkerTarget.worker();
	if (!worker) throw new Error('SPECTRA service worker target has no worker execution context');
	serviceWorker = worker;

	fixturePage = await browser.newPage();
	collectPageErrors(fixturePage, fixtureErrors);
	await installAudioContextProbe(fixturePage);
	await fixturePage.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
	await waitForContentBootstrapStatus(fixtureUrl);
}

// Counts AudioContext constructions in a page. A page-native read must never pay
// for one, so this probe is the only way to prove the WebAudio path stayed cold.
// It has to be installed before navigation and on every page a case drives.
export async function installAudioContextProbe(page: Page): Promise<void> {
	await page.evaluateOnNewDocument(() => {
		const scope = window as Window & { __spectraAudioContextCount?: number };
		scope.__spectraAudioContextCount = 0;
		const Original = window.AudioContext;
		if (!Original) return;
		window.AudioContext = new Proxy(Original, {
			construct(target, args, newTarget) {
				scope.__spectraAudioContextCount = (scope.__spectraAudioContextCount ?? 0) + 1;
				return Reflect.construct(target, args, newTarget);
			},
		});
	});
}

export async function teardownSmokeSession(): Promise<void> {
	await restoreOffscreenPeerRuntimeProbe().catch(() => undefined);
	await cleanupSyntheticCaptureHarness();
	await releaseSmokeRuntimes();
	runtimeLeaseClientPromise = null;
	await runtimeLeaseClient?.close().catch(() => undefined);
	runtimeLeaseClient = null;
	await serviceWorkerConnection?.disconnect().catch(() => undefined);
	await browser?.close().catch(() => undefined);
	if (browserProfileDir) {
		await rm(browserProfileDir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
	}
	server?.stop(true);
}

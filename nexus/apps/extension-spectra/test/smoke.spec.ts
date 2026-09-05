import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer, {
	type Browser,
	type CDPSession,
	type EvaluateFunc,
	type Page,
	type Target,
	type WebWorker,
} from 'puppeteer';
import {
	SPECTRA_CONTENT_RUNTIME_REVISION,
	type ControlSnapshot,
	type RegistrySnapshot,
	type SettingsPatch,
	type SettingsSnapshot,
} from '@nexus/contracts';
import {
	SPECTRA_PAGE_MEDIA_EVENT,
	SPECTRA_PAGE_MEDIA_REQUEST_ATTRIBUTE,
	SPECTRA_PAGE_MEDIA_RESULT_ATTRIBUTE,
} from '../src/shared/page-media-bridge';
import { createRemoteProof } from '../src/remote/protocol';
import { requireValue } from './helpers/require-value';

const EXTENSION_DIR = resolve(process.env.SPECTRA_EXTENSION_DIR ?? join(import.meta.dir, '..', 'dist'));
const FIXTURE_PATH = join(import.meta.dir, 'fixtures', 'smoke-test.html');
const FIXTURE_HTML = readFileSync(FIXTURE_PATH, 'utf8');
const REMOTE_SITE_DIR = resolve(import.meta.dir, '..', '..', '..', '..', 'remote-site');
const SMOKE_LOCALE = process.env.SPECTRA_SMOKE_LOCALE?.trim() || 'en-US';

if (!/^[a-z]{2}(?:-[A-Z]{2})?$/u.test(SMOKE_LOCALE)) {
	throw new Error(`Unsupported SPECTRA smoke locale: ${SMOKE_LOCALE}`);
}

if (!existsSync(join(EXTENSION_DIR, 'manifest.json'))) {
	throw new Error(`SPECTRA extension directory is missing manifest.json: ${EXTENSION_DIR}`);
}
const EXTENSION_COMMAND_COUNT = Object.keys((
	JSON.parse(readFileSync(join(EXTENSION_DIR, 'manifest.json'), 'utf8')) as {
		commands?: Record<string, unknown>;
	}
).commands ?? {}).length;

let browser: Browser;
let serviceWorkerConnection: Browser | null = null;
let fixturePage: Page;
let serviceWorkerTarget: Target;
let serviceWorker: WebWorker;
let extensionId = '';
let fixtureUrl = '';
let server: ReturnType<typeof Bun.serve>;
let browserProfileDir = '';
let runtimeLeaseClient: Page | null = null;
let serviceWorkerRefreshPromise: Promise<void> | null = null;
let peerRuntimeDebugClient: CDPSession | null = null;
const peerRuntimeDebugEvents: string[] = [];

const fixtureErrors: string[] = [];
const smokeRuntimeLeases = new Map<string, SmokeRuntimeLease>();

interface ContentStatus {
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

interface ContentBootstrapStatus {
	bootstrapRevision: string;
	runtimeRevision: string | null;
	ready: boolean;
	ownedSources: Array<{
		mediaId: string;
		sourceRevision: number;
	}>;
}

type BootstrapListenerKey = readonly [
	target: 'document' | 'window',
	type: string,
	capture: boolean,
];

interface BootstrapListenerProbe {
	added: BootstrapListenerKey[];
	removed: BootstrapListenerKey[];
	originalAdd: typeof EventTarget.prototype.addEventListener;
	originalRemove: typeof EventTarget.prototype.removeEventListener;
}

interface BootstrapReinjectionResult {
	same: boolean;
	revision: string | undefined;
	listenerChanges?: {
		added: BootstrapListenerKey[];
		removed: BootstrapListenerKey[];
	};
}

interface SmokeRuntimeLease {
	tabId: number;
	documentId: string;
	runtimeRevision: string;
	capability: string;
}

interface PeerRuntimeBreakpoint {
	url: string;
	lineNumber: number;
	columnNumber: number;
	constructorBinding: string;
}

interface AudioConfig {
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

interface CaptureState {
	tabId: number;
	generation: number;
	phase: 'idle' | 'starting' | 'active' | 'stopping' | 'error';
	active: boolean;
	actualMode: 'bypass' | 'webaudio' | 'capture';
	lastError: { code: string; message: string; retryable: boolean } | null;
}

interface CaptureResponse {
	ok: boolean;
	data?: CaptureState;
	error?: { code: string; message: string; retryable: boolean };
}

interface OffscreenHostSnapshot {
	audioTabs: Array<{ tabId: number; generation: number }>;
	remoteTabs: Array<{ tabId: number; sessionId: string }>;
}

interface PeerRuntimeProbe {
	peerType: string;
	vendorAssignments: number;
	peerConstructions: number;
	peerDestructions: number;
}

interface RemotePublicSession {
	protocolVersion: 3;
	sessionId: string;
	peerId: string;
	secret: string;
	createdAt: number;
	pairingExpiresAt: number;
	tabId: number;
	connected: boolean;
}

interface SyntheticCaptureState {
	calls: number;
	pending: boolean;
	processorStates: string[];
}

interface ContentRuntimeProbe {
	listenersReady: boolean;
	runtimeRevision: string | null;
	sameRuntime: boolean | null;
	oldRuntimeDisposed: boolean | null;
}

interface PopupVolumePresentation {
	sliderCount: number;
	min: string;
	max: string;
	value: string;
	fillColor: string;
	valueColor: string;
	sliderAccent: string;
}

interface SmokeRpcResult<T> {
	ok: boolean;
	data: T;
	error?: { message?: string };
}

interface PageMediaControllerState {
	volumeBase: number;
	mediaMuted: boolean;
	speed: number;
	domVolume: number;
	domMuted: boolean;
	domSpeed: number;
}

interface OsdFeedbackFrame {
	at: number;
	label: string;
	width: number;
	color: string;
}

interface OsdFeedbackSnapshot {
	actual: number;
	visible: boolean;
	label: string;
	width: number;
	tone: string;
	color: string;
	frames: OsdFeedbackFrame[];
}

const DEFAULT_AUDIO_CONFIG: AudioConfig = {
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

function createSmokeToneWav(): Uint8Array {
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

const SMOKE_TONE_WAV = createSmokeToneWav();

function collectPageErrors(page: Page, errors: string[]): void {
	page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
}

type DefaultShortcutKey = 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'KeyM';

async function tapDefaultShortcut(page: Page, key: DefaultShortcutKey): Promise<void> {
	await page.keyboard.down('Alt');
	await page.keyboard.press(key);
	await page.keyboard.up('Alt');
}

async function triggerDefaultHotkeyFromContent(
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

async function holdDefaultShortcut(
	page: Page,
	key: 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp',
	repeats: number,
	releaseDelayMs = 0,
	repeatIntervalMs = 35,
): Promise<void> {
	await page.keyboard.down('Alt');
	await page.keyboard.down(key);
	for (let index = 0; index < repeats; index += 1) {
		await new Promise((resolveWait) => setTimeout(resolveWait, repeatIntervalMs));
		await page.keyboard.down(key);
	}
	if (releaseDelayMs > 0) await new Promise((resolveWait) => setTimeout(resolveWait, releaseDelayMs));
	await page.keyboard.up(key);
	await page.keyboard.up('Alt');
}

async function startOsdFeedbackProbe(
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

async function readOsdFeedback(
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
			visible: osd?.classList.contains('v') ?? false,
			label: root?.getElementById('t')?.textContent ?? '',
			width: fill ? Number.parseFloat(fill.style.width) : -1,
			tone: osd?.className ?? '',
			color: fill ? getComputedStyle(fill).backgroundColor : '',
			frames: [...scope.__spectraOsdFeedbackProbe?.frames ?? []],
		};
	}, { actualMetric: metric, stop: stopProbe });
}

interface ExtensionLayoutAudit {
	documentOverflow: number;
	controlsOutsideViewport: string[];
	clippedText: string[];
}

interface ExtensionAccessibilityAudit {
	interactiveCount: number;
	namelessInteractive: string[];
	missingState: string[];
	domPressedCount: number;
	axPressedCount: number;
}

async function inspectExtensionLayout(page: Page): Promise<ExtensionLayoutAudit> {
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

async function inspectExtensionAccessibility(page: Page): Promise<ExtensionAccessibilityAudit> {
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

async function readContentStatus(url = fixturePage.url()): Promise<ContentStatus> {
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

async function readContentBootstrapStatus(url = fixturePage.url()): Promise<ContentBootstrapStatus> {
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

async function waitForContentBootstrapStatus(
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

async function getRuntimeLeaseClient(): Promise<Page> {
	if (runtimeLeaseClient && !runtimeLeaseClient.isClosed()) return runtimeLeaseClient;
	runtimeLeaseClient = await browser.newPage();
	await runtimeLeaseClient.goto(`chrome-extension://${extensionId}/options.html`, {
		waitUntil: 'domcontentloaded',
	});
	return runtimeLeaseClient;
}

function isDetachedServiceWorkerError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes('detached frame or worker')
		|| message.includes('Execution context was destroyed');
}

async function refreshSuspendedServiceWorker(): Promise<void> {
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

async function evaluateServiceWorker<
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
	if (!await hasCurrentIdentity()) await refreshSuspendedServiceWorker();
	const evaluate = () => serviceWorker.evaluate<Params, Func>(func, ...args);
	try {
		return await evaluate();
	} catch (error) {
		if (!isDetachedServiceWorkerError(error)) throw error;
		await refreshSuspendedServiceWorker();
		return evaluate();
	}
}

async function reinjectContentBootstrap(
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

async function acquireSmokeRuntime(
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

async function releaseSmokeRuntime(lease: SmokeRuntimeLease): Promise<void> {
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

async function releaseSmokeRuntimes(): Promise<void> {
	if (smokeRuntimeLeases.size === 0) return;
	for (const lease of [...smokeRuntimeLeases.values()]) {
		await releaseSmokeRuntime(lease).catch(() => undefined);
	}
	smokeRuntimeLeases.clear();
}

async function waitForContentStatus(
	predicate: (status: ContentStatus) => boolean,
	timeoutMs = 5_000,
): Promise<ContentStatus> {
	const deadline = Date.now() + timeoutMs;
	let lastStatus: ContentStatus | undefined;
	let lastReadError: unknown;
	while (Date.now() < deadline) {
		try {
			lastStatus = await readContentStatus();
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

async function getOffscreenContextCount(worker?: WebWorker): Promise<number> {
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

async function eventually<T>(
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

async function getTabId(url: string, worker?: WebWorker): Promise<number> {
	const evaluate = worker
		? worker.evaluate.bind(worker)
		: evaluateServiceWorker;
	return evaluate(async (targetUrl: string) => {
		const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === targetUrl);
		if (tab?.id === undefined) throw new Error(`Unable to find tab: ${targetUrl}`);
		return tab.id;
	}, url);
}

async function installPageMediaControllerHarness(
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

function cappedPageMediaFixture(maximumSpeed: number): string {
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

async function updatePageMediaControllerHarness(
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

async function readPageMediaControllerHarness(): Promise<PageMediaControllerState> {
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

async function removePageMediaControllerHarness(): Promise<void> {
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

async function readOffscreenSnapshot(worker?: WebWorker): Promise<OffscreenHostSnapshot> {
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

async function hasOffscreenAudioTab(tabId: number): Promise<boolean> {
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

async function openExtensionClient(path = 'popup.html'): Promise<Page> {
	const page = await browser.newPage();
	await page.goto(`chrome-extension://${extensionId}/${path}`, { waitUntil: 'domcontentloaded' });
	return page;
}

async function sendExtensionMessage<T>(
	client: Page,
	message: Record<string, unknown>,
): Promise<T> {
	return client.evaluate(async (request) => chrome.runtime.sendMessage(
		{ ...request, requestId: crypto.randomUUID() },
	), message) as Promise<T>;
}

async function readExtensionSettings(client: Page): Promise<SettingsSnapshot> {
	const response = await sendExtensionMessage<SmokeRpcResult<SettingsSnapshot>>(client, {
		protocolVersion: 2,
		type: 'spectra.settings.get',
		payload: {},
	});
	if (!response.ok) throw new Error(response.error?.message ?? 'Unable to read settings');
	return response.data;
}

async function readSiteRouteRegistry(client: Page): Promise<RegistrySnapshot> {
	const response = await sendExtensionMessage<SmokeRpcResult<RegistrySnapshot>>(client, {
		protocolVersion: 2,
		type: 'spectra.registry.get',
		payload: {},
	});
	if (!response.ok) throw new Error(response.error?.message ?? 'Unable to read site routes');
	return response.data;
}

async function patchExtensionSettings(
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

async function replaceHotkeySite(
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

async function setGlobalLanguage(client: Page, language: string): Promise<string> {
	const { previous } = await patchExtensionSettings(
		client,
		{ scope: 'global', changes: { lang: language } },
	);
	return previous.globalSettings.lang;
}

async function setHotkeyTarget(client: Page, tabId: number | null): Promise<void> {
	const selected = await sendExtensionMessage<SmokeRpcResult<{ tabId: number | null }>>(client, {
		protocolVersion: 2, type: 'spectra.hotkey-target.set', payload: { tabId },
	});
	if (!selected?.ok || selected.data.tabId !== tabId) {
		throw new Error(selected?.error?.message ?? 'Unable to update the shortcut target');
	}
}

async function openActionPopupTarget(timeoutMs = 10_000): Promise<Target> {
	const knownTargets = new Set(browser.targets());
	const popupUrl = `chrome-extension://${extensionId}/popup.html`;
	const targetPromise = browser.waitForTarget(
		(target) => !knownTargets.has(target) && target.url() === popupUrl,
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

async function readPopupVolumePresentation(expectedAccent?: string): Promise<PopupVolumePresentation> {
	await fixturePage.bringToFront();
	const target = await openActionPopupTarget();
	const popup = await target.asPage();
	try {
		await popup.waitForSelector('.glass-card .vol-slider', { timeout: 8_000 });
		if (expectedAccent) {
			await popup.waitForFunction((accent) => {
				const slider = document.querySelector<HTMLElement>('.vol-slider');
				return slider
					&& getComputedStyle(slider).getPropertyValue('--slider-accent').trim() === accent;
			}, { timeout: 8_000 }, expectedAccent).catch(async (error) => {
				const diagnostic = await popup.evaluate(async () => {
					const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
					const slider = document.querySelector<HTMLElement>('.vol-slider');
					if (!slider) throw new Error('Popup volume slider is missing');
					const request = (type: string, payload: Record<string, unknown>) => chrome.runtime.sendMessage({
						protocolVersion: 2,
						requestId: crypto.randomUUID(),
						tabId: tab?.id,
						type,
						payload,
					});
					return {
						accent: getComputedStyle(slider)
							.getPropertyValue('--slider-accent').trim(),
						session: tab?.id ? await request('spectra.audio.session.get', { tabId: tab.id }) : null,
						control: tab?.id ? await request('spectra.control.snapshot.get', { tabId: tab.id }) : null,
					};
				});
				throw new Error(`Popup accent did not reach ${expectedAccent}: ${JSON.stringify(diagnostic)}`, {
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

async function closeActionPopup(popup: Page): Promise<void> {
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

async function submitEffectiveVolume(tabId: number, value: number): Promise<void> {
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

async function submitPopupControlIntent(
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

async function readBadgeColor(tabId: number): Promise<number[]> {
	return evaluateServiceWorker(
		async (targetTabId) => chrome.action.getBadgeBackgroundColor({ tabId: targetTabId }),
		tabId,
	) as Promise<number[]>;
}

async function readBadgeText(tabId: number): Promise<string> {
	return evaluateServiceWorker(
		async (targetTabId) => chrome.action.getBadgeText({ tabId: targetTabId }),
		tabId,
	) as Promise<string>;
}

async function sendFromActionPopup<T>(message: Record<string, unknown>): Promise<T> {
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

async function installVisualizerBatchProbe(): Promise<void> {
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

async function readVisualizerBatchProbe(): Promise<{
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

async function readVisualizerBatchCount(): Promise<number> {
	return (await readVisualizerBatchProbe()).count;
}

async function removeVisualizerBatchProbe(): Promise<void> {
	await evaluateServiceWorker(() => {
		type Probe = { count: number; listener: (message: unknown) => void };
		const scope = globalThis as typeof globalThis & { __spectraVisualizerProbe?: Probe };
		if (!scope.__spectraVisualizerProbe) return;
		chrome.runtime.onMessage.removeListener(scope.__spectraVisualizerProbe.listener);
		delete scope.__spectraVisualizerProbe;
	}).catch(() => undefined);
}

async function sendCaptureRequest(
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

async function configureRuntime(
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

async function getOffscreenTarget(): Promise<Target> {
	return browser.waitForTarget(
		(target) => target.url() === `chrome-extension://${extensionId}/offscreen.html`,
		{ timeout: 10_000 },
	);
}

async function evaluateOffscreen<T>(expression: string): Promise<T> {
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

async function readOffscreenPeerRuntimeProbe(): Promise<PeerRuntimeProbe> {
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

function locatePeerRuntimeBreakpoint(): PeerRuntimeBreakpoint {
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

async function installOffscreenPeerRuntimeProbe(
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

async function openOffscreenTestRemote(session: RemotePublicSession): Promise<string> {
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

async function readOffscreenTestRemoteMessages(
	connectionId: string,
): Promise<Array<Record<string, unknown>>> {
	return evaluateOffscreen<Array<Record<string, unknown>>>(`(() => {
		const probe = globalThis.__spectraSmokePeerRuntimeProbe;
		if (!probe?.readMessages) throw new Error('Offscreen Peer harness is unavailable');
		return probe.readMessages(${JSON.stringify(connectionId)});
	})()`);
}

async function deliverOffscreenTestRemote(
	connectionId: string,
	message: Record<string, unknown>,
): Promise<void> {
	await evaluateOffscreen<void>(`(() => {
		const probe = globalThis.__spectraSmokePeerRuntimeProbe;
		if (!probe?.deliver) throw new Error('Offscreen Peer harness is unavailable');
		probe.deliver(${JSON.stringify(connectionId)}, ${JSON.stringify(message)});
	})()`);
}

async function detachOffscreenPeerRuntimeDebugger(): Promise<void> {
	await peerRuntimeDebugClient?.detach().catch(() => undefined);
	peerRuntimeDebugClient = null;
}

async function restoreOffscreenPeerRuntimeProbe(): Promise<void> {
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

async function installTabCaptureStreamIdStub(worker?: WebWorker): Promise<void> {
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

async function ensureOffscreenHostForSyntheticHarness(): Promise<void> {
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

async function installSyntheticCaptureHarness(): Promise<void> {
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

async function readSyntheticCaptureState(): Promise<SyntheticCaptureState> {
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

async function releaseSyntheticCapture(): Promise<void> {
	await evaluateOffscreen<boolean>(`(() => {
		const release = globalThis.__spectraSmokeCaptureHarness?.releaseNext;
		if (typeof release === 'function') release();
		return true;
	})()`);
}

async function cleanupSyntheticCaptureHarness(): Promise<void> {
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

async function inspectContentRuntime(tabId: number, saveRuntime = false): Promise<ContentRuntimeProbe> {
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

async function reinjectContent(tabId: number): Promise<void> {
	await evaluateServiceWorker(async (targetTabId) => {
		await chrome.scripting.executeScript({
			target: { tabId: targetTabId },
			world: 'ISOLATED',
			files: ['content-runtime.js'],
		});
	}, tabId);
}

function describeServiceWorkerTargets(): string {
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

async function withDiagnosticTimeout<T>(
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

async function waitForWorkerVersion(
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

async function refreshServiceWorkerHandle(
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

async function waitForServiceWorkerMarkerToDisappear(marker: string, timeoutMs = 10_000): Promise<void> {
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

async function restartServiceWorker(): Promise<void> {
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

async function readRestartedWorkerState(): Promise<{
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

function remotePairingUrl(session: RemotePublicSession, secret = session.secret): string {
	const fragment = new URLSearchParams({
		v: String(session.protocolVersion),
		s: session.sessionId,
		p: session.peerId,
		k: secret,
		e: String(session.pairingExpiresAt),
	});
	return `${new URL(fixtureUrl).origin}/remote/#${fragment.toString()}`;
}

async function installRemotePagePeerHarness(
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

beforeAll(async () => {
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

	browser = await puppeteer.launch({
		headless: true,
		userDataDir: browserProfileDir,
		args: [
			`--lang=${SMOKE_LOCALE}`,
			`--accept-lang=${SMOKE_LOCALE}`,
			`--disable-extensions-except=${EXTENSION_DIR}`,
			`--load-extension=${EXTENSION_DIR}`,
			'--no-sandbox',
			'--disable-setuid-sandbox',
			'--autoplay-policy=no-user-gesture-required',
		],
	});

	try {
		serviceWorkerTarget = await browser.waitForTarget(
			(target) => target.type() === 'service_worker'
				&& /^chrome-extension:\/\/[^/]+\/background\.js$/u.test(target.url()),
			{ timeout: 30_000 },
		);
	} catch (error) {
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
	await fixturePage.evaluateOnNewDocument(() => {
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
	await fixturePage.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
	await waitForContentBootstrapStatus(fixtureUrl);
}, 60_000);

afterAll(async () => {
	await restoreOffscreenPeerRuntimeProbe().catch(() => undefined);
	await cleanupSyntheticCaptureHarness();
	await releaseSmokeRuntimes();
	await runtimeLeaseClient?.close().catch(() => undefined);
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
});

describe('SPECTRA built extension smoke', () => {
	test('renders the authenticated Remote page and emits the exact command envelope without public signaling', async () => {
		const session: RemotePublicSession = {
			protocolVersion: 3,
			sessionId: 'C'.repeat(22),
			peerId: `spectra-${'d'.repeat(32)}`,
			secret: 'E'.repeat(22),
			createdAt: Date.now(),
			pairingExpiresAt: Date.now() + 60_000,
			tabId: 1,
			connected: false,
		};
		const rejectedPage = await browser.newPage();
		const authenticatedPage = await browser.newPage();
		try {
			await installRemotePagePeerHarness(rejectedPage, session);
			await rejectedPage.goto(remotePairingUrl(session, 'A'.repeat(22)), {
				waitUntil: 'domcontentloaded',
			});
			await rejectedPage.waitForFunction(
				() => document.querySelector('#status-text')?.textContent === 'Authentication failed',
				{ timeout: 5_000, polling: 50 },
			);
			expect(await rejectedPage.evaluate(() => location.hash)).toBe('');
			expect(await rejectedPage.$eval('#tab-title', (element) => element.textContent)).toBe(
				'Waiting for authenticated sync…',
			);
			expect(await rejectedPage.$eval('[data-command="volume_up"]', (element) => (
				(element as HTMLButtonElement).disabled
			))).toBe(true);

			await installRemotePagePeerHarness(authenticatedPage, session);
			await authenticatedPage.goto(remotePairingUrl(session), { waitUntil: 'domcontentloaded' });
			await authenticatedPage.waitForFunction(
				() => document.querySelector('#status-text')?.textContent === 'Authenticated and connected'
					&& document.querySelector('#tab-title')?.textContent === 'SPECTRA extension smoke fixture',
				{ timeout: 5_000, polling: 50 },
			);
			expect(await authenticatedPage.evaluate(() => location.hash)).toBe('');
			expect(await authenticatedPage.$eval('[data-command="volume_up"]', (element) => (
				(element as HTMLButtonElement).disabled
			))).toBe(false);
			expect(await authenticatedPage.$eval('#volume-display', (element) => (
				element.classList.contains('capture-active')
			))).toBe(true);
			expect(await authenticatedPage.$eval('#vol-display', (element) => element.textContent)).toBe('140%');

			await authenticatedPage.$eval(
				'[data-command="volume_up"]',
				(element) => (element as HTMLButtonElement).click(),
			);
			const commands = await eventually(
				() => authenticatedPage.evaluate(() => (
					(window as Window & {
						__spectraRemotePeerHarness?: { commands: Array<Record<string, unknown>> };
					}).__spectraRemotePeerHarness?.commands ?? []
				)),
				(values) => values.length > 0 ? values : undefined,
				'remote page command envelope',
				5_000,
			);
			expect(commands.at(-1)).toEqual({
				type: 'spectra.remote.command',
				protocolVersion: 3,
				sessionId: session.sessionId,
				sessionEpoch: 1,
				commandId: expect.any(String),
				sequence: 1,
				generation: 17,
				command: 'volume_up',
			});
		} finally {
			await Promise.all([rejectedPage.close(), authenticatedPage.close()]);
		}
	}, 20_000);

	test('loads the MV3 worker and isolated zero-work bootstrap without MAIN', async () => {
		expect(serviceWorkerTarget.url()).toBe(`chrome-extension://${extensionId}/background.js`);
		const commandState = await evaluateServiceWorker(async () => {
			const manifest = chrome.runtime.getManifest() as {
				commands?: Record<string, { suggested_key?: { default?: string } }>;
			};
			return {
				declaredVolumeUp: manifest.commands?.volume_up?.suggested_key?.default,
				commands: Object.fromEntries(
					(await chrome.commands.getAll()).map(({ name, shortcut }) => [name, shortcut]),
				),
			};
		});
		expect(commandState.declaredVolumeUp).toBe('Alt+Up');
		expect(commandState.commands).not.toHaveProperty('toggle_mute');
		expect(commandState.commands).not.toHaveProperty('speed_down');
		expect(commandState.commands).not.toHaveProperty('speed_up');
		expect(commandState.commands.volume_up).toEqual(expect.any(String));
		expect(commandState.commands.volume_up.length).toBeGreaterThan(0);
		expect(commandState.commands).not.toHaveProperty('volume_down');
		expect(await readContentBootstrapStatus()).toMatchObject({
			ready: false,
			runtimeRevision: null,
			ownedSources: [],
		});
		expect(await fixturePage.evaluate(() => ({
			legacyMarker: document.documentElement.dataset.spectraContentLoaded,
			mainRuntime: '__SPECTRA_MAIN_RUNTIME__' in window,
		}))).toEqual({ legacyMarker: undefined, mainRuntime: false });
		expect(fixtureErrors).toEqual([]);
	});

	test('routes the visible-tab v2 request to its sole background owner', async () => {
		// This is a background routing probe, not a Popup lifecycle test. Using
		// Options avoids acquiring a transient active-tab runtime before the next
		// test verifies that an untouched page remains bootstrap-only.
		const client = await openExtensionClient('options.html');
		try {
			const response = await client.evaluate(() => chrome.runtime.sendMessage({
				protocolVersion: 2,
				requestId: crypto.randomUUID(),
				type: 'spectra.tab.visible.list',
				payload: {},
			}));
			expect(response).toMatchObject({ ok: true, data: { tabs: expect.any(Array) } });
		} finally {
			await client.close();
		}
	});

	test('keeps the v2 config ABI stable while new Content reads the additive site policy', async () => {
		const tabId = await getTabId(fixturePage.url());
		const client = await openExtensionClient('options.html');
		const result = await client.evaluate(async (targetTabId) => {
			const executions = await chrome.scripting.executeScript({
				target: { tabId: targetTabId },
				world: 'ISOLATED',
				func: async () => {
					const send = (type: string) => chrome.runtime.sendMessage({
						protocolVersion: 2,
						requestId: crypto.randomUUID(),
						type,
						payload: {},
					});
					return {
						config: await send('spectra.audio.config.get'),
						policy: await send('spectra.audio.policy.get'),
					};
				},
			});
			return executions[0]?.result;
		}, tabId).finally(() => client.close()) as {
			config: SmokeRpcResult<Record<string, unknown>>;
			policy: SmokeRpcResult<{ config: Record<string, unknown>; mediaRoute: string }>;
		};
		expect(result.config.ok).toBe(true);
		expect(result.policy.ok).toBe(true);
		if (!result.config.ok || !result.policy.ok) return;
		expect(result.config.data.enabled).toBe(true);
		expect(result.config.data.config).toBeUndefined();
		expect(result.policy.data.config.enabled).toBe(true);
		expect(result.policy.data.mediaRoute).toBe('auto');
	});

	test('leaves untouched media transparent and creates no AudioContext', async () => {
		const offscreenBefore = await getOffscreenContextCount();
		const status = await readContentBootstrapStatus();
		const state = await fixturePage.evaluate(() => {
			const video = document.querySelector<HTMLVideoElement>('#v');
			return {
				volume: video?.volume,
				muted: video?.muted,
				playbackRate: video?.playbackRate,
				audioContexts: (window as Window & { __spectraAudioContextCount?: number })
					.__spectraAudioContextCount,
			};
		});
		expect(status).toMatchObject({ ready: false, runtimeRevision: null, ownedSources: [] });
		expect(state).toEqual({ volume: 1, muted: false, playbackRate: 1, audioContexts: 0 });
		expect(offscreenBefore).toBe(0);
		expect(await getOffscreenContextCount()).toBe(0);
	});

	test('keeps one versioned isolated bootstrap across repeated injection', async () => {
		const result = await reinjectContentBootstrap(fixtureUrl);
		expect(result).toMatchObject({ same: true });
		expect(typeof result?.revision).toBe('string');
		expect(await fixturePage.evaluate(() => '__SPECTRA_MAIN_RUNTIME__' in window)).toBe(false);
	});

	test('owns all five cold defaults once without exposing them to website handlers', async () => {
		const coldUrl = `${fixtureUrl}?cold-shortcut-tap=1`;
		const coldPage = await browser.newPage();
		await installSyntheticCaptureHarness();
		await installTabCaptureStreamIdStub();
		try {
			await coldPage.goto(coldUrl, { waitUntil: 'domcontentloaded' });
			const bootstrap = await waitForContentBootstrapStatus(coldUrl);
			const tabId = await getTabId(coldUrl);
			expect(bootstrap).toMatchObject({ ready: false, runtimeRevision: null });
			expect(await readBadgeText(tabId)).toBe('');
			await coldPage.evaluate(() => {
				const scope = window as Window & {
					__spectraWebsiteHotkeys?: { codes: string[]; reserveMute: boolean };
				};
				scope.__spectraWebsiteHotkeys = { codes: [], reserveMute: false };
				const websiteHotkeys = scope.__spectraWebsiteHotkeys;
				document.addEventListener('keydown', (event) => {
					if (!event.altKey
						|| !['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'KeyM']
							.includes(event.code)) return;
					websiteHotkeys.codes.push(event.code);
					if (event.code === 'KeyM' && websiteHotkeys.reserveMute) {
						event.preventDefault();
					}
				});
			});
			// A changed bootstrap revision must dispose the old capture arbiters.
			// The following physical keys therefore still execute exactly once.
			const replacement = await reinjectContentBootstrap(coldUrl, true);
			const expectedListenerOwnership: BootstrapListenerKey[] = [
				['document', 'ratechange', true],
				['document', 'visibilitychange', false],
				['document', 'volumechange', true],
				['window', 'blur', false],
				['window', 'keydown', true],
				['window', 'keyup', true],
				['window', 'pagehide', false],
			];
			expect(replacement).toMatchObject({ same: false });
			expect(replacement.listenerChanges).toEqual({
				added: expectedListenerOwnership,
				removed: expectedListenerOwnership,
			});
			await waitForContentBootstrapStatus(coldUrl);

			await coldPage.bringToFront();
			await coldPage.evaluate(() => {
				document.body.tabIndex = -1;
				document.body.focus();
			});
			await coldPage.click('body');
			await coldPage.waitForFunction(() => (
				document.hasFocus() && document.activeElement === document.body
			));
			await coldPage.evaluate(() => {
				const media = document.querySelector<HTMLMediaElement>('video,audio');
				if (media) {
					media.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
				}
			});
			// Chromium's headless Input domain does not deterministically dispatch a
			// browser-reserved extension accelerator to either commands.onCommand or
			// the renderer. The manifest/getAll assertion above owns that admission
			// seam; this isolated-world message is the exact accepted Content envelope
			// immediately after the trusted Alt+Up gate, with a real tab/document sender.
			await triggerDefaultHotkeyFromContent(tabId, 'volume_up');
			// Keep the invoking page foreground until Chrome admits the Capture
			// transition. readContentStatus acquires its lease through an Options
			// document, which would otherwise change the current-tab permission edge.
			await eventually(() => readBadgeText(tabId), (badge) => badge === '110', 'cold shortcut badge ACK');

			const applied = await eventually(
				async () => ({
					nativeVolume: await coldPage.evaluate(() => (
						Math.round((document.querySelector<HTMLMediaElement>('video,audio')?.volume ?? -1) * 100)
					)),
					badge: await readBadgeText(tabId),
					bootstrap: await readContentBootstrapStatus(coldUrl),
					status: await readContentStatus(coldUrl),
				}),
				(state) => state.nativeVolume === 100
					&& state.badge === '110'
					&& state.bootstrap.ready
					&& state.status.config?.volume === 110
					&& state.status.config.volumeBase === 100
					&& state.status.config.boost === 1.1
					&& state.status.actualMode === 'webaudio',
				'cold first reserved volume key crosses the native 100 percent boundary',
				10_000,
			);
			expect(applied).toMatchObject({
				nativeVolume: 100,
				badge: '110',
				bootstrap: { ready: true, runtimeRevision: SPECTRA_CONTENT_RUNTIME_REVISION },
				status: {
					config: { volume: 110, volumeBase: 100, boost: 1.1 },
					actualMode: 'webaudio',
				},
			});
			expect(await hasOffscreenAudioTab(tabId)).toBe(false);
			await tapDefaultShortcut(coldPage, 'ArrowDown');
			await eventually(
				async () => ({
					badge: await readBadgeText(tabId),
					status: await readContentStatus(coldUrl),
				}),
				(state) => state.status.config?.volume === 100
					&& state.status.config.boost === 1
					&& state.badge === '100',
				'cold volume-down acknowledgement after page WebAudio activation',
			);
			await tapDefaultShortcut(coldPage, 'ArrowLeft');
			await eventually(
				() => coldPage.evaluate(() => (
					document.querySelector<HTMLMediaElement>('video,audio')?.playbackRate
				)),
				(rate) => rate === 0.9,
				'cold speed-down acknowledgement',
			);
			await tapDefaultShortcut(coldPage, 'ArrowRight');
			await eventually(
				() => coldPage.evaluate(() => (
					document.querySelector<HTMLMediaElement>('video,audio')?.playbackRate
				)),
				(rate) => rate === 1,
				'cold speed-up acknowledgement',
			);
			await tapDefaultShortcut(coldPage, 'KeyM');
			await eventually(
				async () => ({
					muted: await coldPage.evaluate(() => (
						document.querySelector<HTMLMediaElement>('video,audio')?.muted
					)),
					osd: await coldPage.evaluate(() => (
						document.querySelector<HTMLElement>('#spectra-osd-host')
							?.shadowRoot?.getElementById('t')?.textContent
					)),
					badge: await readBadgeText(tabId),
				}),
				(state) => state.muted === true && state.osd === 'MUTE' && state.badge === 'M',
				'cold mute acknowledgement, OSD, and badge projection',
			);
			expect(await coldPage.evaluate(() => (
				(window as Window & {
					__spectraWebsiteHotkeys?: { codes: string[] };
				}).__spectraWebsiteHotkeys?.codes
			))).toEqual([]);
			await coldPage.evaluate(() => {
				const websiteHotkeys = (window as Window & {
					__spectraWebsiteHotkeys?: { reserveMute: boolean };
				}).__spectraWebsiteHotkeys;
				if (!websiteHotkeys) throw new Error('Website hotkey probe is missing');
				websiteHotkeys.reserveMute = true;
			});
			await tapDefaultShortcut(coldPage, 'KeyM');
			await eventually(
				() => coldPage.evaluate(() => ({
					muted: document.querySelector<HTMLMediaElement>('video,audio')?.muted,
					codes: (window as Window & {
						__spectraWebsiteHotkeys?: { codes: string[] };
					}).__spectraWebsiteHotkeys?.codes,
				})),
				(state) => state.muted === false && state.codes?.length === 0,
				'reserved mute remains extension-owned despite a website preventDefault handler',
			);
			expect(coldPage.url()).toBe(coldUrl);
		} finally {
			await releaseSyntheticCapture();
			await coldPage.close();
		}
	}, 30_000);

	test('owns reserved default hotkeys before website handlers without editable takeover or release tails', async () => {
		type ArbiterMode = 'document-stop' | 'observe' | 'repeat-stop' | 'window-prevent';
		interface ArbiterProbe {
			mode: ArbiterMode;
			documentStops: number;
			repeatStops: number;
			keyupStops: number;
			popstates: number;
			windowEvents: Array<{
				mode: ArbiterMode;
				code: string;
				defaultPrevented: boolean;
				repeat: boolean;
				target: string;
			}>;
		}
		const arbiterUrl = `${fixtureUrl}?hotkey-arbiter=1`;
		const arbiterPage = await browser.newPage();
		const readMedia = () => arbiterPage.evaluate(() => {
			const media = document.querySelector<HTMLMediaElement>('video,audio');
			const osd = document.querySelector<HTMLElement>('#spectra-osd-host')
				?.shadowRoot?.getElementById('o');
			return {
				href: location.href,
				popstates: (window as Window & { __spectraArbiterProbe?: ArbiterProbe })
					.__spectraArbiterProbe?.popstates ?? 0,
				speed: media?.playbackRate ?? -1,
				volume: Math.round((media?.volume ?? -1) * 100),
				osd: osd?.querySelector<HTMLElement>('#t')?.textContent ?? '',
				osdVisible: osd?.classList.contains('v') ?? false,
			};
		});
		const setMode = (mode: ArbiterMode) => arbiterPage.evaluate((nextMode) => {
			const probe = (window as Window & { __spectraArbiterProbe?: ArbiterProbe })
				.__spectraArbiterProbe;
			if (!probe) throw new Error('Default hotkey arbiter probe is missing');
			probe.mode = nextMode;
		}, mode);
		const focusBody = () => arbiterPage.evaluate(() => {
			document.body.tabIndex = -1;
			document.body.focus();
		});
		const waitForOsdToSettle = () => arbiterPage.waitForFunction(() => {
			const osd = document.querySelector<HTMLElement>('#spectra-osd-host')
				?.shadowRoot?.getElementById('o');
			return osd !== null && osd !== undefined && !osd.classList.contains('v');
		}, { timeout: 3_500 });

		try {
			await arbiterPage.goto(arbiterUrl, { waitUntil: 'domcontentloaded' });
			await arbiterPage.evaluate(() => {
				const media = document.querySelector<HTMLMediaElement>('video,audio');
				if (media) {
					media.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
				}
			});
			expect(await waitForContentBootstrapStatus(arbiterUrl)).toMatchObject({
				ready: false,
				runtimeRevision: null,
			});
			expect(await readMedia()).toMatchObject({ speed: 1, volume: 100 });
			await arbiterPage.evaluate(() => {
				const scope = window as Window & { __spectraArbiterProbe?: ArbiterProbe };
				const probe: ArbiterProbe = {
					mode: 'observe',
					documentStops: 0,
					repeatStops: 0,
					keyupStops: 0,
					popstates: 0,
					windowEvents: [],
				};
				scope.__spectraArbiterProbe = probe;
				const isDefault = (event: KeyboardEvent) => event.altKey
					&& ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'KeyM']
						.includes(event.code);
				document.addEventListener('keydown', (event) => {
					if (!isDefault(event)) return;
					if (probe.mode === 'document-stop' && event.code === 'ArrowRight') {
						probe.documentStops += 1;
						event.stopPropagation();
					} else if (probe.mode === 'repeat-stop'
						&& event.code === 'ArrowDown'
						&& event.repeat) {
						probe.repeatStops += 1;
						event.stopPropagation();
					}
				});
				document.addEventListener('keyup', (event) => {
					if (probe.mode !== 'repeat-stop' || event.code !== 'ArrowDown') return;
					probe.keyupStops += 1;
					event.stopPropagation();
				});
				window.addEventListener('keydown', (event) => {
					if (!isDefault(event)) return;
					const origin = event.composedPath()[0];
					probe.windowEvents.push({
						mode: probe.mode,
						code: event.code,
						defaultPrevented: event.defaultPrevented,
						repeat: event.repeat,
						target: origin instanceof Element ? origin.id || origin.tagName : '',
					});
					if (probe.mode === 'window-prevent') event.preventDefault();
				});
				window.addEventListener('popstate', () => {
					probe.popstates += 1;
				});

				const container = document.createElement('div');
				container.style.cssText = 'position:fixed;left:-10000px;top:0';
				const input = document.createElement('input');
				input.id = 'arbiter-input';
				const textarea = document.createElement('textarea');
				textarea.id = 'arbiter-textarea';
				const select = document.createElement('select');
				select.id = 'arbiter-select';
				select.append(new Option('one', 'one'));
				const editable = document.createElement('div');
				editable.id = 'arbiter-contenteditable';
				editable.contentEditable = 'true';
				editable.tabIndex = 0;
				const shadowHost = document.createElement('div');
				shadowHost.id = 'arbiter-shadow-host';
				const shadowInput = document.createElement('input');
				shadowInput.id = 'arbiter-shadow-input';
				shadowHost.attachShadow({ mode: 'open' }).append(shadowInput);
				container.append(input, textarea, select, editable, shadowHost);
				document.body.append(container);
			});

			await focusBody();
			await setMode('window-prevent');
			await tapDefaultShortcut(arbiterPage, 'ArrowRight');
			await eventually(
				readMedia,
				(state) => state.speed === 1.1 && state.osd === '1.1×' && state.osdVisible,
				'reserved speed key before a website preventDefault handler',
			);
			await waitForOsdToSettle();
			await setMode('document-stop');
			await tapDefaultShortcut(arbiterPage, 'ArrowRight');
			await eventually(
				readMedia,
				// This step owns browser-history exclusion. OSD visibility duration is
				// proved by the dedicated top-layer test and may settle before a busy
				// extracted-package run observes the already-acknowledged speed value.
				(state) => state.speed === 1.2 && state.osd === '1.2×',
				'reserved speed key before a website propagation stop',
			);
			await waitForOsdToSettle();
			await setMode('observe');
			const editableTargets = [
				'arbiter-input',
				'arbiter-textarea',
				'arbiter-select',
				'arbiter-contenteditable',
				'arbiter-shadow-input',
			];
			for (const target of editableTargets) {
				expect(await arbiterPage.evaluate((targetId) => {
					const shadow = document.getElementById('arbiter-shadow-host')?.shadowRoot;
					const element = targetId === 'arbiter-shadow-input'
						? shadow?.getElementById(targetId)
						: document.getElementById(targetId);
					if (!(element instanceof HTMLElement)) return false;
					element.focus();
					return targetId === 'arbiter-shadow-input'
						? shadow?.activeElement === element
						: document.activeElement === element;
				}, target)).toBe(true);
				await tapDefaultShortcut(arbiterPage, 'ArrowRight');
			}
			await focusBody();
			await tapDefaultShortcut(arbiterPage, 'ArrowRight');
			await eventually(
				readMedia,
				(state) => state.speed === 1.3 && state.osd === '1.3×' && state.osdVisible,
				'three reserved speed keys before website handlers and editable exclusions',
			);
			await waitForOsdToSettle();
			expect(await readMedia()).toMatchObject({ speed: 1.3, volume: 100 });

			const exclusionProbe = await arbiterPage.evaluate(() => {
				const probe = (window as Window & { __spectraArbiterProbe?: ArbiterProbe })
					.__spectraArbiterProbe;
				if (!probe) throw new Error('Default hotkey arbiter probe is missing');
				return probe;
			});
			expect(exclusionProbe.documentStops).toBe(0);
			expect(exclusionProbe.windowEvents
				.filter(({ target }) => editableTargets.includes(target))
				.map(({ target }) => target)).toEqual(editableTargets);
			expect(exclusionProbe.windowEvents).toHaveLength(editableTargets.length);

			const historyUrl = await arbiterPage.evaluate(() => {
				history.pushState({ spectraArbiter: true }, '', `${location.pathname}${location.search}#entry`);
				return location.href;
			});
			await focusBody();
			await tapDefaultShortcut(arbiterPage, 'ArrowLeft');
			await eventually(
				readMedia,
				// The dedicated top-layer test owns presentation duration. Here the
				// acknowledged speed and retained label prove command acceptance while
				// the URL/popstate assertions below prove browser-history exclusion.
				(state) => state.speed === 1.2 && state.osd === '1.2×',
				'accepted Alt+Left speed without history traversal',
			);
			await waitForOsdToSettle();
			expect(arbiterPage.url()).toBe(historyUrl);
			expect(await arbiterPage.evaluate(() => {
				const probe = (window as Window & { __spectraArbiterProbe?: ArbiterProbe })
					.__spectraArbiterProbe;
				if (!probe) throw new Error('Default hotkey arbiter probe is missing');
				return probe.popstates;
			})).toBe(0);

			await setMode('repeat-stop');
			await focusBody();
			await tapDefaultShortcut(arbiterPage, 'ArrowDown');
			await eventually(
				readMedia,
				(state) => state.volume === 90 && state.osd === '90%' && state.osdVisible,
				'reserved volume key before website handlers',
			);
			await waitForOsdToSettle();
			expect(await readMedia()).toMatchObject({ speed: 1.2, volume: 90 });
			expect(await arbiterPage.evaluate(() => {
				const probe = (window as Window & { __spectraArbiterProbe?: ArbiterProbe })
					.__spectraArbiterProbe;
				if (!probe) throw new Error('Default hotkey arbiter probe is missing');
				return {
					repeatStops: probe.repeatStops,
					keyupStops: probe.keyupStops,
				};
			})).toEqual({ repeatStops: 0, keyupStops: 0 });

			await setMode('observe');
			await tapDefaultShortcut(arbiterPage, 'ArrowUp');
			await eventually(
				readMedia,
				(state) => state.volume === 100 && state.osd === '100%' && state.osdVisible,
				'next volume key after truncated release',
			);
			await waitForOsdToSettle();
			expect(await readMedia()).toMatchObject({ speed: 1.2, volume: 100 });
			await tapDefaultShortcut(arbiterPage, 'ArrowUp');
			await eventually(
				async () => ({
					status: await readContentStatus(historyUrl),
					media: await readMedia(),
				}),
				(state) => state.status.config?.volume === 110
					&& state.status.config.boost === 1.1
					&& state.media.volume === 100
					&& state.media.osd === '110%'
					&& state.media.osdVisible,
				'first reserved volume key crosses the native 100 percent boundary',
			);
		} finally {
			await arbiterPage.keyboard.up('ArrowDown').catch(() => undefined);
			await arbiterPage.keyboard.up('Alt').catch(() => undefined);
			await arbiterPage.close();
		}
	}, 35_000);

	test('arbitrates configured site hotkeys website-first and releases a truncated keyup', async () => {
		type SiteArbiterMode =
			| 'document-stop'
			| 'observe'
			| 'window-keyup-stop'
			| 'window-prevent';
		interface SiteArbiterProbe {
			mode: SiteArbiterMode;
			documentStops: number;
			keyupStops: number;
			unclaimedWindowEvents: string[];
		}
		const siteDomain = 'localhost';
		const siteUrl = new URL(fixtureUrl);
		siteUrl.hostname = siteDomain;
		siteUrl.search = '?configured-site-hotkey-arbiter=1';
		const targetUrl = siteUrl.toString();
		const client = await openExtensionClient('options.html');
		let hotkeyPage: Page | null = null;
		let originalSite: SettingsSnapshot['hotkeySettings']['sites'][string] | null = null;
		let originalSiteCaptured = false;
		try {
			const configured = await replaceHotkeySite(client, siteDomain, {
					enabled: true,
					bindings: [{
						id: 'smoke-configured-site-speed',
						enabled: true,
						key: {
							code: 'KeyK',
							modifiers: {
								ctrl: false, alt: false, shift: false, meta: false,
							},
						},
						action: 'speed_up',
						params: { step: 0.1 },
					}],
			});
			originalSite = configured.previous.hotkeySettings.sites[siteDomain] ?? null;
			originalSiteCaptured = true;

			const page = await browser.newPage();
			hotkeyPage = page;
			await page.evaluateOnNewDocument(() => {
				const scope = window as Window & { __spectraSiteArbiterProbe?: SiteArbiterProbe };
				const probe: SiteArbiterProbe = {
					mode: 'observe',
					documentStops: 0,
					keyupStops: 0,
					unclaimedWindowEvents: [],
				};
				scope.__spectraSiteArbiterProbe = probe;
				const isCandidate = (event: KeyboardEvent) => (
					event.code === 'KeyK'
					&& !event.ctrlKey
					&& !event.altKey
					&& !event.shiftKey
					&& !event.metaKey
				) || event.altKey
					&& event.code === 'ArrowRight';
				document.addEventListener('keydown', (event) => {
					if (!isCandidate(event)
						|| probe.mode !== 'document-stop'
						|| event.code !== 'KeyK') return;
					probe.documentStops += 1;
					event.stopPropagation();
				});
				window.addEventListener('keyup', (event) => {
					if (probe.mode !== 'window-keyup-stop' || event.code !== 'KeyK') return;
					probe.keyupStops += 1;
					event.stopImmediatePropagation();
				}, true);
				window.addEventListener('keydown', (event) => {
					if (!isCandidate(event)) return;
					if (!event.defaultPrevented) {
						probe.unclaimedWindowEvents.push(
							`${probe.mode}:${event.code}:${event.repeat}`,
						);
					}
					if (probe.mode === 'window-prevent' && event.code === 'KeyK') {
						event.preventDefault();
					}
				});
			});
			await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
			await eventually(
				() => evaluateServiceWorker(async (configuredUrl) => {
					const tab = (await chrome.tabs.query({})).find(
						(candidate) => candidate.url === configuredUrl,
					);
					if (tab?.id === undefined) return null;
					const [inspection] = await chrome.scripting.executeScript({
						target: { tabId: tab.id },
						world: 'ISOLATED',
						func: () => {
							const marker = (window as Window & {
								__SPECTRA_LEAN_SITE_HOTKEY_HOST__?: {
									revision?: unknown;
									active?: unknown;
								};
							}).__SPECTRA_LEAN_SITE_HOTKEY_HOST__;
							return { revision: marker?.revision, active: marker?.active };
						},
						});
						return inspection?.result ?? null;
					}, targetUrl),
				(marker) => marker?.revision === 2 && marker.active === true,
				'configured site lean hotkey host',
				15_000,
			);
			const tabId = await getTabId(targetUrl);
			await page.bringToFront();

			const focusBody = () => page.evaluate(() => {
				document.body.tabIndex = -1;
				document.body.focus();
			});
			const setMode = (mode: SiteArbiterMode) => page.evaluate((nextMode) => {
				const probe = (window as Window & { __spectraSiteArbiterProbe?: SiteArbiterProbe })
					.__spectraSiteArbiterProbe;
				if (!probe) throw new Error('Configured site hotkey arbiter probe is missing');
				probe.mode = nextMode;
			}, mode);
			const readState = () => page.evaluate(() => {
				const probe = (window as Window & { __spectraSiteArbiterProbe?: SiteArbiterProbe })
					.__spectraSiteArbiterProbe;
				if (!probe) throw new Error('Configured site hotkey arbiter probe is missing');
				return {
					speed: document.querySelector<HTMLMediaElement>('video,audio')?.playbackRate ?? -1,
					probe,
				};
			});
			const readControlSnapshot = () => client.evaluate(
				async (targetTabId) => chrome.runtime.sendMessage({
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					tabId: targetTabId,
					type: 'spectra.control.snapshot.get',
					payload: { tabId: targetTabId },
				}),
				tabId,
			) as Promise<{
				ok: boolean;
				data?: ControlSnapshot;
				error?: { message?: string };
			}>;
			const waitForHotkeyFeedbackWindow = async () => {
				await page.waitForFunction(() => {
					const osd = document.querySelector<HTMLElement>('#spectra-osd-host')
						?.shadowRoot?.getElementById('o');
					return osd?.classList.contains('v') === true;
				}, { timeout: 3_500 });
				await page.waitForFunction(() => {
					const osd = document.querySelector<HTMLElement>('#spectra-osd-host')
						?.shadowRoot?.getElementById('o');
					return osd !== null && osd !== undefined && !osd.classList.contains('v');
				}, { timeout: 3_500 });
			};
			const tapSiteHotkey = async () => {
				await page.keyboard.press('KeyK');
			};

			expect(await readState()).toMatchObject({ speed: 1 });
			await focusBody();
			for (const mode of ['window-prevent', 'document-stop'] as const) {
				await setMode(mode);
				await tapSiteHotkey();
				await new Promise((resolveWait) => setTimeout(resolveWait, 25));
				expect(await readState()).toMatchObject({ speed: 1 });
			}

			await setMode('observe');
			await tapSiteHotkey();
			await eventually(
				readState,
				(state) => state.speed === 1.1,
				'one accepted configured site hotkey',
			);
			await waitForHotkeyFeedbackWindow();
			expect(await readState()).toMatchObject({ speed: 1.1 });

			// Enabling a site-specific listener must not duplicate ownership of
			// the five shipped chords that remain bootstrap-owned.
			await tapDefaultShortcut(page, 'ArrowRight');
			await eventually(
				readState,
				(state) => state.speed === 1.2,
				'one default hotkey despite a colliding site binding',
			);
			await waitForHotkeyFeedbackWindow();
			expect(await readState()).toMatchObject({ speed: 1.2 });

			await setMode('window-keyup-stop');
			await page.keyboard.down('KeyK');
			await eventually(
				async () => ({
					page: await readState(),
					snapshot: await readControlSnapshot(),
				}),
				(state) => state.page.speed === 1.3
					&& state.snapshot.ok
					&& state.snapshot.data?.fields.speed?.phase === 'applied'
					&& state.snapshot.data.fields.speed.actual === 1.3,
				'acknowledged configured site hotkey initial held press',
			);
			// The canonical snapshot can become observable before the original
			// Content-side sendMessage promise runs its settlement microtask.
			// Wait for that gesture's owned feedback window instead of assuming
			// a fixed delay means its sole in-flight transaction has retired.
			await waitForHotkeyFeedbackWindow();
			await page.keyboard.down('KeyK');
			await eventually(
				readState,
				(state) => state.speed === 1.4,
				'one physical configured repeat before truncated release',
			);
			await page.keyboard.up('KeyK');
			await new Promise((resolveWait) => setTimeout(resolveWait, 25));
			expect(await readState()).toMatchObject({ speed: 1.4 });

			await setMode('observe');
			await tapSiteHotkey();
			await eventually(
				readState,
				(state) => state.speed === 1.5,
				'next configured site hotkey after truncated release',
			);
			await new Promise((resolveWait) => setTimeout(resolveWait, 25));
			const final = await readState();
			expect(final.speed).toBe(1.5);
			expect(final.probe.documentStops).toBe(1);
			expect(final.probe.keyupStops).toBe(1);
			expect(final.probe.unclaimedWindowEvents.some(
				(event) => event.startsWith('document-stop:'),
			)).toBe(false);
			expect(final.probe.unclaimedWindowEvents).toContain('window-prevent:KeyK:false');
			expect(final.probe.unclaimedWindowEvents).toContain('observe:KeyK:false');
			expect(final.probe.unclaimedWindowEvents.some(
				(event) => event.includes(':ArrowRight:'),
			)).toBe(false);
		} finally {
			await hotkeyPage?.keyboard.up('KeyK').catch(() => undefined);
			await hotkeyPage?.keyboard.up('Alt').catch(() => undefined);
			await hotkeyPage?.close().catch(() => undefined);
			try {
				if (originalSiteCaptured) {
					await replaceHotkeySite(client, siteDomain, originalSite);
				}
			} finally {
				await client.close().catch(() => undefined);
			}
		}
	}, 30_000);

	test('restores cold page-native volume and speed across refresh without showing a badge', async () => {
		const coldUrl = `${fixtureUrl}?cold-native-refresh=1`;
		const coldPage = await browser.newPage();
		const coldErrors: string[] = [];
		collectPageErrors(coldPage, coldErrors);
		try {
			await coldPage.goto(coldUrl, { waitUntil: 'domcontentloaded' });
			const initialBootstrap = await waitForContentBootstrapStatus(coldUrl);
			const tabId = await getTabId(coldUrl);
			expect(initialBootstrap).toMatchObject({ ready: false, runtimeRevision: null });
			expect(await readBadgeText(tabId)).toBe('');

			await coldPage.evaluate(() => {
				const media = document.querySelector<HTMLMediaElement>('#v');
				if (!media) throw new Error('Cold native fixture media is missing');
				media.volume = 0.64;
				media.playbackRate = 1.5;
				media.preservesPitch = false;
				media.dispatchEvent(new Event('volumechange'));
				media.dispatchEvent(new Event('ratechange'));
			});

			await eventually(
				() => evaluateServiceWorker(async (targetTabId) => {
					const key = `tab_session_${targetTabId}`;
					const stored = (await chrome.storage.session.get(key))[key] as {
						patch?: Record<string, unknown>;
					} | undefined;
					return stored?.patch ?? null;
				}, tabId),
				(patch) => patch?.volumeBase === 64
					&& patch.mediaMuted === false
					&& patch.speed === 1.5
					&& patch.preservePitch === false,
				'cold native session projection',
			);
			expect(await readContentBootstrapStatus(coldUrl)).toMatchObject({
				ready: false,
				runtimeRevision: null,
			});
			expect(await readBadgeText(tabId)).toBe('');

			await coldPage.reload({ waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(coldUrl);
			await eventually(
				() => coldPage.evaluate(() => {
					const media = document.querySelector<HTMLMediaElement>('#v');
					return {
						volume: media?.volume ?? null,
						speed: media?.playbackRate ?? null,
						preservePitch: media?.preservesPitch ?? null,
					};
				}),
				(state) => state.volume !== null
					&& Math.abs(state.volume - 0.64) < 0.000_001
					&& state.speed === 1.5
					&& state.preservePitch === false,
				'cold native refresh restoration',
			);
			expect(await readBadgeText(tabId)).toBe('');
		} finally {
			await coldPage.close().catch(() => undefined);
		}
		expect(coldErrors).toEqual([]);
	}, 35_000);

	test('drops a muted recommendation preview but preserves explicit intent for a same-origin detail', async () => {
		const origin = new URL(fixtureUrl).origin;
		const recommendationUrl = `${origin}/recommend.html`;
		const detailUrl = `${origin}/watch/42`;
		const page = await browser.newPage();
		const pageErrors: string[] = [];
		collectPageErrors(page, pageErrors);
		try {
			await page.goto(recommendationUrl, { waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(recommendationUrl);
			const tabId = await getTabId(recommendationUrl);
			await page.evaluate(() => {
				const media = document.querySelector<HTMLMediaElement>('#v');
				if (!media) throw new Error('Recommendation preview media is missing');
				media.muted = true;
				media.dispatchEvent(new Event('volumechange'));
			});
			await eventually(
				() => evaluateServiceWorker(async (targetTabId) => {
					const key = `tab_session_${targetTabId}`;
					const stored = (await chrome.storage.session.get(key))[key] as {
						identity?: { resourceUrl?: string };
						patch?: Record<string, unknown>;
					} | undefined;
					return stored ?? null;
				}, tabId),
				(stored) => stored?.identity?.resourceUrl === recommendationUrl
					&& stored.patch?.mediaMuted === true,
				'recommendation mute session projection',
			);
			await page.bringToFront();
			const explicit = await submitPopupControlIntent(tabId, {
				patch: { speed: 1.5 },
			});
			if (!explicit.ok) {
				throw new Error(explicit.error?.message ?? 'Unable to set explicit recommendation speed');
			}
			await eventually(
				() => evaluateServiceWorker(async (targetTabId) => {
					const key = `tab_session_${targetTabId}`;
					const stored = (await chrome.storage.session.get(key))[key] as {
						portablePatch?: Record<string, unknown>;
					} | undefined;
					return stored?.portablePatch ?? null;
				}, tabId),
				(patch) => patch?.speed === 1.5,
				'explicit cross-resource session projection',
			);

			await page.goto(detailUrl, { waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(detailUrl);
			await eventually(
				() => page.evaluate(() => {
					const media = document.querySelector<HTMLMediaElement>('#v');
					return {
						muted: media?.muted ?? null,
						speed: media?.playbackRate ?? null,
					};
				}),
				(state) => state.muted === false && state.speed === 1.5,
				'detail document keeps native mute and explicit speed',
			);
			const detailProjection = await evaluateServiceWorker(async (targetTabId) => {
				const key = `tab_session_${targetTabId}`;
				return (await chrome.storage.session.get(key))[key] as {
					identity?: { resourceUrl?: string };
					patch?: Record<string, unknown>;
					portablePatch?: Record<string, unknown>;
				} | undefined;
			}, tabId);
			expect(detailProjection).toMatchObject({
				identity: { resourceUrl: detailUrl },
				patch: { speed: 1.5 },
				portablePatch: { speed: 1.5 },
			});
			expect(detailProjection?.patch).toEqual({ speed: 1.5 });
		} finally {
			await page.close().catch(() => undefined);
		}
		expect(pageErrors).toEqual([]);
	}, 35_000);

	test('tracks SPA media additions and removals without activating Capture', async () => {
		await acquireSmokeRuntime();
		await fixturePage.evaluate(() => {
			document.querySelector('#v')?.remove();
			history.pushState({}, '', '/spa/empty');
		});
		expect((await waitForContentStatus((status) => !status.hasAudio)).hasAudio).toBe(false);

		await fixturePage.evaluate(() => {
			const container = document.createElement('section');
			container.id = 'spa-media';
			const video = document.createElement('video');
			video.id = 'v';
			video.controls = true;
			video.setAttribute('aria-label', 'SPA smoke test video');
			container.append(video);
			document.body.append(container);
			history.pushState({}, '', '/spa/media');
		});
		expect((await waitForContentStatus((status) => status.hasAudio)).hasAudio).toBe(true);
		expect(await fixturePage.evaluate(() => {
			return (window as Window & { __spectraAudioContextCount?: number })
				.__spectraAudioContextCount;
		})).toBe(0);

		const initialGeneration = (await readContentStatus()).generation ?? 0;
		await fixturePage.evaluate(() => history.pushState({}, '', '/spa/media?route=2'));
		const queryGeneration = (await waitForContentStatus(
			(status) => (status.generation ?? 0) > initialGeneration,
		)).generation ?? 0;
		await fixturePage.evaluate(() => { location.hash = 'details'; });
		const hashGeneration = (await waitForContentStatus(
			(status) => (status.generation ?? 0) > queryGeneration,
		)).generation ?? 0;
		expect(hashGeneration).toBeGreaterThan(queryGeneration);
		expect(await fixturePage.evaluate(() => location.search)).toBe('?route=2');
		expect(await fixturePage.evaluate(() => location.hash)).toBe('#details');
	});

	test('discovers one exact page-media controller for semantic volume, mute, and speed', async () => {
		const state = await fixturePage.evaluate(({ eventName, requestAttribute, resultAttribute }) => {
			const video = document.querySelector<HTMLVideoElement>('#v');
			const player = video?.parentElement;
			const outerPlayer = player?.parentElement;
			if (!video || !player || !outerPlayer) throw new Error('SPA video is missing');
			let volumeBase = 100;
			let mediaMuted = false;
			let speed = 1;
			const volumeController = { video } as {
				video: HTMLVideoElement;
				getVolume(): number;
				setVolume(value: number): void;
			};
			const controller = player as HTMLElement & {
				spectraExactController?: typeof volumeController;
				spectraRateController?: {
					video: HTMLVideoElement;
					playbackRate: number;
					setPlaybackRateByUser(value: number): void;
				};
				isMuted(): boolean;
				setMuted(value: boolean): void;
			};
			volumeController.getVolume = () => volumeBase;
			volumeController.setVolume = (value) => {
				volumeBase = value;
				video.volume = value / 100 * 0.6131;
			};
			controller.spectraExactController = volumeController;
			controller.isMuted = () => mediaMuted;
			controller.setMuted = (value) => {
				mediaMuted = value;
				video.muted = value;
			};
			const rateController = {
				video,
				playbackRate: speed,
				setPlaybackRateByUser(value: number) {
					this.playbackRate = value;
					speed = value;
					video.playbackRate = value;
				},
			};
			controller.spectraRateController = rateController;
			const decoyState = { volumeBase: 17, mediaMuted: true, speed: 2.5, writes: 0 };
			const decoy = outerPlayer as HTMLElement & {
				getVolume(): number;
				setVolume(value: number): void;
				isMuted(): boolean;
				setMuted(value: boolean): void;
				getPlaybackRate(): number;
				setPlaybackRate(value: number): void;
			};
			decoy.getVolume = () => decoyState.volumeBase;
			decoy.setVolume = (value) => { decoyState.volumeBase = value; decoyState.writes += 1; };
			decoy.isMuted = () => decoyState.mediaMuted;
			decoy.setMuted = (value) => { decoyState.mediaMuted = value; decoyState.writes += 1; };
			decoy.getPlaybackRate = () => decoyState.speed;
			decoy.setPlaybackRate = (value) => { decoyState.speed = value; decoyState.writes += 1; };
			video.volume = 0.6131;

			const transact = (operation: 'read' | 'write', field: string, value?: number | boolean) => {
				const requestId = crypto.randomUUID();
				video.setAttribute(requestAttribute, JSON.stringify({ requestId, operation, field, value }));
				video.dispatchEvent(new Event(eventName));
				const result = JSON.parse(video.getAttribute(resultAttribute) ?? '{}');
				video.removeAttribute(requestAttribute);
				video.removeAttribute(resultAttribute);
				return result;
			};
			const initialVolume = transact('read', 'volumeBase');
			const writtenVolume = transact('write', 'volumeBase', 50);
			const writtenMute = transact('write', 'mediaMuted', true);
			const writtenSpeed = transact('write', 'speed', 1.5);
			const result = {
				initialVolume,
				writtenVolume,
				writtenMute,
				writtenSpeed,
				page: { volumeBase, mediaMuted, speed },
				decoy: decoyState,
				native: { volume: video.volume, muted: video.muted, speed: video.playbackRate },
			};
			Reflect.deleteProperty(controller, 'spectraExactController');
			Reflect.deleteProperty(controller, 'spectraRateController');
			for (const key of ['isMuted', 'setMuted'] as const) {
				Reflect.deleteProperty(controller, key);
			}
			for (const key of [
				'getVolume', 'setVolume', 'isMuted', 'setMuted', 'getPlaybackRate', 'setPlaybackRate',
			] as const) Reflect.deleteProperty(decoy, key);
			video.volume = 1;
			video.muted = false;
			video.playbackRate = 1;
			return result;
		}, {
			eventName: SPECTRA_PAGE_MEDIA_EVENT,
			requestAttribute: SPECTRA_PAGE_MEDIA_REQUEST_ATTRIBUTE,
			resultAttribute: SPECTRA_PAGE_MEDIA_RESULT_ATTRIBUTE,
		});
		expect(state.initialVolume).toMatchObject({ supported: true, actual: 100 });
		expect(state.writtenVolume).toMatchObject({ supported: true, actual: 50 });
		expect(state.writtenMute).toMatchObject({ supported: true, actual: true });
		expect(state.writtenSpeed).toMatchObject({ supported: true, actual: 1.5 });
		expect(state.page).toEqual({ volumeBase: 50, mediaMuted: true, speed: 1.5 });
		expect(state.decoy).toEqual({ volumeBase: 17, mediaMuted: true, speed: 2.5, writes: 0 });
		expect(state.native).toEqual({ volume: 0.30655, muted: true, speed: 1.5 });
	});

	test('falls through a capped page controller and acknowledges high DOM playback speed once', async () => {
		const cappedUrl = `${fixtureUrl}?page-speed-cap=2`;
		const cappedPage = await browser.newPage();
		const extensionClient = await openExtensionClient();
		try {
			await cappedPage.goto(cappedUrl, { waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(cappedUrl);
			await cappedPage.bringToFront();
			const tabId = await getTabId(cappedUrl);
			const acknowledgement = await submitPopupControlIntent(
				tabId,
				{ patch: { speed: 4 } },
			);
			expect(acknowledgement).toMatchObject({
				ok: true,
				data: {
					fields: {
						speed: {
							phase: 'applied',
							strategy: 'dom-native',
							actual: 4,
						},
					},
				},
			});
			await eventually(
				() => cappedPage.evaluate(() => {
					const video = document.querySelector<HTMLVideoElement>('#v');
					const state = (window as Window & {
						__spectraPageMediaState?: { speed: number };
					}).__spectraPageMediaState;
					return {
						pageSpeed: state?.speed ?? null,
						domSpeed: video?.playbackRate ?? null,
					};
				}),
				(state) => state.pageSpeed === 1 && state.domSpeed === 4,
				'high-speed DOM fallback beyond the page controller range',
			);
			const snapshot = await extensionClient.evaluate(async (targetTabId) => (
				chrome.runtime.sendMessage({
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					tabId: targetTabId,
					type: 'spectra.control.snapshot.get',
					payload: { tabId: targetTabId },
				})
			), tabId);
			expect(snapshot).toMatchObject({
				ok: true,
				data: {
					fields: {
						speed: {
							strategy: 'dom-native',
							actual: 4,
						},
					},
				},
			});
		} finally {
			await extensionClient.close();
			await cappedPage.close().catch(() => undefined);
		}
	}, 35_000);

	test('automatically restores speed through a controller-backed same-document SPA modal', async () => {
		const spaUrl = `${fixtureUrl}?spa-controller-shell=1`;
		const spaPage = await browser.newPage();
		const extensionClient = await openExtensionClient();
		try {
			await spaPage.goto(spaUrl, { waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(spaUrl);
			await spaPage.bringToFront();
			const tabId = await getTabId(spaUrl);
			const seeded = await submitPopupControlIntent(
				tabId,
				{ patch: { speed: 2 } },
			);
			expect(seeded).toMatchObject({
				ok: true,
				data: { fields: { speed: { phase: 'applied', actual: 2 } } },
			});

			const documentToken = await spaPage.evaluate(() => {
				const previous = document.querySelector<HTMLVideoElement>('#v');
				if (!previous) throw new Error('SPA shell video is missing');
				const source = previous.currentSrc || previous.src;
				previous.remove();
				const container = document.createElement('div') as HTMLDivElement & {
					xgplayer?: {
						video: HTMLVideoElement;
						playbackRate: number;
						setPlaybackRateByUser(value: number): void;
					};
				};
				container.style.width = '640px';
				container.style.height = '360px';
				const video = document.createElement('video');
				video.id = 'v';
				video.muted = true;
				video.src = source;
				video.style.width = '640px';
				video.style.height = '360px';
				const state = { speed: 1, writes: 0 };
				container.xgplayer = {
					video,
					playbackRate: 1,
					setPlaybackRateByUser(value) {
						this.playbackRate = value;
						state.speed = value;
						state.writes += 1;
						video.playbackRate = value;
					},
				};
				container.append(video);
				document.body.append(container);
				const token = crypto.randomUUID();
				(window as Window & {
					__spectraPageMediaState?: typeof state;
					__spectraSpaDocumentToken?: string;
				}).__spectraPageMediaState = state;
				(window as Window & {
					__spectraSpaDocumentToken?: string;
				}).__spectraSpaDocumentToken = token;
				history.pushState({}, '', '/spa-modal?modal_id=spectra-fixture');
				return token;
			});
			await eventually(
				() => spaPage.evaluate(() => {
					const video = document.querySelector<HTMLVideoElement>('#v');
					const scope = window as Window & {
						__spectraPageMediaState?: { speed: number; writes: number };
						__spectraSpaDocumentToken?: string;
					};
					return {
						documentToken: scope.__spectraSpaDocumentToken ?? null,
						pageSpeed: scope.__spectraPageMediaState?.speed ?? null,
						writes: scope.__spectraPageMediaState?.writes ?? null,
						domSpeed: video?.playbackRate ?? null,
						url: location.href,
					};
				}),
				(state) => state.documentToken === documentToken
					&& state.pageSpeed === 2
					&& state.writes === 1
					&& state.domSpeed === 2
					&& state.url.includes('/spa-modal?modal_id='),
				'automatic same-document SPA speed restore through the page controller',
				8_000,
			);
			const snapshot = await extensionClient.evaluate(async (targetTabId) => (
				chrome.runtime.sendMessage({
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					tabId: targetTabId,
					type: 'spectra.control.snapshot.get',
					payload: { tabId: targetTabId },
				})
			), tabId);
			expect(snapshot).toMatchObject({
				ok: true,
				data: {
					fields: {
						speed: {
							phase: 'applied',
							strategy: 'page-native',
							actual: 2,
						},
					},
				},
			});
		} finally {
			await extensionClient.close();
			await spaPage.close().catch(() => undefined);
		}
	}, 35_000);

	test('replays speed when a pre-rendered same-document SPA modal becomes active', async () => {
		const spaUrl = `${fixtureUrl}?spa-prerendered-modal=1`;
		const spaPage = await browser.newPage();
		try {
			await spaPage.goto(spaUrl, { waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(spaUrl);
			await spaPage.bringToFront();
			const tabId = await getTabId(spaUrl);
			await spaPage.evaluate(() => {
				const feed = document.querySelector<HTMLVideoElement>('#v');
				if (!feed) throw new Error('SPA feed video is missing');
				feed.style.width = '320px';
				feed.style.height = '180px';
				const modal = document.createElement('video');
				modal.id = 'modal-video';
				modal.style.display = 'none';
				modal.style.width = '1280px';
				modal.style.height = '720px';
				const rateLabel = document.createElement('span');
				rateLabel.id = 'modal-rate-label';
				rateLabel.textContent = '1.0x';
				modal.addEventListener('ratechange', () => {
					rateLabel.textContent = `${modal.defaultPlaybackRate.toFixed(1)}x`;
				});
				document.body.append(modal, rateLabel);
			});

			const restored = await submitPopupControlIntent(
				tabId,
				{ patch: { speed: 2 } },
			);
			expect(restored).toMatchObject({
				ok: true,
				data: { fields: { speed: { phase: 'applied', actual: 2 } } },
			});
			expect(await spaPage.evaluate(() => {
				const feed = document.querySelector<HTMLVideoElement>('#v');
				const modal = document.querySelector<HTMLVideoElement>('#modal-video');
				return {
					feedRate: feed?.playbackRate ?? null,
					modalRate: modal?.playbackRate ?? null,
					label: document.querySelector('#modal-rate-label')?.textContent ?? null,
				};
			})).toEqual({ feedRate: 2, modalRate: 1, label: '1.0x' });

			await spaPage.evaluate(() => {
				const modal = document.querySelector<HTMLVideoElement>('#modal-video');
				if (!modal) throw new Error('SPA modal video is missing');
				modal.style.display = 'block';
				history.pushState({}, '', '/spa-modal?modal_id=spectra-fixture');
				// A pre-rendered player can become the active source without adding a
				// new <video>. Its native play lifecycle is therefore the exact media
				// identity boundary for desired-state replay.
				modal.dispatchEvent(new Event('play'));
			});
			await eventually(
				() => spaPage.evaluate(() => {
					const modal = document.querySelector<HTMLVideoElement>('#modal-video');
					return {
						currentRate: modal?.playbackRate ?? null,
						defaultRate: modal?.defaultPlaybackRate ?? null,
						label: document.querySelector('#modal-rate-label')?.textContent ?? null,
						url: location.href,
					};
				}),
				(state) => state.currentRate === 2
					&& state.defaultRate === 2
					&& state.label === '2.0x'
					&& state.url.includes('/spa-modal?modal_id='),
				'pre-rendered SPA modal speed and page-UI projection',
				8_000,
			);
		} finally {
			await spaPage.close().catch(() => undefined);
		}
	}, 35_000);

	test('upgrades restored DOM speed when a same-document SPA modal controller mounts later', async () => {
		const spaUrl = `${fixtureUrl}?spa-speed-shell=1`;
		const spaPage = await browser.newPage();
		try {
			await spaPage.goto(spaUrl, { waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(spaUrl);
			await spaPage.bringToFront();
			const tabId = await getTabId(spaUrl);
			const documentToken = await spaPage.evaluate(() => {
				const token = crypto.randomUUID();
				(window as Window & { __spectraSpaDocumentToken?: string })
					.__spectraSpaDocumentToken = token;
				return token;
			});
			const restored = await submitPopupControlIntent(
				tabId,
				{ patch: { speed: 2 } },
			);
			expect(restored).toMatchObject({
				ok: true,
				data: {
					fields: {
						speed: {
							phase: 'applied',
							strategy: 'dom-native',
							actual: 2,
						},
					},
				},
			});

			const mounted = await spaPage.evaluate((expectedDocumentToken) => {
				const video = document.querySelector<HTMLVideoElement>('#v');
				const host = video?.parentElement as (HTMLElement & {
					getPlaybackRate?: () => number;
					setPlaybackRate?: (value: number) => void;
				}) | null;
				if (!video || !host) throw new Error('SPA modal speed fixture is missing');
				const state = { speed: 1, writes: 0 };
				(window as Window & {
					__spectraPageMediaState?: typeof state;
				}).__spectraPageMediaState = state;
				host.getPlaybackRate = () => state.speed;
				host.setPlaybackRate = (value) => {
					state.speed = value;
					state.writes += 1;
					video.playbackRate = value;
				};
				history.pushState({}, '', '/spa-modal?modal_id=spectra-fixture');
				return {
					documentToken: (window as Window & {
						__spectraSpaDocumentToken?: string;
					}).__spectraSpaDocumentToken,
					expectedDocumentToken,
					pageSpeed: state.speed,
					domSpeed: video.playbackRate,
					url: location.href,
				};
			}, documentToken);
			expect(mounted).toMatchObject({
				documentToken,
				expectedDocumentToken: documentToken,
				pageSpeed: 1,
				domSpeed: 2,
			});
			expect(mounted.url).toContain('/spa-modal?modal_id=');

			const adjusted = await submitPopupControlIntent(
				tabId,
				{ patch: { speed: 2.5 } },
			);
			expect(adjusted).toMatchObject({
				ok: true,
				data: {
					fields: {
						speed: {
							phase: 'applied',
							strategy: 'page-native',
							actual: 2.5,
						},
					},
				},
			});
			await eventually(
				() => spaPage.evaluate(() => {
					const video = document.querySelector<HTMLVideoElement>('#v');
					const state = (window as Window & {
						__spectraPageMediaState?: { speed: number; writes: number };
						__spectraSpaDocumentToken?: string;
					}).__spectraPageMediaState;
					return {
						documentToken: (window as Window & {
							__spectraSpaDocumentToken?: string;
						}).__spectraSpaDocumentToken,
						pageSpeed: state?.speed ?? null,
						writes: state?.writes ?? null,
						domSpeed: video?.playbackRate ?? null,
					};
				}),
				(state) => state.documentToken === documentToken
					&& state.pageSpeed === 2.5
					&& state.writes === 1
					&& state.domSpeed === 2.5,
				'same-document SPA page-controller writer upgrade',
			);
		} finally {
			await spaPage.close().catch(() => undefined);
		}
	}, 35_000);

	test('synchronizes page-native media bidirectionally through Popup and the mute hotkey', async () => {
		await installPageMediaControllerHarness();
		await fixturePage.bringToFront();
		const tabId = await getTabId(fixturePage.url());
		const popupTarget = await openActionPopupTarget();
		const popup = await popupTarget.asPage();
		const popupErrors: string[] = [];
		popup.on('pageerror', (error) => popupErrors.push(error.message));
		const readSnapshot = () => popup.evaluate(async (targetTabId) => chrome.runtime.sendMessage({
			protocolVersion: 2,
			requestId: crypto.randomUUID(),
			tabId: targetTabId,
			type: 'spectra.control.snapshot.get',
			payload: { tabId: targetTabId },
		}), tabId) as Promise<{
			ok: boolean;
			data?: { fields: Record<string, { actual?: unknown; strategy?: string; controlled?: boolean }> };
			error?: { message?: string };
		}>;

		try {
			await popup.waitForSelector('.glass-card .vol-slider', { timeout: 8_000 });
			await popup.waitForFunction(() => {
				const volume = document.querySelector<HTMLInputElement>('.vol-slider');
				const speed = document.querySelector<HTMLInputElement>('.speed-input');
				return volume?.value === '100' && speed?.value === '1.00';
			}, { timeout: 8_000 });
			const initial = await readSnapshot();
			expect(initial).toMatchObject({
				ok: true,
				data: {
					fields: {
						volumeBase: { actual: 100, strategy: 'page-native' },
						mediaMuted: { actual: false, strategy: 'page-native' },
						speed: { actual: 1, strategy: 'page-native' },
					},
				},
			});

			await popup.$eval('.vol-slider', (element) => {
				const slider = element as HTMLInputElement;
				slider.value = '40';
				slider.dispatchEvent(new Event('input', { bubbles: true }));
				slider.dispatchEvent(new Event('change', { bubbles: true }));
			});
			await eventually(
				readPageMediaControllerHarness,
				(state) => state.volumeBase === 40 && Math.abs(state.domVolume - 0.24524) < 0.00001,
				'Popup page-native volume ACK',
			);

			await popup.$eval('.speed-input', (element) => {
				const input = element as HTMLInputElement;
				input.value = '1.50';
				input.dispatchEvent(new Event('change', { bubbles: true }));
			});
			await eventually(
				readPageMediaControllerHarness,
				(state) => state.speed === 1.5 && state.domSpeed === 1.5,
				'Popup page-native speed ACK',
			);

			await popup.click('.btn-mute');
			await eventually(
				readPageMediaControllerHarness,
				(state) => state.mediaMuted && !state.domMuted,
				'Popup controller-only mute ACK',
			);
			await eventually(
				readSnapshot,
				(snapshot) => snapshot.ok
					&& snapshot.data?.fields.volumeBase?.actual === 40
					&& snapshot.data.fields.speed?.actual === 1.5
					&& snapshot.data.fields.mediaMuted?.actual === true,
				'committed page-native Popup transaction',
			);

			await updatePageMediaControllerHarness({
				volumeBase: 70,
				mediaMuted: false,
				speed: 1.25,
			});
			await popup.waitForFunction(() => {
				const volume = document.querySelector<HTMLInputElement>('.vol-slider');
				const speed = document.querySelector<HTMLInputElement>('.speed-input');
				const mute = document.querySelector<HTMLElement>('.btn-mute');
				return volume?.value === '70'
					&& speed?.value === '1.25'
					&& mute?.getAttribute('aria-pressed') === 'false';
			}, { timeout: 8_000 });
			const pageObservationSnapshot = await readSnapshot();
			expect(pageObservationSnapshot).toMatchObject({
				ok: true,
				data: {
					fields: {
						volumeBase: { actual: 70, strategy: 'page-native' },
						mediaMuted: { actual: false, strategy: 'page-native' },
						speed: { actual: 1.25, strategy: 'page-native' },
					},
				},
			});
			// The first page event may have been the correlated tail of the preceding
			// Popup transaction. Re-emit the stable page value after its ACK so this
			// assertion exercises a genuine post-transaction page gesture.
			await updatePageMediaControllerHarness({ mediaMuted: false });

			const hotkey = await evaluateServiceWorker(async (targetTabId) => chrome.tabs.sendMessage(
				targetTabId,
				{
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					tabId: targetTabId,
					type: 'spectra.hotkey.trigger',
					payload: { action: 'volume_mute' },
				},
			), tabId);
			expect(hotkey).toMatchObject({ ok: true });
			await eventually(
				readPageMediaControllerHarness,
				(state) => state.mediaMuted && !state.domMuted,
				'controller-only mute hotkey ACK',
			);
			await popup.waitForFunction(() => (
				document.querySelector('.btn-mute')?.getAttribute('aria-pressed') === 'true'
			), { timeout: 8_000 });
			const finalSnapshot = await readSnapshot();
			expect(finalSnapshot).toMatchObject({
				ok: true,
				data: {
					fields: {
						volumeBase: { actual: 70, strategy: 'page-native' },
						mediaMuted: { actual: true, strategy: 'page-native' },
						speed: { actual: 1.25, strategy: 'page-native' },
					},
				},
			});
		} finally {
			await closeActionPopup(popup);
			await removePageMediaControllerHarness();
		}
		expect(popupErrors).toEqual([]);
	}, 35_000);

	test('restores durable acknowledged state and sticky badge after worker replacement plus refresh', async () => {
		// The preceding SPA test intentionally leaves a history-only /spa/media
		// URL that this fixture server does not serve on a real reload. Establish
		// the canonical document explicitly so this test owns its navigation.
		await fixturePage.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
		await waitForContentBootstrapStatus(fixtureUrl);
		await fixturePage.bringToFront();
		const tabId = await getTabId(fixturePage.url());
		try {
			await submitEffectiveVolume(tabId, 63);
			const speed = await submitPopupControlIntent(
				tabId,
				{ patch: { mediaMuted: false, speed: 1.75 } },
			);
			if (!speed.ok) {
				throw new Error(speed.error?.message ?? 'Unable to set refresh mute and speed');
			}
			await eventually(
				() => fixturePage.evaluate(() => {
					const media = document.querySelector<HTMLMediaElement>('#v');
					return { volume: media?.volume ?? null, speed: media?.playbackRate ?? null };
				}),
				(state) => state.volume !== null
					&& Math.abs(state.volume - 0.63) < 0.000_001
					&& state.speed === 1.75,
				'pre-refresh acknowledged media state',
			);
			expect(await readBadgeText(tabId)).toBe('63');

			await restartServiceWorker();
			const durableProjection = await evaluateServiceWorker(async (targetTabId) => {
				const key = `tab_session_${targetTabId}`;
				const stored = (await chrome.storage.session.get(key))[key] as {
					patch?: Record<string, unknown>;
				} | undefined;
				return stored?.patch ?? null;
			}, tabId);
			expect(durableProjection).toMatchObject({
				volumeBase: 63,
				boost: 1,
				mediaMuted: false,
				speed: 1.75,
			});

			await fixturePage.reload({ waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(fixturePage.url());
			await eventually(
				() => fixturePage.evaluate(() => {
					const media = document.querySelector<HTMLMediaElement>('#v');
					return { volume: media?.volume ?? null, speed: media?.playbackRate ?? null };
				}),
				(state) => state.volume !== null
					&& Math.abs(state.volume - 0.63) < 0.000_001
					&& state.speed === 1.75,
				'post-refresh restored media state',
				10_000,
			);
			await eventually(
				() => readBadgeText(tabId),
				(text) => text === '63',
				'post-refresh sticky badge projection',
				5_000,
			);
			const snapshot = await sendFromActionPopup<{
				ok: boolean;
				data?: { fields?: Record<string, { actual?: unknown }> };
			}>({
				protocolVersion: 2,
				tabId,
				type: 'spectra.control.snapshot.get',
				payload: { tabId },
			});
			expect(snapshot).toMatchObject({
				ok: true,
				data: {
					fields: {
						volumeBase: { actual: 63 },
						mediaMuted: { actual: false },
						speed: { actual: 1.75 },
					},
				},
			});
		} finally {
			await submitEffectiveVolume(tabId, 100).catch(() => undefined);
			await submitPopupControlIntent(
				tabId,
				{ patch: { mediaMuted: false, speed: 1 } },
			).catch(() => undefined);
		}
	}, 35_000);

	test('applies a site preset before the default global preset after worker replacement', async () => {
		const presetName = 'smoke-initialization-default';
		const siteUrl = new URL(fixtureUrl);
		siteUrl.hostname = 'localhost';
		siteUrl.search = '?site-preset=1';
		const globalUrl = new URL(fixtureUrl);
		globalUrl.search = '?global-preset=1';
		const client = await openExtensionClient();
		const original = await client.evaluate(async ({ presetName }) => {
			const send = (type: string, payload: Record<string, unknown>) => chrome.runtime.sendMessage({
				protocolVersion: 2,
				requestId: crypto.randomUUID(),
				type,
				payload,
			});
			let snapshot = await send('spectra.settings.get', {});
			if (!snapshot?.ok) throw new Error(snapshot?.error?.message ?? 'Unable to read preset baseline');
			const baseline = {
				defaultPresetId: snapshot.data.defaultPresetId,
				localSite: snapshot.data.audioSites.localhost ?? null,
				globalSite: snapshot.data.audioSites['127.0.0.1'] ?? null,
				preset: snapshot.data.audioPresets[presetName] ?? null,
			};
			const patch = async (value: Record<string, unknown>) => {
				const response = await send('spectra.settings.patch', {
					expectedRevision: snapshot.data.revision,
					patch: value,
				});
				if (!response?.ok) throw new Error(response?.error?.message ?? 'Unable to seed preset');
				snapshot = response;
			};
			await patch({ scope: 'audio-site', domain: '127.0.0.1', value: null });
			await patch({
				scope: 'audio-preset',
				name: presetName,
				value: {
					config: { volume: 54, volumeBase: 54, boost: 1, speed: 1.25 },
					meta: { type: 'global', name: presetName, createdAt: Date.now() },
				},
			});
			await patch({ scope: 'default-preset', value: presetName });
			await patch({
				scope: 'audio-site',
				domain: 'localhost',
				mode: 'replace',
				value: { volume: 73, volumeBase: 73, boost: 1, speed: 1.5 },
			});
			return baseline;
		}, { presetName });
		let sitePage: Page | null = null;
		let globalPage: Page | null = null;
		const presetErrors: string[] = [];
		try {
			await restartServiceWorker();
			sitePage = await browser.newPage();
			globalPage = await browser.newPage();
			await sitePage.evaluateOnNewDocument(() => {
				const removeFixtureMedia = (): void => {
					document.querySelector('#v')?.remove();
				};
				const observer = new MutationObserver(removeFixtureMedia);
				observer.observe(document, { childList: true, subtree: true });
				document.addEventListener('DOMContentLoaded', () => {
					removeFixtureMedia();
					observer.disconnect();
				}, { once: true });
			});
			collectPageErrors(sitePage, presetErrors);
			collectPageErrors(globalPage, presetErrors);
			await sitePage.goto(siteUrl.href, { waitUntil: 'domcontentloaded' });
			await globalPage.goto(globalUrl.href, { waitUntil: 'domcontentloaded' });
			await Promise.all([
				waitForContentBootstrapStatus(siteUrl.href),
				waitForContentBootstrapStatus(globalUrl.href),
			]);
			expect(await sitePage.evaluate(() => document.querySelector('#v'))).toBeNull();
			await sitePage.evaluate(() => {
				const media = document.createElement('video');
				media.id = 'v';
				media.controls = true;
				document.body.append(media);
			});

			const readMediaState = (page: Page) => page.evaluate(() => {
				const media = document.querySelector<HTMLMediaElement>('#v');
				return {
					volume: media?.volume ?? null,
					speed: media?.playbackRate ?? null,
				};
			});
			const initializedSitePage = requireValue(
				sitePage,
				'Expected the site preset page to be initialized',
			);
			const initializedGlobalPage = requireValue(
				globalPage,
				'Expected the global preset page to be initialized',
			);
			await eventually(
				() => readMediaState(initializedSitePage),
				(state) => state.volume !== null
					&& Math.abs(state.volume - 0.73) < 0.000_001
					&& state.speed === 1.5,
				'site preset initialization',
			);
			await eventually(
				() => readMediaState(initializedGlobalPage),
				(state) => state.volume !== null
					&& Math.abs(state.volume - 0.54) < 0.000_001
					&& state.speed === 1.25,
				'default global preset initialization',
			);
			const [siteTabId, globalTabId] = await Promise.all([
				getTabId(siteUrl.href),
				getTabId(globalUrl.href),
			]);
			await eventually(() => readBadgeText(siteTabId), (text) => text === '73', 'site preset badge');
			await eventually(() => readBadgeText(globalTabId), (text) => text === '54', 'global preset badge');
		} finally {
			await sitePage?.close().catch(() => undefined);
			await globalPage?.close().catch(() => undefined);
			await client.evaluate(async ({
				presetName,
				defaultPresetId,
				localSite,
				globalSite,
				originalPreset,
			}) => {
				const send = (type: string, payload: Record<string, unknown>) => chrome.runtime.sendMessage({
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					type,
					payload,
				});
				let snapshot = await send('spectra.settings.get', {});
				const patch = async (value: Record<string, unknown>) => {
					const response = await send('spectra.settings.patch', {
						expectedRevision: snapshot.data.revision,
						patch: value,
					});
					if (!response?.ok) throw new Error(response?.error?.message ?? 'Unable to restore preset baseline');
					snapshot = response;
				};
				await patch({ scope: 'default-preset', value: defaultPresetId });
				await patch({ scope: 'audio-preset', name: presetName, value: originalPreset });
				await patch(localSite
					? { scope: 'audio-site', domain: 'localhost', value: localSite, mode: 'replace' }
					: { scope: 'audio-site', domain: 'localhost', value: null });
				await patch(globalSite
					? { scope: 'audio-site', domain: '127.0.0.1', value: globalSite, mode: 'replace' }
					: { scope: 'audio-site', domain: '127.0.0.1', value: null });
			}, {
				presetName,
				defaultPresetId: original.defaultPresetId,
				localSite: original.localSite,
				globalSite: original.globalSite,
				originalPreset: original.preset,
			}).catch(() => undefined);
			await client.close().catch(() => undefined);
		}
		expect(presetErrors).toEqual([]);
	}, 45_000);

	test('fullscreen lifecycle preserves the site volume, mute, and playback rate', async () => {
		const preserved = await fixturePage.evaluate(async () => {
			const video = document.querySelector<HTMLVideoElement>('#v');
			if (!video) throw new Error('SPA video is missing');
			video.volume = 0.37;
			video.muted = true;
			video.playbackRate = 0.75;
			document.dispatchEvent(new Event('fullscreenchange'));
			document.dispatchEvent(new Event('webkitfullscreenchange'));
			await new Promise((resolveWait) => setTimeout(resolveWait, 50));
			return {
				volume: video.volume,
				muted: video.muted,
				playbackRate: video.playbackRate,
				audioContexts: (window as Window & { __spectraAudioContextCount?: number })
					.__spectraAudioContextCount,
			};
		});
		expect(preserved).toEqual({
			volume: 0.37,
			muted: true,
			playbackRate: 0.75,
			audioContexts: 0,
		});
		const status = await readContentStatus();
		expect(status).toMatchObject({
			desiredMode: 'bypass',
			actualMode: 'bypass',
			mode: 'bypass',
			phase: 'idle',
			lastError: null,
			config: {
				volume: 37,
				volumeBase: 37,
				boost: 1,
				muted: true,
				speed: 0.75,
			},
		});
	});

	test('initializes popup and options scripts without page exceptions', async () => {
		const offscreenContextsBeforePopup = await getOffscreenContextCount();
		const popupErrors: string[] = [];
		const popup = await browser.newPage();
		collectPageErrors(popup, popupErrors);
		await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
		await popup.waitForSelector('#view-main:not([hidden])');
		await popup.click('#btn-settings');
		await popup.waitForSelector('#view-settings:not([hidden])');
		await popup.waitForFunction(() => (
			document.querySelector('#registry-list')?.childElementCount ?? 0
		) > 0);
		const routeDomain = 'route-ui-smoke.example';
		await popup.type('#registry-new-domain', routeDomain);
		await popup.select('#registry-new-route', 'direct');
		await popup.click('#btn-add-domain');
		await popup.waitForFunction((domain) => (
			[...document.querySelectorAll('.registry-item-domain')]
				.some((element) => element.textContent === domain)
		), {}, routeDomain);
		const routed = await readSiteRouteRegistry(popup);
		expect(routed.entries.find((entry) => entry.domain === routeDomain)).toMatchObject({
			route: 'direct',
			source: 'user',
		});
		await popup.click('.registry-item-delete');
		await popup.waitForFunction((domain) => (
			![...document.querySelectorAll('.registry-item-domain')]
				.some((element) => element.textContent === domain)
		), {}, routeDomain);
		expect((await readSiteRouteRegistry(popup)).entries).not.toContainEqual(
			expect.objectContaining({ domain: routeDomain }),
		);
		expect(await popup.evaluate(() => ({
			mainHidden: document.querySelector('#view-main')?.hasAttribute('hidden'),
			mainInert: document.querySelector('#view-main')?.hasAttribute('inert'),
			mainAriaHidden: document.querySelector('#view-main')?.getAttribute('aria-hidden'),
			settingsAriaHidden: document.querySelector('#view-settings')?.getAttribute('aria-hidden'),
		}))).toEqual({
			mainHidden: true,
			mainInert: true,
			mainAriaHidden: 'true',
			settingsAriaHidden: 'false',
		});
		expect(await popup.evaluate(() => ({
			hasLegacyTabs: Boolean(document.querySelector('#tab-restricted, #tab-safe')),
		}))).toEqual({ hasLegacyTabs: false });
		await popup.click('#btn-back');
		await popup.waitForSelector('#view-main:not([hidden])');
		expect(popupErrors).toEqual([]);
		await popup.close();
		// A prior Capture test may leave the unified host inside its intentional
		// idle-close grace period. Popup startup must not create another host or
		// change that lifecycle; the physical context count is not globally zero.
		expect(await getOffscreenContextCount()).toBe(offscreenContextsBeforePopup);
		expect(await fixturePage.evaluate(() => {
			return (window as Window & { __spectraAudioContextCount?: number })
				.__spectraAudioContextCount;
		})).toBe(0);

		const optionsErrors: string[] = [];
		const options = await browser.newPage();
		collectPageErrors(options, optionsErrors);
		await options.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });
		await options.waitForSelector('#slots-list .slot-row');
		expect(await options.$$eval('#slots-list .slot-row', (rows) => rows.length))
			.toBe(EXTENSION_COMMAND_COUNT);
		expect(await options.evaluate(() => document.documentElement.dataset.theme)).toMatch(/^(light|dark)$/);

		const accessibilityTestDomain = 'a11y-smoke.example';
		await options.type('#site-input', accessibilityTestDomain);
		await options.click('#site-add-btn');
		await options.waitForFunction((domain) => {
			const select = document.querySelector<HTMLSelectElement>('#site-select');
			return select?.value === domain && !document.querySelector('#site-config')?.hasAttribute('hidden');
		}, {}, accessibilityTestDomain);

		await options.click('#site-add-binding');
		await options.waitForFunction(() => document.activeElement?.id === 'edit-key');
		await options.focus('#modal-save');
		await options.keyboard.press('Tab');
		expect(await options.evaluate(() => document.activeElement?.classList.contains('modal-close'))).toBe(true);
		await options.keyboard.down('Shift');
		await options.keyboard.press('Tab');
		await options.keyboard.up('Shift');
		expect(await options.evaluate(() => document.activeElement?.id)).toBe('modal-save');
		await options.keyboard.press('Escape');
		expect(await options.evaluate(() => {
			const modal = document.querySelector('#edit-modal');
			return {
				hidden: modal?.hasAttribute('hidden'),
				inert: modal?.hasAttribute('inert'),
				ariaHidden: modal?.getAttribute('aria-hidden'),
				activeId: document.activeElement?.id,
			};
		})).toEqual({
			hidden: true,
			inert: true,
			ariaHidden: 'true',
			activeId: 'site-add-binding',
		});

		options.once('dialog', (dialog) => void dialog.accept());
		await options.click('#site-delete');
		await options.waitForFunction((domain) => {
			const select = document.querySelector<HTMLSelectElement>('#site-select');
			return ![...select?.options ?? []].some((option) => option.value === domain);
		}, {}, accessibilityTestDomain);
		expect(optionsErrors).toEqual([]);
		await options.close();
	});

	test('renders Presets from the selected locale on first paint and language refresh', async () => {
		const siteDomain = 'i18n-site-smoke.example';
		const presetName = 'i18n-preset-smoke';
		const client = await openExtensionClient();
		const seeded = await client.evaluate(async ({ siteDomain, presetName }) => {
			const send = (type: string, payload: Record<string, unknown>) => chrome.runtime.sendMessage({
				protocolVersion: 2,
				requestId: crypto.randomUUID(),
				type,
				payload,
			});
			let snapshot = await send('spectra.settings.get', {});
			if (!snapshot?.ok) throw new Error(snapshot?.error?.message ?? 'Unable to read settings');
			const original = {
				language: snapshot.data.globalSettings.lang,
				defaultPresetId: snapshot.data.defaultPresetId,
			};
			const patch = async (value: Record<string, unknown>) => {
				const response = await send('spectra.settings.patch', {
					expectedRevision: snapshot.data.revision,
					patch: value,
				});
				if (!response?.ok) throw new Error(response?.error?.message ?? 'Unable to seed settings');
				snapshot = response;
			};
			await patch({ scope: 'global', changes: { lang: 'zh-CN' } });
			await patch({
				scope: 'audio-site',
				domain: siteDomain,
				mode: 'replace',
				value: { volume: 125, volumeBase: 100, boost: 1.25, speed: 1.25, compressor: true, pan: 1 },
			});
			await patch({
				scope: 'audio-preset',
				name: presetName,
				value: {
					config: { volume: 125, volumeBase: 100, boost: 1.25, speed: 1.25, compressor: true, pan: 1 },
					meta: { type: 'global', name: presetName, createdAt: Date.now() },
				},
			});
			await patch({ scope: 'default-preset', value: presetName });
			return original;
		}, { siteDomain, presetName });

		const popup = await browser.newPage();
		await popup.evaluateOnNewDocument(({ presetName }) => {
			const scope = window as Window & { __spectraI18nFirstDynamic?: Record<string, string> };
			const first: Record<string, string> = {};
			scope.__spectraI18nFirstDynamic = first;
			const record = (key: string, value: string | null | undefined) => {
				const normalized = value?.trim();
				if (!first[key] && normalized) first[key] = normalized;
			};
			const scan = () => {
				const presetItem = [...document.querySelectorAll<HTMLElement>('.preset-item')]
					.find((item) => item.querySelector('.preset-name span')?.textContent === presetName);
				const presetHeaders = [...document.querySelectorAll<HTMLElement>('.preset-section-header')];
				record('presetHeader', presetHeaders[0]?.textContent);
				record('presetSiteHeader', presetHeaders[1]?.textContent);
				record('presetDefault', presetItem?.querySelector('.preset-badge.default')?.textContent);
				record('presetSummary', presetItem?.querySelector('.preset-summary')?.textContent);
				record('presetApply', presetItem?.querySelector('.btn-preset-action.apply')?.getAttribute('title'));
				if (presetHeaders[0]) record('presetHeaderFontSize', getComputedStyle(presetHeaders[0]).fontSize);
			};
			new MutationObserver(scan).observe(document, {
				attributes: true,
				childList: true,
				characterData: true,
				subtree: true,
			});
			queueMicrotask(scan);
		}, { presetName });

		try {
			await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
			await popup.waitForSelector('#view-main:not([hidden])');
			await popup.click('#btn-settings');
			await popup.waitForFunction(({ presetName }) => {
				const presetReady = [...document.querySelectorAll('.preset-name span')]
					.some((element) => element.textContent === presetName);
				return presetReady;
			}, {}, { presetName });

			const firstDynamic = await popup.evaluate(() => (
				(window as Window & { __spectraI18nFirstDynamic?: Record<string, string> })
					.__spectraI18nFirstDynamic
			));
			expect(firstDynamic).toMatchObject({
					presetHeader: '全局预设',
					presetSiteHeader: '网站预设',
					presetDefault: '默认',
					presetApply: '应用预设',
				});
			expect(Number.parseFloat(firstDynamic?.presetHeaderFontSize ?? '0')).toBeGreaterThanOrEqual(13);
			expect(firstDynamic?.presetSummary).toContain('压缩');
			expect(firstDynamic?.presetSummary).toContain('声相:右');

			await popup.select('#set-lang', 'en-US');
			await popup.waitForFunction(({ presetName }) => {
				const presetItem = [...document.querySelectorAll<HTMLElement>('.preset-item')]
					.find((item) => item.querySelector('.preset-name span')?.textContent === presetName);
				return document.documentElement.lang === 'en-US'
					&& [...document.querySelectorAll('.preset-section-header')]
						.map((element) => element.textContent).join('|') === 'Global Presets|Site Presets'
					&& presetItem?.querySelector('.preset-badge.default')?.textContent === 'DEFAULT'
					&& presetItem?.querySelector('.btn-preset-action.apply')?.getAttribute('title') === 'Apply preset';
			}, { timeout: 8_000 }, { presetName });

			await popup.select('#set-lang', 'zh-CN');
			await popup.waitForFunction(({ presetName }) => {
				const presetItem = [...document.querySelectorAll<HTMLElement>('.preset-item')]
					.find((item) => item.querySelector('.preset-name span')?.textContent === presetName);
				return document.documentElement.lang === 'zh-CN'
					&& [...document.querySelectorAll('.preset-section-header')]
						.map((element) => element.textContent).join('|') === '全局预设|网站预设'
					&& presetItem?.querySelector('.preset-badge.default')?.textContent === '默认'
					&& presetItem?.querySelector('.btn-preset-action.apply')?.getAttribute('title') === '应用预设';
			}, { timeout: 8_000 }, { presetName });
		} finally {
			await popup.close().catch(() => undefined);
			await client.evaluate(async ({
				siteDomain,
				presetName,
				originalLanguage,
				originalDefaultPresetId,
			}) => {
				const send = (type: string, payload: Record<string, unknown>) => chrome.runtime.sendMessage({
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					type,
					payload,
				});
				let snapshot = await send('spectra.settings.get', {});
				const patch = async (value: Record<string, unknown>) => {
					const response = await send('spectra.settings.patch', {
						expectedRevision: snapshot.data.revision,
						patch: value,
					});
					if (!response?.ok) throw new Error(response?.error?.message ?? 'Unable to clean i18n settings');
					snapshot = response;
				};
				await patch({ scope: 'default-preset', value: originalDefaultPresetId });
				await patch({ scope: 'audio-preset', name: presetName, value: null });
				await patch({ scope: 'audio-site', domain: siteDomain, value: null });
				await patch({ scope: 'global', changes: { lang: originalLanguage } });
			}, {
				siteDomain,
				presetName,
				originalLanguage: seeded.language,
				originalDefaultPresetId: seeded.defaultPresetId,
			}).catch(() => undefined);
			await client.close().catch(() => undefined);
		}
	}, 35_000);

	test('keeps English and Chinese extension layouts bounded and exposes dynamic controls in the AX tree', async () => {
		const assertPageAudit = async (page: Page, label: string) => {
			const layout = await inspectExtensionLayout(page);
			expect(layout.documentOverflow, `${label} document overflow`).toBeLessThanOrEqual(0);
			expect(layout.controlsOutsideViewport, `${label} controls outside viewport`).toEqual([]);
			expect(layout.clippedText, `${label} clipped text`).toEqual([]);
			const accessibility = await inspectExtensionAccessibility(page);
			expect(accessibility.interactiveCount, `${label} interactive AX nodes`).toBeGreaterThan(0);
			expect(accessibility.namelessInteractive, `${label} unnamed controls`).toEqual([]);
			expect(accessibility.missingState, `${label} missing AX states`).toEqual([]);
			expect(accessibility.axPressedCount, `${label} pressed states`).toBeGreaterThanOrEqual(
				accessibility.domPressedCount,
			);
		};

		await fixturePage.bringToFront();
		const popupTarget = await openActionPopupTarget();
		const popup = await popupTarget.asPage();
		const popupDiagnostics: string[] = [];
		popup.on('pageerror', (error) => popupDiagnostics.push(`pageerror: ${error.message}`));
		popup.on('console', (message) => {
			if (message.type() === 'error' || message.type() === 'warning') {
				popupDiagnostics.push(`console.${message.type()}: ${message.text()}`);
			}
		});
		await popup.waitForSelector('#view-main:not([hidden])');
		await popup.waitForSelector('.glass-card', { timeout: 8_000 }).catch(async (error) => {
			const state = await popup.evaluate(async () => ({
				readyState: document.readyState,
				mainChildren: document.querySelector('#main-stage')?.childElementCount ?? -1,
				emptyHidden: document.querySelector('#empty-state')?.classList.contains('hidden') ?? false,
				bodyText: document.body.innerText.slice(0, 500),
				activeTabs: (await chrome.tabs.query({ active: true, currentWindow: true }))
					.map(({ id, url, active, windowId }) => ({ id, url, active, windowId })),
				allTabs: (await chrome.tabs.query({}))
					.map(({ id, url, active, windowId }) => ({ id, url, active, windowId })),
			})).catch(() => null);
			throw new Error(
				`Popup card stage did not initialize: ${JSON.stringify({ state, popupDiagnostics })}`,
				{ cause: error },
			);
		});
		const originalLanguage = await popup.$eval('#set-lang', (element) => (
			(element as HTMLSelectElement).value
		));
		try {
			const readPopupGeometry = () => popup.evaluate(() => {
				const shell = document.querySelector<HTMLElement>('.view-container');
				const main = document.querySelector<HTMLElement>('#view-main');
				const shellBounds = shell?.getBoundingClientRect();
				const mainBounds = main?.getBoundingClientRect();
				return {
					windowHeight: window.innerHeight,
					documentHeight: document.documentElement.scrollHeight,
					shellHeight: shellBounds?.height ?? -1,
					mainHeight: mainBounds?.height ?? -1,
					mainSlack: shellBounds && mainBounds ? shellBounds.bottom - mainBounds.bottom : -1,
					inlineMinHeight: shell?.style.minHeight ?? '',
					settingsMode: shell?.classList.contains('settings-view-active') ?? false,
					mainCards: document.querySelectorAll('#main-stage > .glass-card').length,
					backgroundCards: document.querySelectorAll('#bg-stage > .glass-card').length,
				};
			});
			const intrinsicMain = await readPopupGeometry();
			expect(intrinsicMain).toMatchObject({
				inlineMinHeight: '',
				settingsMode: false,
				mainCards: 1,
				backgroundCards: 0,
			});
			expect(Math.abs(intrinsicMain.shellHeight - intrinsicMain.mainHeight)).toBeLessThanOrEqual(1);
			expect(Math.abs(intrinsicMain.mainSlack)).toBeLessThanOrEqual(1);
			expect(intrinsicMain.windowHeight).toBeLessThan(600);
			expect(intrinsicMain.documentHeight).toBeLessThan(600);

			await popup.click('#btn-settings');
			await popup.waitForFunction(() => (
				document.querySelector('.view-container')?.classList.contains('settings-view-active') === true
				&& document.querySelector('#view-settings')?.hasAttribute('hidden') === false
			));
			const settingsGeometry = await readPopupGeometry();
			expect(settingsGeometry.settingsMode).toBe(true);
			expect(settingsGeometry.inlineMinHeight).toBe('');
			expect(settingsGeometry.shellHeight).toBeGreaterThanOrEqual(600);

			await popup.click('#btn-back');
			await popup.waitForFunction(() => (
				document.querySelector('.view-container')?.classList.contains('settings-view-active') === false
				&& document.querySelector('#view-main')?.hasAttribute('hidden') === false
				&& window.innerHeight < 600
			));
			const restoredMain = await readPopupGeometry();
			expect(restoredMain.inlineMinHeight).toBe('');
			expect(restoredMain.settingsMode).toBe(false);
			expect(restoredMain.shellHeight).toBeCloseTo(intrinsicMain.shellHeight, 0);
			expect(restoredMain.windowHeight).toBeCloseTo(intrinsicMain.windowHeight, 0);

			for (const language of ['en-US', 'zh-CN']) {
				await popup.select('#set-lang', language);
				await popup.waitForFunction(
					(expected) => document.documentElement.lang === expected,
					{},
					language,
				);
				await assertPageAudit(popup, `popup main ${language}`);
				await popup.waitForFunction(() => {
					const canvas = document.querySelector('.viz-canvas') as HTMLCanvasElement | null;
					if (!canvas) return false;
					const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
					return Boolean(pixels?.some((value, index) => index % 4 === 3 && value > 0));
				}, { timeout: 5_000 });
				const cardIdentity = await popup.evaluate(async () => {
					const selectors = [
						'#btn-theme', '#btn-hotkeys', '#btn-shortcuts', '#btn-remote', '#btn-settings',
						'.btn-reset', '.btn-save', '.btn-save-global', '.btn-mute', '.btn-pause',
						'.btn-pip', '.btn-hotkey-target', '.btn-goto-tab',
					].join(', ');
					const controls = [...document.querySelectorAll<HTMLElement>(selectors)].map((element) => ({
						title: element.title,
						ariaLabel: element.getAttribute('aria-label') ?? '',
					}));
					const canvas = document.querySelector('.viz-canvas') as HTMLCanvasElement | null;
					const island = document.querySelector('.viz-island') as HTMLElement | null;
					const bounds = canvas?.getBoundingClientRect();
					return {
						controls,
						icon: (document.querySelector('.meta-icon') as HTMLImageElement | null)?.src ?? '',
						permissions: await chrome.permissions.getAll(),
						visualizer: {
							hidden: island?.hidden ?? true,
							width: bounds?.width ?? 0,
							height: bounds?.height ?? 0,
						},
					};
				});
				expect(cardIdentity.controls).toHaveLength(13);
				expect(cardIdentity.controls.every(({ title, ariaLabel }) => (
					title.length > 0
					&& ariaLabel.length > 0
					&& title !== 'undefined'
					&& ariaLabel !== 'undefined'
				))).toBe(true);
				expect(cardIdentity.permissions.permissions).toContain('favicon');
				expect(cardIdentity.permissions.permissions).toContain('activeTab');
				expect(cardIdentity.icon).toContain('/_favicon/');
				expect(cardIdentity.visualizer).toMatchObject({ hidden: false, height: 40 });
				expect(cardIdentity.visualizer.width).toBeGreaterThan(0);
				await popup.click('#btn-settings');
				await popup.waitForSelector('#view-settings:not([hidden])');
				await assertPageAudit(popup, `popup settings ${language}`);
				await popup.click('#btn-back');
				await popup.waitForSelector('#view-main:not([hidden])');
			}
			await popup.$eval('.vol-slider', (element) => {
				const slider = element as HTMLInputElement;
				slider.value = '80';
				slider.dispatchEvent(new Event('input', { bubbles: true }));
				slider.dispatchEvent(new Event('change', { bubbles: true }));
			});
			await popup.waitForFunction(() => (
				(document.querySelector('.vol-slider') as HTMLInputElement | null)?.value === '80'
			));
			await popup.click('.btn-reset');
			await popup.waitForFunction(() => {
				const reset = document.querySelector('.btn-reset');
				const slider = document.querySelector('.vol-slider') as HTMLInputElement | null;
				const speed = document.querySelector('.speed-input') as HTMLInputElement | null;
				const eq = [...document.querySelectorAll<HTMLInputElement>('.eq-input')];
				return reset?.getAttribute('aria-busy') !== 'true'
					&& slider?.value === '100'
					&& speed?.value === '1.00'
					&& eq.every((input) => Number(input.value) === 0);
			}, { timeout: 20_000 }).catch(async (error) => {
				const state = await popup.evaluate(() => ({
					busy: document.querySelector('.btn-reset')?.getAttribute('aria-busy'),
					disabled: (document.querySelector('.btn-reset') as HTMLButtonElement | null)?.disabled,
					slider: (document.querySelector('.vol-slider') as HTMLInputElement | null)?.value,
					speed: (document.querySelector('.speed-input') as HTMLInputElement | null)?.value,
					toast: document.querySelector('[role="alert"]')?.textContent,
				}));
				throw new Error(`Popup reset did not settle: ${JSON.stringify({ state, popupDiagnostics })}`, {
					cause: error,
				});
			});
		} finally {
			await popup.select('#set-lang', originalLanguage).catch(() => undefined);
			await popup.waitForFunction(
				(expected) => document.documentElement.lang === expected,
				{ timeout: 5_000 },
				originalLanguage,
			).catch(() => undefined);
			await closeActionPopup(popup);
		}
		expect(popupDiagnostics).toEqual([]);

		const options = await browser.newPage();
		await options.setViewport({ width: 390, height: 800, deviceScaleFactor: 1 });
		await options.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });
		await options.waitForSelector('#slots-list .slot-row');
		expect(await options.$$eval('#slots-list .slot-row', (rows) => rows.length))
			.toBe(EXTENSION_COMMAND_COUNT);
		try {
			for (const language of ['en-US', 'zh-CN']) {
				await options.select('#lang-select', language);
				await options.waitForFunction(
					(expected) => document.documentElement.lang === expected,
					{},
					language,
				);
				await assertPageAudit(options, `options ${language}`);
			}
		} finally {
			await options.select('#lang-select', originalLanguage).catch(() => undefined);
			await options.waitForFunction(
				(expected) => document.documentElement.lang === expected,
				{ timeout: 5_000 },
				originalLanguage,
			).catch(() => undefined);
			await options.close();
		}
	}, 35_000);

	test('toggles native PiP from one Popup click without a second prompt', async () => {
		await fixturePage.bringToFront();
		const errorsBefore = fixtureErrors.length;
		await evaluateServiceWorker(async ({ url }) => {
			const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === url);
			if (tab?.id === undefined) throw new Error(`Unable to find PiP fixture tab: ${url}`);
			await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				world: 'ISOLATED',
				func: () => {
					const scope = window as Window & {
						__spectraOriginalRequestPictureInPicture?: HTMLVideoElement['requestPictureInPicture'];
						__spectraOriginalExitPictureInPicture?: Document['exitPictureInPicture'];
						__spectraPipActivation?: boolean;
					};
					if (!scope.__spectraOriginalRequestPictureInPicture) {
						scope.__spectraOriginalRequestPictureInPicture = HTMLVideoElement.prototype.requestPictureInPicture;
					}
					Object.defineProperty(document, 'pictureInPictureEnabled', {
						configurable: true,
						value: true,
					});
					Object.defineProperty(document, 'pictureInPictureElement', {
						configurable: true,
						value: null,
					});
					const fixtureVideo = document.querySelector('video');
					if (!fixtureVideo) throw new Error('PiP fixture video is missing');
					fixtureVideo.disablePictureInPicture = true;
					scope.__spectraOriginalExitPictureInPicture = document.exitPictureInPicture;
					HTMLVideoElement.prototype.requestPictureInPicture = function requestPictureInPicture() {
						scope.__spectraPipActivation = navigator.userActivation.isActive;
						if (!scope.__spectraPipActivation) {
							return Promise.reject(new DOMException('A user gesture is required', 'NotAllowedError'));
						}
						if (this.disablePictureInPicture) {
							return Promise.reject(new DOMException('Picture-in-Picture is disabled', 'InvalidStateError'));
						}
						Object.defineProperty(document, 'pictureInPictureElement', {
							configurable: true,
							value: this,
						});
						this.dispatchEvent(new Event('enterpictureinpicture'));
						return Promise.resolve({ width: 320, height: 180 } as PictureInPictureWindow);
					};
					document.exitPictureInPicture = () => {
						const current = document.pictureInPictureElement;
						Object.defineProperty(document, 'pictureInPictureElement', {
							configurable: true,
							value: null,
						});
						current?.dispatchEvent(new Event('leavepictureinpicture'));
						return Promise.resolve();
					};
				},
			});
		}, { url: fixturePage.url() });
		const popupTarget = await openActionPopupTarget();
		const popup = await popupTarget.asPage();
		const diagnostics: string[] = [];
		popup.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));
		popup.on('console', (message) => {
			if (message.type() === 'error' || message.type() === 'warning') {
				diagnostics.push(`console.${message.type()}: ${message.text()}`);
			}
		});
		try {
			await popup.waitForSelector('.glass-card');
			await popup.$eval('.btn-pip', (element) => (element as HTMLButtonElement).click());
			await popup.waitForFunction(
				() => {
					const button = document.querySelector('.btn-pip');
					return button?.getAttribute('aria-pressed') === 'true'
						&& button.getAttribute('aria-busy') !== 'true';
				},
				{ timeout: 3_000 },
			);
			const popupState = await popup.evaluate(() => ({
				pressed: document.querySelector('.btn-pip')?.getAttribute('aria-pressed'),
				busy: document.querySelector('.btn-pip')?.getAttribute('aria-busy'),
				toast: document.querySelector('.preset-toast')?.textContent,
			}));
			expect({ popupState, diagnostics }).toEqual({
				popupState: { pressed: 'true', busy: null },
				diagnostics: [],
			});
			expect(await fixturePage.$('#spectra-toast-host')).toBeNull();

			await popup.$eval('.btn-pip', (element) => (element as HTMLButtonElement).click());
			await popup.waitForFunction(() => {
				const button = document.querySelector('.btn-pip');
				return button?.getAttribute('aria-pressed') === 'false'
					&& button.getAttribute('aria-busy') !== 'true';
			});
			expect(diagnostics).toEqual([]);
			expect(fixtureErrors.slice(errorsBefore)).toEqual([]);
		} finally {
			await closeActionPopup(popup);
			await evaluateServiceWorker(async ({ url }) => {
				const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === url);
				if (tab?.id === undefined) return;
				await chrome.scripting.executeScript({
					target: { tabId: tab.id },
					world: 'ISOLATED',
					func: () => {
						const scope = window as Window & {
							__spectraOriginalRequestPictureInPicture?: HTMLVideoElement['requestPictureInPicture'];
							__spectraOriginalExitPictureInPicture?: Document['exitPictureInPicture'];
							__spectraPipActivation?: boolean;
						};
						if (scope.__spectraOriginalRequestPictureInPicture) {
							HTMLVideoElement.prototype.requestPictureInPicture = scope.__spectraOriginalRequestPictureInPicture;
							delete scope.__spectraOriginalRequestPictureInPicture;
						}
						if (scope.__spectraOriginalExitPictureInPicture) {
							document.exitPictureInPicture = scope.__spectraOriginalExitPictureInPicture;
							delete scope.__spectraOriginalExitPictureInPicture;
						}
						document.querySelectorAll('video').forEach((video) => {
							video.disablePictureInPicture = false;
						});
						delete scope.__spectraPipActivation;
						Reflect.deleteProperty(document, 'pictureInPictureEnabled');
						Reflect.deleteProperty(document, 'pictureInPictureElement');
					},
				});
			}, { url: fixturePage.url() });
		}
	}, 20_000);

	test('renders a real analyser spectrum at native volume 0, 40 and 100 without Capture', async () => {
		const visualizerErrors: string[] = [];
		const popupErrors: string[] = [];
		const visualizerPage = await browser.newPage();
		const settingsClient = await openExtensionClient('options.html');
		collectPageErrors(visualizerPage, visualizerErrors);
		const visualizerUrl = `${fixtureUrl}?dynamic-visualizer=1`;
		const visualizerDomain = new URL(visualizerUrl).hostname;
		let popup: Page | null = null;
		let previousVisualizerEnabled = true;
		const nativeVolumes = [0, 40, 100] as const;
		try {
			const settings = await patchExtensionSettings(settingsClient, {
				scope: 'global',
				changes: { visualizerEnabled: true },
			});
			previousVisualizerEnabled = settings.previous.globalSettings.visualizerEnabled;
			await visualizerPage.goto(visualizerUrl, { waitUntil: 'domcontentloaded' });
			await visualizerPage.bringToFront();
			await visualizerPage.evaluate(async (toneBytes) => {
				const fixture = document.querySelector<HTMLVideoElement>('#v');
				if (!fixture) throw new Error('Visualizer media fixture is missing');
				const media = document.createElement('audio');
				media.id = fixture.id;
				media.controls = true;
				media.src = URL.createObjectURL(new Blob([Uint8Array.from(toneBytes)], { type: 'audio/wav' }));
				media.loop = true;
				fixture.replaceWith(media);
				await new Promise<void>((resolveReady, rejectReady) => {
					media.addEventListener('canplay', () => resolveReady(), { once: true });
					media.addEventListener('error', () => {
						rejectReady(new Error(media.error?.message ?? `Media error ${String(media.error?.code)}`));
					}, { once: true });
					setTimeout(() => rejectReady(new Error(
						`Media load timeout: ready=${media.readyState}, network=${media.networkState}, error=${media.error?.message ?? 'none'}`,
					)), 5_000);
					media.load();
				});
				await media.play();
			}, [...SMOKE_TONE_WAV]);
			await waitForContentBootstrapStatus(visualizerUrl);
			await visualizerPage.bringToFront();
			const visualizerTabId = await getTabId(visualizerUrl);
			const native = await configureRuntime(visualizerUrl, {
				...DEFAULT_AUDIO_CONFIG,
				volume: nativeVolumes[0],
				volumeBase: nativeVolumes[0],
				eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
			});
			expect(native).toMatchObject({ actualMode: 'bypass', phase: 'idle' });
			// The first runtime acquisition may create the shared Options lease page,
			// which becomes Chrome's active tab. Restore the media tab immediately
			// before opening the action Popup so this test exercises the sole
			// foreground subscriber that is authorized to request transient Capture.
			await visualizerPage.bringToFront();
			await installVisualizerBatchProbe();
			const popupTarget = await openActionPopupTarget();
			popup = await popupTarget.asPage();
			collectPageErrors(popup, popupErrors);
			await popup.waitForSelector('.glass-card');

			const processorObservation = await eventually(
				async () => ({
					status: await readContentStatus(visualizerUrl),
					probe: await readVisualizerBatchProbe(),
					popup: await popup?.evaluate(() => {
						const canvas = document.querySelector<HTMLCanvasElement>('#main-stage .viz-canvas');
						const island = document.querySelector<HTMLElement>('#main-stage .viz-island');
						const bounds = canvas?.getBoundingClientRect();
						return {
							hidden: document.hidden,
							visibilityState: document.visibilityState,
							canvasConnected: canvas?.isConnected ?? false,
							canvasBounds: bounds
								? { width: bounds.width, height: bounds.height }
								: null,
							islandHidden: island?.classList.contains('hidden') ?? null,
							islandDisplay: island ? getComputedStyle(island).display : null,
							visualizerResources: performance.getEntriesByType('resource')
								.map((entry) => entry.name)
								.filter((name) => name.includes('visualizer') || name.includes('loop')),
						};
					}) ?? null,
				}),
				({ status }) => status.actualMode === 'webaudio'
					&& status.phase === 'active'
					&& status.config?.volume === nativeVolumes[0],
				'native-volume page WebAudio visualizer activation',
				15_000,
			);
			expect(processorObservation.status).toMatchObject({
				actualMode: 'webaudio',
				phase: 'active',
				config: { volume: nativeVolumes[0], volumeBase: nativeVolumes[0], boost: 1 },
			});
			const detectedRoutes = await eventually(
				() => readSiteRouteRegistry(settingsClient),
				(snapshot) => snapshot.entries.some((entry) => (
					entry.domain === visualizerDomain
					&& entry.route === 'direct'
					&& entry.source === 'auto'
				)),
				'acknowledged automatic direct-route record',
			);
			expect(detectedRoutes.entries).toContainEqual(expect.objectContaining({
				domain: visualizerDomain,
				route: 'direct',
				source: 'auto',
			}));
			expect(await hasOffscreenAudioTab(visualizerTabId)).toBe(false);
			await popup.waitForFunction(() => {
				const canvas = document.querySelector<HTMLCanvasElement>('#main-stage .viz-canvas');
				if (!canvas) return false;
				const pixels = canvas.getContext('2d')?.getImageData(
					0,
					0,
					canvas.width,
					Math.max(1, canvas.height - 4),
				).data;
				return Boolean(pixels?.some((value, index) => index % 4 === 3 && value > 0));
			}, { timeout: 15_000 });
			for (const volume of nativeVolumes.slice(1)) {
				await configureRuntime(visualizerUrl, {
					...DEFAULT_AUDIO_CONFIG,
					volume,
					volumeBase: volume,
					eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
				});
				const activeAtNativeVolume = await eventually(
					() => readContentStatus(visualizerUrl),
					(status) => status.actualMode === 'webaudio'
						&& status.phase === 'active'
						&& status.config?.volume === volume,
					`native-volume ${volume} page WebAudio visualizer continuity`,
				);
				expect(activeAtNativeVolume.config).toMatchObject({ volume, volumeBase: volume, boost: 1 });
				expect(await hasOffscreenAudioTab(visualizerTabId)).toBe(false);
			}
			const activeProbe = await eventually(
				readVisualizerBatchProbe,
				(probe) => probe.events.some((event) => {
					const payload = event.payload as { captureTabId?: unknown; tabIds?: unknown };
					return payload.captureTabId === visualizerTabId
						&& Array.isArray(payload.tabIds)
						&& payload.tabIds.includes(visualizerTabId);
				}),
				'active visualizer sampling',
			);
			expect(activeProbe.count).toBeGreaterThan(0);

			await closeActionPopup(popup);
			popup = null;
			const bypass = await eventually(
				() => readContentStatus(visualizerUrl),
				(status) => status.actualMode === 'bypass' && status.phase === 'idle',
				10_000,
			);
			expect(bypass).toMatchObject({ actualMode: 'bypass', phase: 'idle' });
			let settledProbeCount = -1;

			// Release evidence is twofold. The preferred signal is the popup's
			// final empty batch request, but an abrupt popup teardown can destroy
			// that in-flight message after the background has already processed the
			// authoritative disconnect tombstone (bypass above). Accept the stream
			// settling with no further demands as equivalent so slow CI machines
			// are not failed by a lost fire-and-forget request.
			const release = await eventually(
				async () => {
					const probe = await readVisualizerBatchProbe();
					const emptyAnnounced = probe.events.some((event) => {
						const payload = event.payload as { captureTabId?: unknown; tabIds?: unknown };
						return payload.captureTabId === null
							&& Array.isArray(payload.tabIds)
							&& payload.tabIds.length === 0;
					});
					return { probe, emptyAnnounced };
				},
				({ probe, emptyAnnounced }) => {
					if (emptyAnnounced) return true;
					settledProbeCount = settledProbeCount < 0 ? probe.count : settledProbeCount;
					return probe.count === settledProbeCount && probe.count > 0;
				},
				'visualizer subscription release or batch stream settle',
			);
			const settledCount = release.probe.count;
			await new Promise((resolveWait) => setTimeout(resolveWait, 50));
			expect(await readVisualizerBatchCount()).toBe(settledCount);
		} finally {
			if (popup) await closeActionPopup(popup);
			await removeVisualizerBatchProbe();
			await patchExtensionSettings(settingsClient, {
				scope: 'global',
				changes: { visualizerEnabled: previousVisualizerEnabled },
			}).catch(() => undefined);
			await settingsClient.close().catch(() => undefined);
			await visualizerPage.close().catch(() => undefined);
		}
		expect(popupErrors).toEqual([]);
		expect(visualizerErrors).toEqual([]);
	}, 40_000);

	test('keeps visualizer IPC and Capture at zero when the feature is disabled', async () => {
		const settingsClient = await openExtensionClient('options.html');
		const settings = await patchExtensionSettings(settingsClient, {
			scope: 'global',
			changes: { visualizerEnabled: false },
		});
		await fixturePage.bringToFront();
		const bypass = await configureRuntime(fixturePage.url(), {
			...DEFAULT_AUDIO_CONFIG,
			eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
		});
		expect(bypass).toMatchObject({ actualMode: 'bypass', phase: 'idle' });
		await installVisualizerBatchProbe();
		let popup: Page | null = null;
		let popupClient: CDPSession | null = null;
		try {
			const popupTarget = await openActionPopupTarget(5_000);
			popup = await popupTarget.asPage();
			if (!popup) throw new Error('Unable to attach to the visualizer action popup page');
			popupClient = await popup.createCDPSession();
			await popupClient.send('Runtime.enable');

			await new Promise((resolveWait) => setTimeout(resolveWait, 100));
			const initialProbe = await readVisualizerBatchProbe();
			expect(initialProbe.count, JSON.stringify(initialProbe.events)).toBe(0);
			expect(await readContentStatus(fixturePage.url())).toMatchObject({
				actualMode: 'bypass',
				phase: 'idle',
			});
			expect(await popup.$eval('.viz-island', (element) => element.classList.contains('hidden')))
				.toBe(true);

			await closeActionPopup(popup);
			popup = null;
			await new Promise((resolveWait) => setTimeout(resolveWait, 50));
			const countAfterClose = await readVisualizerBatchCount();
			await new Promise((resolveWait) => setTimeout(resolveWait, 50));
			expect(await readVisualizerBatchCount()).toBe(countAfterClose);
		} finally {
			if (popup) await closeActionPopup(popup).catch(() => undefined);
			await popupClient?.detach().catch(() => undefined);
			await removeVisualizerBatchProbe();
			await patchExtensionSettings(settingsClient, {
				scope: 'global',
				changes: { visualizerEnabled: settings.previous.globalSettings.visualizerEnabled },
			}).catch(() => undefined);
			await settingsClient.close().catch(() => undefined);
		}
	}, 10_000);

	test('renders localized volume and speed feedback in the browser top layer', async () => {
		const targetUrl = fixturePage.url();
		const extensionClient = await openExtensionClient('options.html');
		const tabId = await getTabId(targetUrl);
		let shortcutTargetPage: Page | null = null;
		const originalLanguage = await withDiagnosticTimeout(
			'select zh-CN for the OSD smoke test',
			() => setGlobalLanguage(extensionClient, 'zh-CN'),
			5_000,
		);

		try {
			await configureRuntime(targetUrl, {
				...DEFAULT_AUDIO_CONFIG,
				muted: false,
			});
			await fixturePage.bringToFront();
			await tapDefaultShortcut(fixturePage, 'KeyM');
			await fixturePage.waitForFunction(() => (
				document.querySelector<HTMLMediaElement>('video,audio')?.muted === true
				&& document.querySelector<HTMLElement>('#spectra-osd-host')
					?.shadowRoot?.getElementById('t')?.textContent === '静音'
			), { timeout: 5_000 });
			await tapDefaultShortcut(fixturePage, 'KeyM');
			await fixturePage.waitForFunction(() => (
				document.querySelector<HTMLMediaElement>('video,audio')?.muted === false
			), { timeout: 5_000 });
			const nativeBaseline = await submitPopupControlIntent(tabId, {
				mutations: [
					{ field: 'speed', operation: 'set', value: 1 },
				],
			});
			if (!nativeBaseline?.ok
				|| nativeBaseline.data.fields.speed?.actual !== 1) {
				throw new Error(nativeBaseline?.error?.message ?? 'Unable to establish the native speed baseline');
			}
			const speedShortcutUrl = fixturePage.url();
			await tapDefaultShortcut(fixturePage, 'ArrowLeft');
			await withDiagnosticTimeout('observe the acknowledged 0.9x top-layer OSD', () => (
				fixturePage.waitForFunction(() => {
					const media = document.querySelector<HTMLMediaElement>('video,audio');
					const host = document.querySelector<HTMLElement>('#spectra-osd-host');
					return media?.playbackRate === 0.9
						&& host?.matches(':popover-open') === true
						&& host.shadowRoot?.getElementById('t')?.textContent === '0.9×';
				}, { timeout: 5_000 })
			), 6_000);
			expect(await fixturePage.evaluate(() => {
				const host = document.querySelector<HTMLElement>('#spectra-osd-host');
				if (!host?.matches(':popover-open')) return false;
				host.hidePopover();
				document.dispatchEvent(new Event('fullscreenchange'));
				return host.matches(':popover-open');
			})).toBe(true);
			expect(fixturePage.url()).toBe(speedShortcutUrl);
			await startOsdFeedbackProbe(fixturePage, '×', true);
			await tapDefaultShortcut(fixturePage, 'ArrowRight');
			await withDiagnosticTimeout('observe the acknowledged 1.0x OSD', () => (
				fixturePage.waitForFunction(() => (
					document.querySelector<HTMLMediaElement>('video,audio')?.playbackRate === 1
					&& document.querySelector<HTMLElement>('#spectra-osd-host')
						?.shadowRoot?.getElementById('t')?.textContent === '1.0×'
				), { timeout: 5_000 })
			), 6_000);
			const speedLabels = [
				...new Set((await readOsdFeedback(fixturePage, 'speed', true)).frames.map(({ label }) => label)),
			];
			expect(speedLabels).toContain('0.9×');
			expect(speedLabels).toContain('1.0×');
			expect(speedLabels.every((label) => label === '0.9×' || label === '1.0×')).toBe(true);
			expect(fixturePage.url()).toBe(speedShortcutUrl);
			const speedMarkers = await fixturePage.evaluate(() => {
				const host = document.querySelector<HTMLElement>('#spectra-osd-host');
				const markers = [...host?.shadowRoot?.querySelectorAll<HTMLElement>('#marks .mk') ?? []];
				return markers.map((marker) => ({
					label: marker.dataset.label,
					lane: marker.classList.contains('upper') ? 'upper' : 'lower',
					left: Number.parseFloat(marker.style.left),
				}));
			});
			expect(speedMarkers.map(({ label, lane }) => ({ label, lane }))).toEqual([
				{ label: '1×', lane: 'lower' },
				{ label: '2×', lane: 'upper' },
			]);
			expect(speedMarkers[0]?.left).toBeCloseTo((1 - 0.1) / (16 - 0.1) * 100, 4);
			expect(speedMarkers[1]?.left).toBeCloseTo((2 - 0.1) / (16 - 0.1) * 100, 4);

			const shortcutTargetUrl = `${fixtureUrl}?shortcut-speed-target=1`;
			shortcutTargetPage = await browser.newPage();
			await shortcutTargetPage.goto(shortcutTargetUrl, { waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(shortcutTargetUrl);
			const shortcutTargetTabId = await getTabId(shortcutTargetUrl);
			const targetBaseline = await submitPopupControlIntent(shortcutTargetTabId, {
				mutations: [{ field: 'speed', operation: 'set', value: 1 }],
			});
			if (!targetBaseline.ok || targetBaseline.data.fields.speed?.actual !== 1) {
				throw new Error(targetBaseline.error?.message ?? 'Unable to initialize shortcut target speed');
			}
			await setHotkeyTarget(extensionClient, shortcutTargetTabId);
			await fixturePage.bringToFront();
			await tapDefaultShortcut(fixturePage, 'ArrowRight');
			const activeShortcutTargetPage = requireValue(
				shortcutTargetPage,
				'Expected the selected shortcut target page to be initialized',
			);
			await withDiagnosticTimeout(
				'observe selected-target speed and foreground Toast',
				() => eventually(
					async () => {
						const [targetRate, foreground] = await Promise.all([
							activeShortcutTargetPage.evaluate(() => (
								document.querySelector<HTMLMediaElement>('video,audio')?.playbackRate ?? null
							)),
							fixturePage.evaluate(() => {
								const host = document.querySelector<HTMLElement>('#spectra-osd-host');
								return {
									rate: document.querySelector<HTMLMediaElement>('video,audio')?.playbackRate ?? null,
									open: host?.matches(':popover-open') === true,
									text: host?.shadowRoot?.getElementById('t')?.textContent ?? null,
									metaHidden: host?.shadowRoot?.getElementById('meta')?.hasAttribute('hidden') ?? null,
									meta: host?.shadowRoot?.getElementById('meta')?.textContent ?? null,
								};
							}),
						]);
						return { targetRate, foreground };
					},
					(state) => state.targetRate === 1.1
						&& state.foreground.rate === 1
						&& state.foreground.open
						&& state.foreground.text === '1.1×'
						&& state.foreground.metaHidden === false
						&& state.foreground.meta?.includes('127.0.0.1') === true,
					'selected-target speed and foreground Toast',
					5_000,
				),
				6_000,
			);
			expect(await shortcutTargetPage.evaluate(() => (
				document.querySelector<HTMLMediaElement>('video,audio')?.playbackRate
			))).toBe(1.1);
			await setHotkeyTarget(extensionClient, null);
			await shortcutTargetPage.close();
			shortcutTargetPage = null;
			await fixturePage.bringToFront();
			await startOsdFeedbackProbe(fixturePage, '×');
			await holdDefaultShortcut(fixturePage, 'ArrowRight', 11, 35);
			const speedAtRelease = await readOsdFeedback(fixturePage, 'speed');
			await new Promise((resolveWait) => setTimeout(resolveWait, 50));
			const heldSpeedFeedback = await readOsdFeedback(fixturePage, 'speed', true);
			expect(speedAtRelease).toMatchObject({
				visible: true,
				label: '2.2×',
				color: 'rgb(16, 185, 129)',
			});
			expect(heldSpeedFeedback).toMatchObject({
				actual: speedAtRelease.actual,
				visible: true,
				label: speedAtRelease.label,
				width: speedAtRelease.width,
				tone: speedAtRelease.tone,
				color: speedAtRelease.color,
			});
			expect(heldSpeedFeedback.frames).toHaveLength(speedAtRelease.frames.length);
			const heldSpeedLabels = [...new Set(
				heldSpeedFeedback.frames.map(({ label }) => label),
			)];
			expect(heldSpeedLabels).toEqual([
				'1.1×', '1.2×', '1.3×', '1.4×', '1.5×', '1.6×',
				'1.7×', '1.8×', '1.9×', '2.0×', '2.1×', '2.2×',
			]);
			const heldSpeedWidths = heldSpeedFeedback.frames.map(({ width }) => width);
			expect(heldSpeedWidths.every((width, index) => (
				index === 0 || width >= requireValue(
					heldSpeedWidths[index - 1],
					'Expected a previous held-speed frame width',
				) - 0.001
			))).toBe(true);
			expect(heldSpeedWidths.every((width, index) => (
				index === 0 || width - requireValue(
					heldSpeedWidths[index - 1],
					'Expected a previous held-speed frame width',
				) <= 0.55
			))).toBe(true);
			await withDiagnosticTimeout('wait for the released speed OSD display window', () => (
				fixturePage.waitForFunction(() => (
					document.querySelector<HTMLElement>('#spectra-osd-host')
						?.shadowRoot?.getElementById('o')?.classList.contains('v') === false
				), { timeout: 2_500 })
			), 3_000);
			await submitEffectiveVolume(tabId, 90);
			await withDiagnosticTimeout('observe the below-100 volume baseline', () => (
				fixturePage.waitForFunction(() => (
					Math.round((document.querySelector<HTMLMediaElement>('video,audio')?.volume ?? -1) * 100) === 90
				), { timeout: 5_000 })
			), 6_000);
			await startOsdFeedbackProbe(fixturePage, '%', true);
			await holdDefaultShortcut(fixturePage, 'ArrowDown', 18, 0, 55);
			const volumeAtRelease = await readOsdFeedback(fixturePage, 'volume');
			expect(volumeAtRelease.actual).toBeGreaterThanOrEqual(0);
			expect(volumeAtRelease.actual).toBeLessThanOrEqual(30);
			expect(volumeAtRelease).toMatchObject({
				visible: true,
				label: '静音',
				color: 'rgb(156, 163, 175)',
			});
			await new Promise((resolveWait) => setTimeout(resolveWait, 50));
			const releasedState = await readOsdFeedback(fixturePage, 'volume', true);
			expect(releasedState).toEqual(volumeAtRelease);
			const scalarFrames = releasedState.frames;
			const scalarLabels = [...new Set(scalarFrames.map(({ label }) => label))];
			expect(scalarLabels).toEqual([
				'80%', '70%', '60%', '50%', '40%', '30%', '20%', '10%',
			]);
			const scalarWidths = scalarFrames.map(({ width }) => width);
			expect(scalarWidths.every((width, index) => (
				index === 0 || width <= requireValue(
					scalarWidths[index - 1],
					'Expected a previous scalar feedback frame width',
				) + 0.001
			))).toBe(true);
			expect(scalarWidths.every((width, index) => (
				index === 0 || requireValue(
					scalarWidths[index - 1],
					'Expected a previous scalar feedback frame width',
				) - width <= 1
			))).toBe(true);
			// MutationObserver callback batching is a browser scheduling detail. The
			// exact label sequence and monotonic widths above are the product contract;
			// duplicate callbacks for one rendered value are not additional evidence.
		} finally {
			await setHotkeyTarget(extensionClient, null).catch(() => undefined);
			await shortcutTargetPage?.close().catch(() => undefined);
			await setGlobalLanguage(extensionClient, originalLanguage);
			await submitEffectiveVolume(tabId, 100).catch(() => undefined);
			await extensionClient.close().catch(() => undefined);
		}
	}, 30_000);

	test('releases feedback hosts and fullscreen promotion across content reinjection', async () => {
		const targetUrl = fixturePage.url();
		const tabId = await getTabId(targetUrl);
		await configureRuntime(targetUrl, {
			...DEFAULT_AUDIO_CONFIG,
			eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
		});
		await fixturePage.bringToFront();

		const waitForReinjectedRuntime = async (cycle: number): Promise<void> => {
			await reinjectContent(tabId);
			await eventually(
				() => inspectContentRuntime(tabId),
				(probe) => probe.listenersReady,
				`feedback runtime reinjection ${cycle}`,
				10_000,
			);
		};
		const readHostCounts = () => fixturePage.evaluate(() => ({
			osd: document.querySelectorAll('#spectra-osd-host').length,
			toast: document.querySelectorAll('#spectra-toast-host').length,
		}));

		try {
			// Establish a clean generation before measuring repeated handoff.
			await waitForReinjectedRuntime(0);
			expect(await readHostCounts()).toEqual({ osd: 0, toast: 0 });

			for (let cycle = 1; cycle <= 3; cycle += 1) {
				await tapDefaultShortcut(fixturePage, 'ArrowRight');
				await fixturePage.waitForFunction(() => (
					document.querySelectorAll('#spectra-osd-host').length === 1
				), { timeout: 5_000 });
				expect(await readHostCounts()).toEqual({ osd: 1, toast: 0 });
				await waitForReinjectedRuntime(cycle);
				await new Promise((resolveWait) => setTimeout(resolveWait, 50));
				expect(await fixturePage.evaluate(() => {
					document.dispatchEvent(new Event('fullscreenchange'));
					return {
						osd: document.querySelectorAll('#spectra-osd-host').length,
						toast: document.querySelectorAll('#spectra-toast-host').length,
					};
				})).toEqual({ osd: 0, toast: 0 });
			}

			await tapDefaultShortcut(fixturePage, 'ArrowLeft');
			await fixturePage.waitForFunction(() => (
				document.querySelectorAll('#spectra-osd-host').length === 1
				&& document.querySelector<HTMLElement>('#spectra-osd-host')
					?.matches(':popover-open') === true
			), { timeout: 5_000 });
			expect(await fixturePage.evaluate(() => {
				const host = document.querySelector<HTMLElement>('#spectra-osd-host');
				if (!host?.matches(':popover-open')) return null;
				host.hidePopover();
				document.dispatchEvent(new Event('fullscreenchange'));
				return {
					count: document.querySelectorAll('#spectra-osd-host').length,
					open: host.matches(':popover-open'),
				};
			})).toEqual({ count: 1, open: true });
		} finally {
			await submitPopupControlIntent(tabId, {
				mutations: [{ field: 'speed', operation: 'set', value: 1 }],
			}).catch(() => undefined);
			await reinjectContent(tabId).catch(() => undefined);
		}
	}, 35_000);

	test('retires feedback on the final runtime lease and reacquires one new generation', async () => {
		const targetUrl = `${fixtureUrl}?final-runtime-lease=1`;
		const page = await browser.newPage();
		const pageErrors: string[] = [];
		collectPageErrors(page, pageErrors);
		let lease: SmokeRuntimeLease | null = null;
		let reacquiredLease: SmokeRuntimeLease | null = null;
		try {
			await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
			expect(await waitForContentBootstrapStatus(targetUrl)).toMatchObject({
				ready: false,
				runtimeRevision: null,
				ownedSources: [],
			});
			const tabId = await getTabId(targetUrl);
			const publishFeedback = (
				owned: SmokeRuntimeLease,
				feedback?: { kind: 'speed'; value: number },
			): Promise<void> => evaluateServiceWorker(async ({ runtime, actualFeedback }) => {
				await chrome.tabs.sendMessage(runtime.tabId, {
					protocolVersion: 2,
					type: 'spectra.hotkey.target.feedback',
					tabId: runtime.tabId,
					payload: {
						action: 'speed_up',
						targetTabId: runtime.tabId,
						targetTitle: 'Final runtime lease',
						targetHostname: '127.0.0.1',
						...(actualFeedback ? { feedback: actualFeedback } : {}),
					},
				}, { documentId: runtime.documentId });
			}, { runtime: owned, actualFeedback: feedback });
			lease = await acquireSmokeRuntime(targetUrl, 'final-feedback-generation');
			await eventually(
				() => readContentBootstrapStatus(targetUrl),
				(status) => status.ready
					&& status.runtimeRevision === SPECTRA_CONTENT_RUNTIME_REVISION,
				'final-lease Content runtime',
				15_000,
			);
			expect(await inspectContentRuntime(tabId, true)).toMatchObject({
				listenersReady: true,
				runtimeRevision: SPECTRA_CONTENT_RUNTIME_REVISION,
				sameRuntime: true,
				oldRuntimeDisposed: false,
			});

			await publishFeedback(lease);
			await publishFeedback(lease, { kind: 'speed', value: 1 });
			await page.waitForFunction(() => (
				document.querySelectorAll('#spectra-osd-host').length === 1
				&& document.querySelectorAll('#spectra-toast-host').length === 1
				&& document.querySelector<HTMLElement>('#spectra-osd-host')
					?.matches(':popover-open') === true
			), { timeout: 5_000 });
			expect(await page.evaluate(() => {
				const scope = window as Window & {
					__spectraFinalFeedbackHosts?: {
						osd?: HTMLElement;
						toast?: HTMLElement;
					};
				};
				scope.__spectraFinalFeedbackHosts = {
					osd: document.querySelector<HTMLElement>('#spectra-osd-host') ?? undefined,
					toast: document.querySelector<HTMLElement>('#spectra-toast-host') ?? undefined,
				};
				return {
					osd: document.querySelectorAll('#spectra-osd-host').length,
					toast: document.querySelectorAll('#spectra-toast-host').length,
				};
			})).toEqual({ osd: 1, toast: 1 });

			await releaseSmokeRuntime(lease);
			lease = null;
			const retired = await eventually(
				async () => ({
					bootstrap: await readContentBootstrapStatus(targetUrl),
					runtime: await inspectContentRuntime(tabId),
					hosts: await page.evaluate(() => ({
						osd: document.querySelectorAll('#spectra-osd-host').length,
						toast: document.querySelectorAll('#spectra-toast-host').length,
					})),
				}),
				(state) => !state.bootstrap.ready
					&& state.bootstrap.runtimeRevision === null
					&& !state.runtime.listenersReady
					&& state.runtime.sameRuntime === true
					&& state.runtime.oldRuntimeDisposed === true
					&& state.hosts.osd === 0
					&& state.hosts.toast === 0,
				'final runtime lease retirement',
				5_000,
			);
			expect(retired.bootstrap).toMatchObject({
				ready: false,
				runtimeRevision: null,
				ownedSources: [],
			});
			expect(retired.hosts).toEqual({ osd: 0, toast: 0 });
			expect(await page.evaluate(() => {
				document.dispatchEvent(new Event('fullscreenchange'));
				return {
					osd: document.querySelectorAll('#spectra-osd-host').length,
					toast: document.querySelectorAll('#spectra-toast-host').length,
				};
			})).toEqual({ osd: 0, toast: 0 });

			reacquiredLease = await acquireSmokeRuntime(targetUrl, 'final-feedback-generation');
			await eventually(
				() => inspectContentRuntime(tabId),
				(state) => state.listenersReady
					&& state.runtimeRevision === SPECTRA_CONTENT_RUNTIME_REVISION
					&& state.sameRuntime === false
					&& state.oldRuntimeDisposed === true,
				'reacquired Content runtime generation',
				15_000,
			);
			await publishFeedback(reacquiredLease);
			await publishFeedback(reacquiredLease, { kind: 'speed', value: 1 });
			await page.waitForFunction(() => (
				document.querySelectorAll('#spectra-osd-host').length === 1
				&& document.querySelectorAll('#spectra-toast-host').length === 1
				&& document.querySelector<HTMLElement>('#spectra-osd-host')
					?.matches(':popover-open') === true
			), { timeout: 5_000 });
			expect(await page.evaluate(() => {
				const scope = window as Window & {
					__spectraFinalFeedbackHosts?: {
						osd?: HTMLElement;
						toast?: HTMLElement;
					};
				};
				const currentOsd = document.querySelector<HTMLElement>('#spectra-osd-host');
				const currentToast = document.querySelector<HTMLElement>('#spectra-toast-host');
				return {
					osd: document.querySelectorAll('#spectra-osd-host').length,
					toast: document.querySelectorAll('#spectra-toast-host').length,
					reusedOsd: currentOsd === scope.__spectraFinalFeedbackHosts?.osd,
					reusedToast: currentToast === scope.__spectraFinalFeedbackHosts?.toast,
				};
			})).toEqual({
				osd: 1,
				toast: 1,
				reusedOsd: false,
				reusedToast: false,
			});
			await releaseSmokeRuntime(reacquiredLease);
			reacquiredLease = null;
			await eventually(
				async () => ({
					bootstrap: await readContentBootstrapStatus(targetUrl),
					hosts: await page.evaluate(() => ({
						osd: document.querySelectorAll('#spectra-osd-host').length,
						toast: document.querySelectorAll('#spectra-toast-host').length,
					})),
				}),
				(state) => !state.bootstrap.ready
					&& state.bootstrap.runtimeRevision === null
					&& state.hosts.osd === 0
					&& state.hosts.toast === 0,
				'reacquired final runtime lease retirement',
				5_000,
			);
			expect(pageErrors).toEqual([]);
		} finally {
			if (reacquiredLease) await releaseSmokeRuntime(reacquiredLease).catch(() => undefined);
			if (lease) await releaseSmokeRuntime(lease).catch(() => undefined);
			await page.close().catch(() => undefined);
		}
	}, 35_000);

	test('serializes denied capture attempts through one offscreen host and rolls back', async () => {
		const secondaryUrl = `${fixtureUrl}?secondary=1`;
		const secondary = await browser.newPage();
		await secondary.goto(secondaryUrl, { waitUntil: 'domcontentloaded' });
		await waitForContentBootstrapStatus(secondaryUrl);
		const extensionClient = await browser.newPage();
		await extensionClient.goto(`chrome-extension://${extensionId}/popup.html`, {
			waitUntil: 'domcontentloaded',
		});

		const primaryUrl = fixturePage.url();
		try {
			await Promise.all([
				acquireSmokeRuntime(primaryUrl, 'capture-denied-primary'),
				acquireSmokeRuntime(secondaryUrl, 'capture-denied-secondary'),
			]);
			const result = await extensionClient.evaluate(async ({ urls }) => {
				const tabs = await chrome.tabs.query({});
				const tabIds = urls.map((url) => {
					const tabId = tabs.find((tab) => tab.url === url)?.id;
					if (tabId === undefined) throw new Error(`Unable to find capture tab: ${url}`);
					return tabId;
				});
				const config = {
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
				const captureRequest = async (tabId: number, enabled: boolean, generation: number) => {
					const [injection] = await chrome.scripting.executeScript({
						target: { tabId },
						world: 'ISOLATED',
						func: async (request) => chrome.runtime.sendMessage({
							protocolVersion: 2,
							requestId: crypto.randomUUID(),
							tabId: request.tabId,
							generation: request.generation,
							type: 'spectra.audio.capture.set',
							payload: {
								enabled: request.enabled,
								config: request.config,
							},
						}),
						args: [{ tabId, enabled, generation, config }],
					});
					return injection?.result;
				};
				const starts = await Promise.all(tabIds.map((tabId, index) => (
					captureRequest(tabId, true, index + 1)
				)));
				const contexts = await chrome.runtime.getContexts({
					contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
				});
				// Host introspection is background-only; the Puppeteer side reads it
				// through the service worker after these v2 UI requests settle.
				const snapshot = { audioTabs: [], remoteTabs: [] };
				const stops = await Promise.all(tabIds.map((tabId, index) => (
					captureRequest(tabId, false, index + 100)
				)));
				const waitForStatus = async (
					tabId: number,
					predicate: (status: { mode?: string; phase?: string }) => boolean,
				) => {
					const deadline = Date.now() + 5_000;
					let status: { mode?: string; phase?: string; config?: typeof config } = {};
					while (Date.now() < deadline) {
						const response = await chrome.tabs.sendMessage(tabId, {
							protocolVersion: 2,
							requestId: crypto.randomUUID(),
							tabId,
							type: 'spectra.audio.runtime.get',
							payload: {},
						});
						if (!response?.ok) throw new Error(response?.error?.message ?? 'Unable to read capture fixture runtime');
						status = { ...response.data, mode: response.data.actualMode };
						if (predicate(status)) return status;
						await new Promise((resolveWait) => setTimeout(resolveWait, 10));
					}
					throw new Error(`Timed out waiting for tab ${tabId} status: ${JSON.stringify(status)}`);
				};
				const stoppedStatuses = await Promise.all(tabIds.map((tabId) => waitForStatus(
					tabId,
					(status) => status.mode === 'bypass' && status.phase === 'idle',
				)));

				return {
					tabIds,
					starts,
					contexts: contexts.length,
					snapshot,
					stops,
					stoppedStatuses,
				};
			}, { urls: [primaryUrl, secondaryUrl] });
			const hostSnapshot = await readOffscreenSnapshot();
			expect(result.contexts).toBe(1);
			expect(hostSnapshot.remoteTabs).toEqual([]);
			for (const [index, start] of result.starts.entries()) {
				expect(start).toMatchObject({
					ok: false,
					error: { code: 'invalid_request', message: 'Malformed capture request' },
				});
				const describedTab = hostSnapshot.audioTabs.find(
					(audio: { tabId: number }) => audio.tabId === result.tabIds[index],
				);
				expect(describedTab).toBeUndefined();
			}
			for (const stop of result.stops) {
				expect(stop).toMatchObject({ ok: true, data: { phase: 'idle', active: false } });
			}
			expect(result.stoppedStatuses).toEqual([
				expect.objectContaining({ mode: 'bypass', phase: 'idle' }),
				expect.objectContaining({ mode: 'bypass', phase: 'idle' }),
			]);
		} finally {
			await extensionClient.close();
			await secondary.close();
		}
	}, 35_000);

	test('loads PeerJS once only after explicit Remote create on a Capture-only host', async () => {
		const captureOnly = await browser.newPage();
		const extensionClient = await openExtensionClient();
		const captureOnlyUrl = `${fixtureUrl}?peer-lazy-capture=1`;
		let session: RemotePublicSession | null = null;
		let vendorRequests = 0;
		let tabId = 0;
		let latestCaptureGeneration = 0;
		try {
			await captureOnly.goto(captureOnlyUrl, { waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(captureOnlyUrl);
			tabId = await getTabId(captureOnlyUrl);
			await installTabCaptureStreamIdStub();

			const denied = await sendCaptureRequest(extensionClient, tabId, true, 1);
			expect(denied).toMatchObject({
				ok: false,
				error: { code: 'invalid_request', message: 'Malformed capture request' },
			});
			// No one-shot admission was supplied. The request is rejected before it
			// can allocate a host or advance the authoritative session generation.
			latestCaptureGeneration = 0;
			expect(await getOffscreenContextCount()).toBe(1);
			expect((await readOffscreenSnapshot()).remoteTabs).toEqual([]);
			expect(await readOffscreenPeerRuntimeProbe()).toEqual({
				peerType: 'undefined',
				vendorAssignments: 0,
				peerConstructions: 0,
				peerDestructions: 0,
			});

			await installSyntheticCaptureHarness();
			await captureOnly.bringToFront();
			await submitEffectiveVolume(tabId, 130);
			const started = await eventually(
				() => readContentStatus(captureOnlyUrl),
				(status) => status.config?.volume === 130
					&& status.phase === 'active'
					&& status.actualMode === 'capture',
				15_000,
			);
			const startGeneration = requireValue(
				started.generation,
				'Capture admission did not return a generation',
			);
			expect(started).toMatchObject({
				generation: startGeneration,
				phase: 'active',
				actualMode: 'capture',
			});
			latestCaptureGeneration = startGeneration;
			expect((await readOffscreenSnapshot()).audioTabs).toEqual(expect.arrayContaining([
				expect.objectContaining({ tabId, generation: startGeneration }),
			]));
			expect(await readOffscreenPeerRuntimeProbe()).toMatchObject({
				peerType: 'undefined',
			});

			await installOffscreenPeerRuntimeProbe(false, () => {
				vendorRequests += 1;
			});

			const creation = await sendFromActionPopup<{
				ok: boolean;
				data?: RemotePublicSession;
				error?: { message?: string };
			}>({
				protocolVersion: 2,
				tabId,
				type: 'spectra.remote.session.create',
				payload: { tabId },
			});
			if (!creation.ok || !creation.data) {
				throw new Error(creation.error?.message ?? 'PeerJS lazy-load session creation failed');
			}
			session = creation.data;
			const observedVendorRequests = await eventually(
				() => Promise.resolve(vendorRequests),
				(count) => count === 1,
				'one local PeerJS ESM request',
				5_000,
			);
			expect(observedVendorRequests).toBe(1);
			const loaded = await eventually(
				readOffscreenPeerRuntimeProbe,
				(probe) => probe.peerType === 'undefined'
					&& probe.vendorAssignments === 0
					&& probe.peerConstructions === 1,
				`one explicit PeerJS vendor load (${peerRuntimeDebugEvents.join(',')})`,
				5_000,
			);
			expect(loaded).toMatchObject({
				peerType: 'undefined',
				vendorAssignments: 0,
				peerConstructions: 1,
				peerDestructions: 0,
			});
			// CDP observes the exact local ESM request; the constructor counter proves
			// that the imported module supplied the Peer implementation without a
			// global assignment.
			expect(vendorRequests).toBe(1);
			expect(await getOffscreenContextCount()).toBe(1);
			// Slow CI machines can still be waking the capture owner when the
			// session creation returns; wait for the shared host to acknowledge the
			// tab instead of racing a single snapshot read.
			const sharedHost = await eventually(
				readOffscreenSnapshot,
				(snapshot) => snapshot.audioTabs.some((entry) => (
					entry.tabId === tabId && entry.generation === startGeneration
				)),
				'shared offscreen host acknowledges the capture tab',
			);
			expect(sharedHost.audioTabs).toEqual(expect.arrayContaining([
				expect.objectContaining({ tabId, generation: startGeneration }),
			]));
			expect(sharedHost.remoteTabs).toEqual([{ tabId, sessionId: session.sessionId }]);

			const repeated = await sendFromActionPopup<{
				ok: boolean;
				data?: RemotePublicSession;
			}>({
				protocolVersion: 2,
				tabId,
				type: 'spectra.remote.session.create',
				payload: { tabId },
			});
			expect(repeated).toMatchObject({
				ok: true,
				data: { sessionId: session.sessionId, tabId },
			});
			expect(await readOffscreenPeerRuntimeProbe()).toMatchObject({
				vendorAssignments: loaded.vendorAssignments,
				peerConstructions: loaded.peerConstructions,
				peerDestructions: loaded.peerDestructions,
			});
			expect(vendorRequests).toBe(1);
		} finally {
			if (session) {
				await sendFromActionPopup({
					protocolVersion: 2,
					tabId,
					type: 'spectra.remote.session.close',
					payload: { tabId, sessionId: session.sessionId },
				}).catch(() => undefined);
			}
			await detachOffscreenPeerRuntimeDebugger();
			if (tabId > 0) {
				await sendCaptureRequest(
					extensionClient,
					tabId,
					false,
					latestCaptureGeneration + 1,
				).catch(() => undefined);
			}
			await extensionClient.close().catch(() => undefined);
			await captureOnly.close().catch(() => undefined);
		}
	}, 45_000);

	test('creates an acknowledged capture processor with a real synthetic MediaStream', async () => {
		await installSyntheticCaptureHarness();
		await installTabCaptureStreamIdStub();
		const extensionClient = await openExtensionClient();
		const tabId = await getTabId(fixturePage.url());
		try {
			await fixturePage.bringToFront();
			await submitEffectiveVolume(tabId, 130);
			const started = await waitForContentStatus(
				(status) => status.config?.volume === 130
					&& status.phase === 'active'
					&& status.actualMode === 'capture',
				15_000,
			);
			expect(started).toMatchObject({
				phase: 'active',
				actualMode: 'capture',
				config: { volume: 130, volumeBase: 100, boost: 1.3 },
			});
			const host = await readOffscreenSnapshot();
			expect(host.audioTabs).toEqual(expect.arrayContaining([
				expect.objectContaining({ tabId, generation: started.generation }),
			]));
			expect(await getOffscreenContextCount()).toBe(1);
			const harness = await readSyntheticCaptureState();
			expect(harness.calls).toBeGreaterThan(0);
			expect(harness.processorStates.filter((state) => state === 'running')).toHaveLength(1);

			const stopped = await sendCaptureRequest(
				extensionClient,
				tabId,
				false,
				(started.generation ?? 0) + 1,
			);
			expect(stopped).toMatchObject({ ok: true, data: { phase: 'idle', active: false } });
			expect((await readOffscreenSnapshot()).audioTabs).toEqual([]);
		} finally {
			await extensionClient.close();
		}
	}, 35_000);

	test('resumes acknowledged Capture after the fullscreen boundary succeeds', async () => {
		await installSyntheticCaptureHarness();
		await installTabCaptureStreamIdStub();
		const extensionClient = await openExtensionClient();
		const tabId = await getTabId(fixturePage.url());
		// Headless Chrome rejects the browser fullscreen endpoint even when CDP
		// supplies a user gesture. Replace only that endpoint before document_start;
		// the production MAIN bridge and Capture/offscreen lifecycle stay intact.
		const fullscreenStub = await fixturePage.evaluateOnNewDocument(() => {
			Object.defineProperty(Element.prototype, 'requestFullscreen', {
				configurable: true,
				enumerable: false,
				writable: true,
				value: function syntheticFullscreenSuccess(this: Element): Promise<void> {
					document.documentElement.dataset.fullscreenNativeBoundary = this.id || 'anonymous';
					return Promise.resolve();
				},
			});
		});
		let latestGeneration = 0;
		let stage = 'fresh document bootstrap';
		try {
			await fixturePage.reload({ waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(fixturePage.url());
			await fixturePage.bringToFront();
			stage = 'Popup Capture activation';
			await submitEffectiveVolume(tabId, 180);
			const captured = await waitForContentStatus(
				(status) => status.mode === 'capture'
					&& status.phase === 'active'
					&& status.config?.volume === 180,
				15_000,
			);
			latestGeneration = captured.generation ?? 0;

			stage = 'native fullscreen request';
			const fullscreenClient = await fixturePage.createCDPSession();
			try {
				const evaluation = await fullscreenClient.send('Runtime.evaluate', {
					expression: `(() => {
						const video = document.querySelector('#v');
						if (!video) throw new Error('Fullscreen fixture video is missing');
						document.documentElement.dataset.fullscreenHandoffResult = 'pending';
						void video.requestFullscreen().then(
							() => { document.documentElement.dataset.fullscreenHandoffResult = 'success'; },
							(error) => {
								document.documentElement.dataset.fullscreenHandoffResult = 'error:' + String(error);
							},
						);
					})()`,
					awaitPromise: false,
					returnByValue: true,
					userGesture: true,
				});
				if (evaluation.exceptionDetails) {
					throw new Error(evaluation.exceptionDetails.exception?.description
						?? evaluation.exceptionDetails.text);
				}
			} finally {
				await fullscreenClient.detach().catch(() => undefined);
			}
			const fullscreenResult = await eventually(
				() => fixturePage.evaluate(() => ({
					result: document.documentElement.dataset.fullscreenHandoffResult ?? 'missing',
					nativeBoundary: document.documentElement.dataset.fullscreenNativeBoundary ?? null,
				})),
				(value) => value.result !== 'pending',
				'native fullscreen completion',
				10_000,
			);
			expect(fullscreenResult).toEqual({ result: 'success', nativeBoundary: 'v' });

			stage = 'Capture continuation resume';
			const resumed = await waitForContentStatus(
				(status) => status.mode === 'capture'
					&& status.phase === 'active'
					&& (status.generation ?? 0) > latestGeneration,
				15_000,
			);
			latestGeneration = resumed.generation ?? latestGeneration;
			expect((await readOffscreenSnapshot()).audioTabs).toEqual(expect.arrayContaining([
				expect.objectContaining({ tabId, generation: latestGeneration }),
			]));
		} catch (error) {
			throw new Error(`Fullscreen Capture smoke failed during ${stage}`, { cause: error });
		} finally {
			await withDiagnosticTimeout('leave fullscreen during handoff cleanup', () => fixturePage.evaluate(async () => {
				delete document.documentElement.dataset.fullscreenHandoffResult;
				if (document.fullscreenElement) await document.exitFullscreen();
			}), 3_000).catch(() => undefined);
			await withDiagnosticTimeout(
				'restore native volume during handoff cleanup',
				() => submitEffectiveVolume(tabId, 100),
				8_000,
			).catch(() => undefined);
			await withDiagnosticTimeout(
				'restore runtime during handoff cleanup',
				() => configureRuntime(fixturePage.url(), DEFAULT_AUDIO_CONFIG),
				5_000,
			).catch(() => undefined);
			await fixturePage.removeScriptToEvaluateOnNewDocument(fullscreenStub.identifier)
				.catch(() => undefined);
			await withDiagnosticTimeout(
				'reload native fullscreen boundary after handoff cleanup',
				() => fixturePage.reload({ waitUntil: 'domcontentloaded' }),
				8_000,
			).catch(() => undefined);
			await extensionClient.close().catch(() => undefined);
		}
	}, 60_000);

	test('prefers an acknowledged page-native volume above 100 and captures only past the site limit', async () => {
		// The preceding fullscreen fixture ends with a real reload. Own the new
		// document READY boundary before installing its page controller; under a
		// slow production bundle, DOMContentLoaded alone can precede bootstrap
		// HELLO and would let this test exercise the DOM fallback instead.
		await waitForContentBootstrapStatus(fixturePage.url());
		await installPageMediaControllerHarness();
		await installSyntheticCaptureHarness();
		await installTabCaptureStreamIdStub();
		const extensionClient = await openExtensionClient();
		const visualizerSettings = await patchExtensionSettings(extensionClient, {
			scope: 'global',
			changes: { visualizerEnabled: false },
		});
		await fixturePage.bringToFront();
		const tabId = await getTabId(fixturePage.url());
		try {
			await submitEffectiveVolume(tabId, 80);
			expect(await readPageMediaControllerHarness()).toMatchObject({
				volumeBase: 80,
				domMuted: false,
			});
			const captureCallsBeforeNativeAmplification = (await readSyntheticCaptureState()).calls;
			await submitEffectiveVolume(tabId, 130);
			const native130 = await waitForContentStatus(
				(status) => status.config?.volume === 130
					&& status.config.volumeBase === 130
					&& status.config.boost === 1
					&& status.phase === 'idle'
					&& status.actualMode === 'bypass',
				15_000,
			);
			expect(native130).toMatchObject({
				phase: 'idle',
				actualMode: 'bypass',
				config: { volume: 130, volumeBase: 130, boost: 1 },
			});
			expect((await readSyntheticCaptureState()).calls).toBe(captureCallsBeforeNativeAmplification);
			expect((await readOffscreenSnapshot()).audioTabs.some((entry) => entry.tabId === tabId)).toBe(false);
			expect(await readPageMediaControllerHarness()).toMatchObject({
				volumeBase: 130,
				domVolume: 0.79703,
			});
			const native130Presentation = await readPopupVolumePresentation('#2563eb');
			expect(native130Presentation).toMatchObject({
				sliderCount: 1,
				min: '0',
				max: '800',
				value: '130',
				fillColor: 'rgb(37, 99, 235)',
				valueColor: 'rgb(37, 99, 235)',
				sliderAccent: '#2563eb',
			});
			expect(await readBadgeColor(tabId)).toEqual([37, 99, 235, 255]);

			await submitEffectiveVolume(tabId, 80);
			await submitEffectiveVolume(tabId, 350);
			await waitForContentStatus(
				(status) => status.mode === 'capture' && status.phase === 'active'
					&& status.config?.volume === 350,
				15_000,
			);
			const capture350InitialPresentation = await readPopupVolumePresentation('#7c3aed');
			expect(capture350InitialPresentation).toMatchObject({
				sliderCount: 1,
				min: '0',
				max: '800',
				value: '350',
				fillColor: 'rgb(124, 58, 237)',
				valueColor: 'rgb(124, 58, 237)',
				sliderAccent: '#7c3aed',
			});
			expect(await readBadgeColor(tabId)).toEqual([124, 58, 237, 255]);
			expect(await readPageMediaControllerHarness()).toMatchObject({ volumeBase: 100 });

			await submitEffectiveVolume(tabId, 80);
			const native80 = await waitForContentStatus(
				(status) => status.mode === 'bypass' && status.phase === 'idle'
					&& status.config?.volume === 80
					&& status.config?.volumeBase === 80
					&& status.config?.boost === 1,
				15_000,
			);
			expect(native80).toMatchObject({
				mode: 'bypass',
				phase: 'idle',
				config: { volume: 80, volumeBase: 80, boost: 1 },
			});
			const nativeSnapshot = await extensionClient.evaluate(async (targetTabId) => chrome.runtime.sendMessage({
				protocolVersion: 2,
				requestId: crypto.randomUUID(),
				tabId: targetTabId,
				type: 'spectra.control.snapshot.get',
				payload: { tabId: targetTabId },
			}), tabId);
			expect(nativeSnapshot).toMatchObject({
				ok: true,
				data: {
					fields: {
						volumeBase: { actual: 80, strategy: 'page-native' },
						boost: { actual: 1, strategy: 'observe', controlled: false },
					},
				},
			});
			expect(await readPageMediaControllerHarness()).toMatchObject({
				volumeBase: 80,
				domVolume: 0.49048,
			});
			const native80Presentation = await readPopupVolumePresentation('#2563eb');
			expect(native80Presentation).toMatchObject({
				value: '80',
				fillColor: 'rgb(37, 99, 235)',
				valueColor: 'rgb(37, 99, 235)',
				sliderAccent: '#2563eb',
			});

			await submitEffectiveVolume(tabId, 350);
			const capture350Again = await waitForContentStatus(
				(status) => status.mode === 'capture' && status.phase === 'active'
					&& status.config?.volume === 350,
				15_000,
			);
			expect(await readPageMediaControllerHarness()).toMatchObject({ volumeBase: 100 });
			expect(capture350Again).toMatchObject({
				mode: 'capture',
				phase: 'active',
				config: { volume: 350, volumeBase: 100, boost: 3.5 },
			});
			const capture350Presentation = await readPopupVolumePresentation('#7c3aed');
			expect(capture350Presentation).toMatchObject({
				value: '350',
				fillColor: 'rgb(124, 58, 237)',
				valueColor: 'rgb(124, 58, 237)',
				sliderAccent: '#7c3aed',
			});
			expect(await readBadgeColor(tabId)).toEqual([124, 58, 237, 255]);

			await submitEffectiveVolume(tabId, 0);
			const nativeZero = await waitForContentStatus(
				(status) => status.mode === 'bypass' && status.phase === 'idle'
					&& status.config?.volume === 0
					&& status.config?.volumeBase === 0
					&& status.config?.boost === 1,
				15_000,
			);
			expect(nativeZero).toMatchObject({
				mode: 'bypass',
				phase: 'idle',
				config: { volume: 0, volumeBase: 0, boost: 1 },
			});
			expect(await readPageMediaControllerHarness()).toMatchObject({
				volumeBase: 0,
				domVolume: 0,
			});
			expect((await readOffscreenSnapshot()).audioTabs).toEqual([]);
			const silent = await readPopupVolumePresentation();
			expect(silent).toMatchObject({
				value: '0',
				fillColor: 'rgb(156, 163, 175)',
				valueColor: 'rgb(156, 163, 175)',
				sliderAccent: '#9ca3af',
			});
			expect(await readBadgeColor(tabId)).toEqual([156, 163, 175, 255]);

			await submitEffectiveVolume(tabId, 100);
			await waitForContentStatus(
				(status) => status.mode === 'bypass' && status.phase === 'idle'
					&& status.config?.volume === 100
					&& status.config?.volumeBase === 100
					&& status.config?.boost === 1,
				15_000,
			);
			expect(await readPageMediaControllerHarness()).toMatchObject({
				volumeBase: 100,
				domVolume: 0.6131,
			});
			const native100Presentation = await readPopupVolumePresentation('#2563eb');
			expect(native100Presentation).toMatchObject({
				value: '100',
				fillColor: 'rgb(37, 99, 235)',
				valueColor: 'rgb(37, 99, 235)',
				sliderAccent: '#2563eb',
			});
			expect(await readBadgeColor(tabId)).toEqual([37, 99, 235, 255]);

			// Route ownership is document-scoped. Reload the same tab, then
			// recreate its exact page controller at 100.
			await fixturePage.reload({ waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(fixturePage.url());
			await installPageMediaControllerHarness();
			await submitEffectiveVolume(tabId, 100);
			await waitForContentStatus(
				(status) => status.mode === 'bypass' && status.phase === 'idle'
					&& status.config?.volume === 100,
				15_000,
			);
			await fixturePage.bringToFront();
			// Create the feedback surface at that acknowledged native baseline,
			// then let physical shortcuts cross 100 without acquiring Capture.
			await tapDefaultShortcut(fixturePage, 'ArrowDown');
			await waitForContentStatus(
				(status) => status.mode === 'bypass' && status.phase === 'idle'
					&& status.config?.volume === 90,
				15_000,
			);
			await tapDefaultShortcut(fixturePage, 'ArrowUp');
			await waitForContentStatus(
				(status) => status.mode === 'bypass' && status.phase === 'idle'
					&& status.config?.volume === 100,
				15_000,
			);
			await startOsdFeedbackProbe(fixturePage, '%', true);
			const captureCallsBeforeShortcut = (await readSyntheticCaptureState()).calls;
			await tapDefaultShortcut(fixturePage, 'ArrowUp');
			await waitForContentStatus(
				(status) => status.mode === 'bypass' && status.phase === 'idle'
					&& status.config?.volume === 110
					&& status.config.volumeBase === 110
					&& status.config.boost === 1,
				15_000,
			);
			expect((await readSyntheticCaptureState()).calls).toBe(captureCallsBeforeShortcut);
			const native110Presentation = await readPopupVolumePresentation('#2563eb');
			expect(native110Presentation).toMatchObject({
				value: '110',
				fillColor: 'rgb(37, 99, 235)',
				valueColor: 'rgb(37, 99, 235)',
				sliderAccent: '#2563eb',
			});

			await tapDefaultShortcut(fixturePage, 'ArrowDown');
			await waitForContentStatus(
				(status) => status.mode === 'bypass' && status.phase === 'idle'
					&& status.config?.volume === 100,
				15_000,
			);
			await eventually(
				() => readOsdFeedback(fixturePage, 'volume'),
				(feedback) => feedback.label === '100%'
					&& feedback.color === native100Presentation.fillColor,
				'acknowledged native OSD after the reverse boundary',
			);
			const boundaryFrames = (await readOsdFeedback(fixturePage, 'volume', true)).frames;
			const compactPairs = boundaryFrames
				.map(({ label, color }) => `${label}|${color}`)
				.filter((pair, index, pairs) => index === 0 || pair !== pairs[index - 1]);
			expect(compactPairs).toEqual([
				`100%|${native100Presentation.fillColor}`,
				`110%|${native110Presentation.fillColor}`,
				`100%|${native100Presentation.fillColor}`,
			]);
		} finally {
			await readOsdFeedback(fixturePage, 'volume', true).catch(() => undefined);
			await releaseSyntheticCapture();
			const status = await readContentStatus().catch(() => ({ generation: 0 } as ContentStatus));
			await sendCaptureRequest(
				extensionClient,
				tabId,
				false,
				(status.generation ?? 0) + 1,
				DEFAULT_AUDIO_CONFIG,
			).catch(() => undefined);
			await submitEffectiveVolume(tabId, 100).catch(() => undefined);
			await configureRuntime(fixturePage.url(), DEFAULT_AUDIO_CONFIG).catch(() => undefined);
			await removePageMediaControllerHarness();
			await patchExtensionSettings(extensionClient, {
				scope: 'global',
				changes: {
					visualizerEnabled: visualizerSettings.previous.globalSettings.visualizerEnabled,
				},
			}).catch(() => undefined);
			await extensionClient.close();
		}
	}, 60_000);

	test('restores active capture across worker restart and shares one host with authenticated remote', async () => {
		await installSyntheticCaptureHarness();
		await installTabCaptureStreamIdStub();
		const extensionClient = await openExtensionClient();
		const secondary = await browser.newPage();
		const tabId = await getTabId(fixturePage.url());
		const secondaryUrl = `${fixtureUrl}?remote-secondary=1`;
		let session: RemotePublicSession | null = null;
		try {
			await configureRuntime(fixturePage.url(), DEFAULT_AUDIO_CONFIG);
			await waitForContentStatus((status) => status.mode === 'bypass' && status.phase === 'idle');
			await secondary.goto(secondaryUrl, { waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(secondaryUrl);

			await fixturePage.reload({ waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(fixturePage.url());
			await fixturePage.bringToFront();
			await submitEffectiveVolume(tabId, 130);
			const started = await waitForContentStatus(
				(status) => status.config?.volume === 130
					&& status.config?.boost === 1.3
					&& status.mode === 'capture'
					&& status.phase === 'active',
				15_000,
			);
			const initialCaptureSession = await sendFromActionPopup<{
				ok: boolean;
				data?: { generation?: number; actualMode?: string; phase?: string };
			}>({
				protocolVersion: 2,
				tabId,
				type: 'spectra.audio.session.get',
				payload: { tabId },
			});
			expect(initialCaptureSession).toMatchObject({
				ok: true,
				data: { actualMode: 'capture', phase: 'active' },
			});
			const captureGeneration = initialCaptureSession.data?.generation;
			if (typeof captureGeneration !== 'number') throw new Error('Initial Capture generation is missing');
			const convergedCapture = started.generation === captureGeneration
				? started
				: await waitForContentStatus(
					(status) => status.generation === captureGeneration
						&& status.mode === 'capture'
						&& status.phase === 'active',
					10_000,
				);
			expect(convergedCapture.generation).toBe(captureGeneration);
			await restartServiceWorker();

			const recovered = await sendFromActionPopup({
				protocolVersion: 2,
				tabId,
				type: 'spectra.audio.session.get',
				payload: { tabId },
			});
			expect(recovered).toMatchObject({
				ok: true,
				data: { generation: captureGeneration, phase: 'active', actualMode: 'capture' },
			});
			expect(await getOffscreenContextCount()).toBe(1);
			expect((await readOffscreenSnapshot()).audioTabs).toEqual(expect.arrayContaining([
				expect.objectContaining({ tabId, generation: captureGeneration }),
			]));
			// The Chrome integration owns extension-side offscreen/background/content
			// recovery, authentication and command routing. PeerJS signaling availability
			// is an external transport fact and must not make this product proof depend
			// on the public 0.peerjs.com service.
			await installOffscreenPeerRuntimeProbe(true);

			const creation = await sendFromActionPopup<{
				ok: boolean;
				data?: RemotePublicSession;
				error?: { message?: string };
			}>({
				protocolVersion: 2,
				tabId,
				type: 'spectra.remote.session.create',
				payload: { tabId },
			});
			if (!creation?.ok) {
				throw new Error(creation?.error?.message ?? 'PeerJS remote session creation failed');
			}
			session = creation.data as RemotePublicSession;
			const sharedHost = await readOffscreenSnapshot();
			expect(await getOffscreenContextCount()).toBe(1);
			expect(sharedHost.audioTabs).toEqual(expect.arrayContaining([
				expect.objectContaining({ tabId, generation: captureGeneration }),
			]));
			expect(sharedHost.remoteTabs).toContainEqual({ tabId, sessionId: session.sessionId });

			const wrongConnection = await openOffscreenTestRemote(session);
			const wrongMessages = await eventually(
				() => readOffscreenTestRemoteMessages(wrongConnection),
				(messages) => messages.some((message) => message.type === 'spectra.remote.challenge'),
				'wrong-secret challenge',
			);
			const wrongChallenge = wrongMessages.find(
				(message) => message.type === 'spectra.remote.challenge',
			);
			await deliverOffscreenTestRemote(wrongConnection, {
				type: 'spectra.remote.authenticate',
				protocolVersion: 3,
				sessionId: session.sessionId,
				proof: 'A'.repeat(43),
			});
			expect(wrongChallenge).toMatchObject({
				type: 'spectra.remote.challenge',
				sessionId: session.sessionId,
			});
			const rejectedMessages = await eventually(
				() => readOffscreenTestRemoteMessages(wrongConnection),
				(messages) => messages.some((message) => (
					message.type === 'spectra.remote.auth-result' && message.ok === false
				)),
				'wrong-secret remote authentication rejection',
			);
			const rejected = rejectedMessages.find((message) => (
				message.type === 'spectra.remote.auth-result' && message.ok === false
			));
			expect(rejected).toMatchObject({ error: 'AUTH_FAILED' });
			expect((await readContentStatus()).config?.volume).toBe(130);

			const authenticatedConnection = await openOffscreenTestRemote(session);
			const challengeMessages = await eventually(
				() => readOffscreenTestRemoteMessages(authenticatedConnection),
				(messages) => messages.some((message) => message.type === 'spectra.remote.challenge'),
				'authenticated remote challenge',
			);
			const challenge = challengeMessages.find(
				(message) => message.type === 'spectra.remote.challenge',
			);
			if (typeof challenge.nonce !== 'string') throw new Error('Remote challenge nonce is missing');
			const proof = await createRemoteProof(session.secret, session.sessionId, challenge.nonce);
			await deliverOffscreenTestRemote(authenticatedConnection, {
				type: 'spectra.remote.authenticate',
				protocolVersion: 3,
				sessionId: session.sessionId,
				proof,
			});
			const authenticatedMessages = await eventually(
				() => readOffscreenTestRemoteMessages(authenticatedConnection),
				(messages) => (
					messages.some((message) => message.type === 'spectra.remote.auth-result' && message.ok === true)
					&& messages.some((message) => message.type === 'spectra.remote.state')
						? messages
						: undefined
				),
				'authenticated remote state',
			);
			const initialRemoteState = authenticatedMessages.findLast(
				(message) => message.type === 'spectra.remote.state',
			);
			expect(initialRemoteState).toMatchObject({
				volume: 130,
				volumeBase: 100,
				boost: 1.3,
				actualMode: 'capture',
				phase: 'active',
				tabTitle: 'SPECTRA extension smoke fixture',
			});
			const messageCountBeforeRestart = authenticatedMessages.length;
			expect((await readOffscreenSnapshot()).remoteTabs).toContainEqual({ tabId, sessionId: session.sessionId });

			// The offscreen host survives the worker. Its recovered generation must
			// authorize the first post-restart command instead of forcing a sync-only drop.
			await withDiagnosticTimeout(
				'restart service worker with an authenticated remote session',
				restartServiceWorker,
				45_000,
			);
			await withDiagnosticTimeout(
				'read recovered remote generation after worker restart',
				async () => {
					await eventually(
						() => readOffscreenTestRemoteMessages(authenticatedConnection),
						(messages) => messages.slice(messageCountBeforeRestart).findLast((message) => (
							message.type === 'spectra.remote.state'
							&& typeof message.generation === 'number'
							&& message.actualMode === 'capture'
							&& message.phase === 'active'
						)),
						'recovered remote state',
					);
				},
				5_000,
			);
			const recoveredMessages = await readOffscreenTestRemoteMessages(authenticatedConnection);
			const recoveredRemoteState = recoveredMessages.slice(messageCountBeforeRestart).findLast(
				(message) => message.type === 'spectra.remote.state'
					&& typeof message.generation === 'number'
					&& message.actualMode === 'capture'
					&& message.phase === 'active',
			);
			if (typeof recoveredRemoteState?.generation !== 'number') {
				throw new Error('Recovered remote state generation is missing');
			}
			expect(recoveredRemoteState).toMatchObject({
				volume: 130,
				volumeBase: 100,
				boost: 1.3,
			});
			expect(await readContentStatus()).toMatchObject({
				mode: 'capture',
				phase: 'active',
				config: { volume: 130, volumeBase: 100, boost: 1.3 },
			});
			await deliverOffscreenTestRemote(authenticatedConnection, {
				type: 'spectra.remote.command',
				protocolVersion: 3,
				sessionId: session.sessionId,
				sessionEpoch: 1,
				commandId: 'E'.repeat(22),
				sequence: 1,
				generation: recoveredRemoteState.generation,
				command: 'volume_up',
			});
			try {
				await eventually(
					() => readContentStatus(),
					(status) => status.config?.volume === 140 && status.config?.boost === 1.4,
					'first remote command after service-worker recovery',
					10_000,
				);
			} catch (error) {
				const [hostStatus, hostSnapshot, audioSession, controlSnapshot, remoteMessages] = await Promise.all([
					evaluateServiceWorker(async (targetTabId) => chrome.runtime.sendMessage({
						target: 'offscreen',
						type: 'REMOTE_HOST_GET_STATUS',
						tabId: targetTabId,
					}), tabId).catch(() => null),
					readOffscreenSnapshot().catch(() => null),
					sendFromActionPopup({
						protocolVersion: 2,
						tabId,
						type: 'spectra.audio.session.get',
						payload: { tabId },
					}).catch(() => null),
					extensionClient.evaluate(async (targetTabId) => chrome.runtime.sendMessage({
						protocolVersion: 2,
						requestId: crypto.randomUUID(),
						tabId: targetTabId,
						type: 'spectra.control.snapshot.get',
						payload: { tabId: targetTabId },
					}), tabId).catch(() => null),
					readOffscreenTestRemoteMessages(authenticatedConnection).catch(() => null),
				]);
				throw new Error(
					`First remote command was not applied after worker recovery: ${JSON.stringify({
						hostStatus,
						hostSnapshot,
						audioSession,
						controlSnapshot,
						remoteMessages,
					})}`,
					{ cause: error },
				);
			}
			const secondaryTabId = await getTabId(secondaryUrl);
			const secondarySnapshot = await extensionClient.evaluate(async (targetTabId) => chrome.runtime.sendMessage({
				protocolVersion: 2,
				requestId: crypto.randomUUID(),
				tabId: targetTabId,
				type: 'spectra.control.snapshot.get',
				payload: { tabId: targetTabId },
			}), secondaryTabId);
			expect(secondarySnapshot).toMatchObject({
				ok: true,
				data: {
					fields: {
						volumeBase: { actual: 100 },
					},
				},
			});
			await configureRuntime(fixturePage.url(), DEFAULT_AUDIO_CONFIG);
			const resetStatus = await waitForContentStatus(
				(status) => status.actualMode === 'bypass'
					&& status.phase === 'idle'
					&& status.config?.volume === 100
					&& status.config?.boost === 1,
			);

			const stopGeneration = Math.max(502, (resetStatus.generation ?? 501) + 1);
			const stopped = await sendCaptureRequest(extensionClient, tabId, false, stopGeneration);
			expect(stopped).toMatchObject({
				ok: true,
				data: { generation: stopGeneration, actualMode: 'bypass', phase: 'idle', active: false },
			});
			expect(await sendFromActionPopup({
				protocolVersion: 2,
				tabId,
				type: 'spectra.audio.session.get',
				payload: { tabId },
			})).toMatchObject({
				ok: true,
				data: { generation: stopGeneration, actualMode: 'bypass', phase: 'idle' },
			});
			await configureRuntime(fixturePage.url(), DEFAULT_AUDIO_CONFIG);
			await configureRuntime(secondaryUrl, DEFAULT_AUDIO_CONFIG);
			expect((await readContentStatus(secondaryUrl)).config?.volume).toBe(100);

			const closed = await sendFromActionPopup({
				protocolVersion: 2,
				tabId,
				type: 'spectra.remote.session.close',
				payload: { tabId, sessionId: session.sessionId },
			});
			expect(closed).toEqual({ ok: true, data: { closed: true } });
			session = null;
			await eventually(
				readOffscreenSnapshot,
				(snapshot) => snapshot.remoteTabs.length === 0 && snapshot.audioTabs.length === 0,
				'remote and capture lease cleanup',
			);
			await configureRuntime(fixturePage.url(), DEFAULT_AUDIO_CONFIG);
		} finally {
			if (session) {
				await sendFromActionPopup({
					protocolVersion: 2,
					tabId,
					type: 'spectra.remote.session.close',
					payload: { tabId, sessionId: session.sessionId },
				}).catch(() => undefined);
			}
			await sendCaptureRequest(extensionClient, tabId, false, 599).catch(() => undefined);
			await configureRuntime(fixturePage.url(), DEFAULT_AUDIO_CONFIG).catch(() => undefined);
			await restoreOffscreenPeerRuntimeProbe().catch(() => undefined);
			await Promise.all([extensionClient.close(), secondary.close()]);
		}
	}, 120_000);

	test('cleans active capture on immediate navigation and close after worker restart', async () => {
		await installSyntheticCaptureHarness();
		await installTabCaptureStreamIdStub();
		const navigating = await browser.newPage();
		const closing = await browser.newPage();
		const navigatingUrl = `${fixtureUrl}?restart-navigation=1`;
		const closingUrl = `${fixtureUrl}?restart-close=1`;
		try {
			await Promise.all([
				navigating.goto(navigatingUrl, { waitUntil: 'domcontentloaded' }),
				closing.goto(closingUrl, { waitUntil: 'domcontentloaded' }),
			]);
			await Promise.all([
				waitForContentBootstrapStatus(navigatingUrl),
				waitForContentBootstrapStatus(closingUrl),
			]);
			const [navigatingTabId, closingTabId] = await Promise.all([
				getTabId(navigatingUrl),
				getTabId(closingUrl),
			]);
			await navigating.bringToFront();
			await submitEffectiveVolume(navigatingTabId, 130);
			const navigatingStarted = await eventually(
				() => readContentStatus(navigatingUrl),
				(status) => status.actualMode === 'capture'
					&& status.phase === 'active'
					&& status.config?.volume === 130,
				15_000,
			);
			await closing.bringToFront();
			await submitEffectiveVolume(closingTabId, 130);
			const closingStarted = await eventually(
				() => readContentStatus(closingUrl),
				(status) => status.actualMode === 'capture'
					&& status.phase === 'active'
					&& status.config?.volume === 130,
				15_000,
			);
			expect([navigatingStarted, closingStarted]).toEqual([
				expect.objectContaining({
					phase: 'active',
					actualMode: 'capture',
					config: expect.objectContaining({ volume: 130 }),
				}),
				expect.objectContaining({
					phase: 'active',
					actualMode: 'capture',
					config: expect.objectContaining({ volume: 130 }),
				}),
			]);

			await restartServiceWorker();
			await Promise.all([
				navigating.goto(`http://localhost:${server.port}/smoke-test.html?after-restart=1`, {
					waitUntil: 'domcontentloaded',
				}),
				closing.close(),
			]);
			await eventually(
				readOffscreenSnapshot,
				(snapshot) => !snapshot.audioTabs.some(
					(audio) => audio.tabId === navigatingTabId || audio.tabId === closingTabId,
				),
				'navigation and tab-close capture cleanup',
				15_000,
			);
			expect(await getOffscreenContextCount()).toBe(1);
		} finally {
			await navigating.close().catch(() => undefined);
			await closing.close().catch(() => undefined);
		}
	}, 60_000);

	test('restarts the MV3 worker and reconciles the existing offscreen host', async () => {
		expect(await getOffscreenContextCount()).toBe(1);
		await restartServiceWorker();
		const restartedState = await readRestartedWorkerState();
		expect(restartedState.settings).toMatchObject({ ok: true });
		expect(restartedState.contextCount).toBe(1);
		expect(await readOffscreenSnapshot()).toEqual({ audioTabs: [], remoteTabs: [] });
		expect(restartedState.status).toMatchObject({ ok: true, data: { actualMode: 'bypass' } });
		expect(fixtureErrors).toEqual([]);
	}, 35_000);

	// Placed after the processor suites: saving flushes the card's live config
	// pipeline, so leftover state from this test must not reach their
	// expectations. The final extension-reload test stays last because it
	// invalidates the popup target this test needs.
	test('saves a global preset from the card action without opening settings', async () => {
		await fixturePage.bringToFront();
		const target = await openActionPopupTarget();
		const popup = await target.asPage();
		let fixtureTabId: number | undefined;
		try {
			await popup.waitForSelector('.btn-save-global', { timeout: 8_000 });
			const result = await popup.evaluate(async () => {
				const send = (type: string, payload: Record<string, unknown>) => chrome.runtime.sendMessage({
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					type,
					payload,
				});
				const before = await send('spectra.settings.get', {});
				if (!before?.ok) throw new Error(before?.error?.message ?? 'Unable to read settings baseline');
				const button = document.querySelector<HTMLButtonElement>('.btn-save-global');
				if (!button) throw new Error('Save-as-global button is missing');
				button.click();
				await new Promise((resolve) => setTimeout(resolve, 1_500));
				const after = await send('spectra.settings.get', {});
				if (!after?.ok) throw new Error(after?.error?.message ?? 'Unable to read saved settings');
				const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
				return {
					revision: after.data.revision,
					tabId: typeof activeTab?.id === 'number' ? activeTab.id : null,
					created: Object.keys(after.data.audioPresets)
						.filter((name) => !Object.hasOwn(before.data.audioPresets, name)),
					toastError: document.querySelector('.popup-toast-error')?.textContent ?? null,
				};
			});
			expect(result.toastError).toBeNull();
			expect(result.created).toHaveLength(1);
			fixtureTabId = result.tabId ?? undefined;
			// Remove the auto-named preset so reruns read a clean seeded state.
			const cleanup = await popup.evaluate(async ({ name, revision }) => {
				const response = await chrome.runtime.sendMessage({
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					type: 'spectra.settings.patch',
					payload: { expectedRevision: revision, patch: { scope: 'audio-preset', name, value: null } },
				});
				return response?.ok === true;
			}, { name: result.created[0], revision: result.revision });
			expect(cleanup).toBe(true);
		} finally {
			await popup.close();
			if (fixtureTabId !== undefined) {
				await submitEffectiveVolume(fixtureTabId, 100).catch(() => undefined);
				await submitPopupControlIntent(
					fixtureTabId,
					{ patch: { mediaMuted: false, speed: 1 } },
				).catch(() => undefined);
			}
		}
	}, 30_000);

	test('retires the old Content bootstrap silently after an extension reload', async () => {
		await releaseSmokeRuntimes();
		await runtimeLeaseClient?.close().catch(() => undefined);
		runtimeLeaseClient = null;
		const errorsBefore = fixtureErrors.length;
		const reloadDiagnostics: string[] = [];
		const onConsole = (message: import('puppeteer').ConsoleMessage) => {
			if ((message.type() === 'error' || message.type() === 'warning')
				&& /SPECTRA|Extension context invalidated/u.test(message.text())) {
				reloadDiagnostics.push(`console.${message.type()}: ${message.text()}`);
			}
		};
		fixturePage.on('console', onConsole);
		const extensionClient = await openExtensionClient();
		try {
			await extensionClient.evaluate(() => {
				chrome.runtime.reload();
			}).catch(() => undefined);
			await extensionClient.close().catch(() => undefined);
			await new Promise((resolveWait) => setTimeout(resolveWait, 200));
			await fixturePage.goto(`${fixtureUrl}?after-extension-reload=1`, {
				waitUntil: 'domcontentloaded',
			});
			await new Promise((resolveWait) => setTimeout(resolveWait, 200));
			expect(fixtureErrors.slice(errorsBefore)).toEqual([]);
			expect(reloadDiagnostics).toEqual([]);
		} finally {
			fixturePage.off('console', onConsole);
			await extensionClient.close().catch(() => undefined);
		}
	}, 30_000);
});

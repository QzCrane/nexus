import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
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
import { SPECTRA_CONTENT_RUNTIME_REVISION } from '@nexus/contracts';
import {
	SPECTRA_PLAYBACK_RATE_EVENT,
	SPECTRA_PLAYBACK_RATE_REQUEST_ATTRIBUTE,
	SPECTRA_PLAYBACK_RATE_RESULT_ATTRIBUTE,
} from '../src/shared/playback-rate-bridge';

const EXTENSION_DIR = resolve(process.env.SPECTRA_EXTENSION_DIR ?? join(import.meta.dir, '..', 'dist'));
const FIXTURE_PATH = join(import.meta.dir, 'fixtures', 'smoke-test.html');
const REMOTE_SITE_DIR = resolve(import.meta.dir, '..', '..', '..', '..', 'remote-site');

if (!existsSync(join(EXTENSION_DIR, 'manifest.json'))) {
	throw new Error(`SPECTRA extension directory is missing manifest.json: ${EXTENSION_DIR}`);
}

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

const fixtureErrors: string[] = [];
const smokeRuntimeLeases = new Map<string, SmokeRuntimeLease>();

interface ContentStatus {
	config?: {
		volume?: number;
		muted?: boolean;
		speed?: number;
	};
	hasAudio: boolean;
	mode: string;
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

interface SmokeRuntimeLease {
	tabId: number;
	documentId: string;
	runtimeRevision: string;
	capability: string;
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
	actualMode: 'bypass' | 'capture';
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

interface RemotePublicSession {
	protocolVersion: 2;
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

interface WebAudioProbe {
	controllerReady: boolean;
	contextState: string | null;
	hasGraph: boolean;
	listenersReady: boolean;
	runtimeRevision: string | null;
	sameController: boolean | null;
	sameSource: boolean | null;
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

const SILENT_WAV_DATA_URL = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

function collectPageErrors(page: Page, errors: string[]): void {
	page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
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
	if (!response?.ok) throw new Error(response?.error?.message ?? 'Unable to acquire smoke runtime');
	const lease: SmokeRuntimeLease = {
		tabId,
		documentId: response.data.documentId,
		runtimeRevision: response.data.runtimeRevision,
		capability,
	};
	smokeRuntimeLeases.set(`${tabId}:${lease.documentId}:${capability}`, lease);
	return lease;
}

async function releaseSmokeRuntimes(): Promise<void> {
	if (smokeRuntimeLeases.size === 0 || !runtimeLeaseClient || runtimeLeaseClient.isClosed()) return;
	const client = runtimeLeaseClient;
	for (const lease of smokeRuntimeLeases.values()) {
		await client.evaluate(async (owned) => {
			await chrome.runtime.sendMessage({
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
			});
		}, lease).catch(() => undefined);
	}
	smokeRuntimeLeases.clear();
}

async function waitForContentStatus(
	predicate: (status: ContentStatus) => boolean,
	timeoutMs = 5_000,
): Promise<ContentStatus> {
	const deadline = Date.now() + timeoutMs;
	let lastStatus: ContentStatus | undefined;
	while (Date.now() < deadline) {
		try {
			lastStatus = await readContentStatus();
			if (predicate(lastStatus)) return lastStatus;
		} catch {
			// Content initialization and service-worker startup are eventually consistent.
		}
		await new Promise((resolveWait) => setTimeout(resolveWait, 50));
	}
	throw new Error(`Timed out waiting for content status: ${JSON.stringify(lastStatus)}`);
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
		await new Promise((resolveWait) => setTimeout(resolveWait, 50));
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
			await new Promise((resolveWait) => setTimeout(resolveWait, 25));
		}
		throw new Error(`Invalid offscreen host snapshot: ${JSON.stringify(response)}`);
	}) as Promise<OffscreenHostSnapshot>;
}

async function openExtensionClient(path = 'popup.html'): Promise<Page> {
	const page = await browser.newPage();
	await page.goto(`chrome-extension://${extensionId}/${path}`, { waitUntil: 'domcontentloaded' });
	return page;
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
					const request = (type: string, payload: Record<string, unknown>) => chrome.runtime.sendMessage({
						protocolVersion: 2,
						requestId: crypto.randomUUID(),
						tabId: tab?.id,
						type,
						payload,
					});
					return {
						accent: getComputedStyle(document.querySelector<HTMLElement>('.vol-slider')!)
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
	if (popup.isClosed()) return;
	// Let the real action-popup lifecycle dispatch blur/pagehide so analyser
	// leases reach the worker before CDP destroys the target.
	await popup.evaluate(() => window.close()).catch(() => undefined);
	await eventually(
		async () => popup.isClosed(),
		(closed) => closed,
		'action popup close',
		1_000,
	).catch(() => undefined);
	if (!popup.isClosed()) await popup.close().catch(() => undefined);
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

async function readBadgeColor(tabId: number): Promise<number[]> {
	return evaluateServiceWorker(
		async (targetTabId) => chrome.action.getBadgeBackgroundColor({ tabId: targetTabId }),
		tabId,
	) as Promise<number[]>;
}

async function sendFromActionPopup<T>(message: Record<string, unknown>): Promise<T> {
	let popupClient: CDPSession | null = null;
	try {
		const target = await openActionPopupTarget();
		popupClient = await withDiagnosticTimeout(
			'attach to the real extension action popup',
			() => target.createCDPSession(),
			10_000,
		);
		await popupClient.send('Runtime.enable');
		const serializedMessage = JSON.stringify(message);
		const evaluation = await withDiagnosticTimeout(
			'send remote request from the real extension action popup',
			() => popupClient!.send('Runtime.evaluate', {
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
		await popupClient?.send('Runtime.evaluate', { expression: 'close()' }).catch(() => undefined);
		await popupClient?.detach().catch(() => undefined);
	}
}

async function installVisualizerBatchProbe(): Promise<void> {
	await evaluateServiceWorker(() => {
		type Probe = { count: number; listener: (message: unknown) => void };
		const scope = globalThis as typeof globalThis & { __spectraVisualizerProbe?: Probe };
		if (scope.__spectraVisualizerProbe) {
			chrome.runtime.onMessage.removeListener(scope.__spectraVisualizerProbe.listener);
		}
		const probe: Probe = {
			count: 0,
			listener(message: unknown) {
				if (message && typeof message === 'object'
					&& (message as { type?: unknown }).type === 'spectra.audio.visualizer.batch') {
					probe.count++;
				}
			},
		};
		scope.__spectraVisualizerProbe = probe;
		chrome.runtime.onMessage.addListener(probe.listener);
	});
}

async function readVisualizerBatchCount(): Promise<number> {
	return evaluateServiceWorker(() => {
		return (globalThis as typeof globalThis & {
			__spectraVisualizerProbe?: { count: number };
		}).__spectraVisualizerProbe?.count ?? 0;
	});
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

async function sendCaptureConfig(
	_client: Page,
	tabId: number,
	generation: number,
	config: AudioConfig,
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
				type: 'spectra.audio.capture.config',
				payload: { config: value.config },
			}),
			args: [request],
		});
		if (injection?.result === undefined) throw new Error('Capture config caller returned no result');
		return injection.result;
	}, { tabId, generation, config }) as Promise<CaptureResponse>;
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

async function selectSafeWebAudioFixture(): Promise<void> {
	await fixturePage.evaluate((source) => {
		const media = document.querySelector<HTMLMediaElement>('#v');
		if (!media) throw new Error('WebAudio smoke fixture media is missing');
		if (media.src === source || media.currentSrc === source) return;
		media.src = source;
		media.load();
	}, SILENT_WAV_DATA_URL);
	await fixturePage.waitForFunction(
		(source) => {
			const media = document.querySelector<HTMLMediaElement>('#v');
			return media?.src === source || media?.currentSrc === source;
		},
		{ timeout: 5_000 },
		SILENT_WAV_DATA_URL,
	);
}

async function markRegistryDomain(client: Page, domain: string, restricted: boolean): Promise<void> {
	const response = await client.evaluate(async ({ targetDomain, isRestricted }) => {
		return chrome.runtime.sendMessage({
			protocolVersion: 2,
			requestId: crypto.randomUUID(),
			type: 'spectra.registry.mark-probed',
			payload: {
				domain: targetDomain,
				fingerprint: `site:${targetDomain}`,
				route: isRestricted ? 'capture' : 'direct',
			},
		});
	}, { targetDomain: domain, isRestricted: restricted });
	if (!response?.ok) throw new Error(response?.error?.message ?? 'Unable to update the domain registry');
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
	const tabId = await getTabId(fixturePage.url());
	const created = await sendFromActionPopup<{
		ok: boolean;
		data?: RemotePublicSession;
		error?: { message?: string };
	}>({
		protocolVersion: 2,
		tabId,
		type: 'spectra.remote.session.create',
		payload: { tabId },
	});
	if (!created.ok || !created.data) {
		throw new Error(created.error?.message ?? 'Unable to create the offscreen smoke host');
	}
	await eventually(
		getOffscreenContextCount,
		(count) => count === 1,
		'offscreen host for the synthetic capture harness',
	);
	await sendFromActionPopup({
		protocolVersion: 2,
		tabId,
		type: 'spectra.remote.session.close',
		payload: { tabId, sessionId: created.data.sessionId },
	});
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

async function blockNextSyntheticCapture(): Promise<void> {
	await evaluateOffscreen<boolean>(`(() => {
		const state = globalThis.__spectraSmokeCaptureHarness;
		if (!state) throw new Error('Synthetic capture harness is not installed');
		state.blockNext = true;
		return true;
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

async function inspectWebAudio(tabId: number, saveMarkers = false): Promise<WebAudioProbe> {
	return evaluateServiceWorker(async ({ targetTabId, shouldSave }) => {
		const [injection] = await chrome.scripting.executeScript({
			target: { tabId: targetTabId },
			world: 'ISOLATED',
			func: (save) => {
				const scope = window as Window & {
					__SPECTRA_AUDIO_CONTROLLER_V2__?: {
						isReady(): boolean;
						runtime?: {
							context?: { state?: string };
							sources?: WeakMap<HTMLMediaElement, object>;
						};
					};
					__SPECTRA_CONTENT_RUNTIME__?: { revision?: string; disposed?: boolean };
					__SPECTRA_LISTENERS_READY__?: boolean;
					__spectraSmokeController?: object;
					__spectraSmokeSource?: object;
					__spectraSmokeRuntime?: { disposed?: boolean };
				};
				const media = document.querySelector<HTMLMediaElement>('video, audio');
				const controller = scope.__SPECTRA_AUDIO_CONTROLLER_V2__;
				const runtime = scope.__SPECTRA_CONTENT_RUNTIME__;
				const audioRuntime = controller?.runtime;
				const source = media ? audioRuntime?.sources?.get(media) : undefined;
				if (save) {
					scope.__spectraSmokeController = controller;
					scope.__spectraSmokeSource = source;
					scope.__spectraSmokeRuntime = runtime;
				}
				return {
					controllerReady: controller?.isReady() === true,
					contextState: audioRuntime?.context?.state ?? null,
					hasGraph: Boolean(source),
					listenersReady: scope.__SPECTRA_LISTENERS_READY__ === true,
					runtimeRevision: runtime?.revision ?? null,
					sameController: scope.__spectraSmokeController
						? scope.__spectraSmokeController === controller
						: null,
					sameSource: scope.__spectraSmokeSource ? scope.__spectraSmokeSource === source : null,
					oldRuntimeDisposed: scope.__spectraSmokeRuntime
						? scope.__spectraSmokeRuntime.disposed === true
						: null,
				};
			},
			args: [shouldSave],
		});
		if (!injection?.result) throw new Error('Unable to inspect the isolated WebAudio runtime');
		return injection.result;
	}, { targetTabId: tabId, shouldSave: saveMarkers }) as Promise<WebAudioProbe>;
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
	const connection = await withDiagnosticTimeout(
		'connect a fresh service-worker target session',
		() => puppeteer.connect({ browserWSEndpoint: browser.wsEndpoint() }),
		timeoutMs,
	);
	try {
		const target = await withDiagnosticTimeout(
			'discover replacement service-worker target',
			() => connection.waitForTarget(
				(candidate) => candidate.type() === 'service_worker' && candidate.url() === expectedUrl,
				{ timeout: timeoutMs },
			),
			timeoutMs,
		);
		const worker = await withDiagnosticTimeout(
			'resolve replacement service-worker target',
			() => target.worker(),
			timeoutMs,
		);
		if (!worker) throw new Error('Replacement service-worker target has no execution context');
		const identity = await withDiagnosticTimeout(
			'probe replacement service-worker identity',
			() => worker.evaluate(() => ({
				runtimeId: chrome.runtime.id,
				marker: (globalThis as typeof globalThis & {
					__spectraSmokeWorkerMarker?: string;
				}).__spectraSmokeWorkerMarker,
			})),
			timeoutMs,
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
	} catch (error) {
		await connection.disconnect().catch(() => undefined);
		throw error;
	}
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
		await new Promise((resolveWait) => setTimeout(resolveWait, 50));
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
		client = await withDiagnosticTimeout(stage, () => fixturePage.createCDPSession());
		stage = 'enable service-worker domain';
		const initialVersion = await withDiagnosticTimeout(stage, async () => {
			const initialVersionPromise = waitForWorkerVersion(
				client!,
				(version) => version.scriptURL === workerScriptUrl && version.runningStatus === 'running',
			);
			const [, version] = await Promise.all([
				client!.send('ServiceWorker.enable'),
				initialVersionPromise,
			]);
			return version;
		}, 12_000);

		stage = 'stop service worker';
		await withDiagnosticTimeout(stage, async () => {
			const stoppedPromise = waitForWorkerVersion(
				client!,
				(version) => version.versionId === initialVersion.versionId && version.runningStatus === 'stopped',
			);
			await Promise.all([
				client!.send('ServiceWorker.stopWorker', { versionId: initialVersion.versionId }),
				stoppedPromise,
			]);
		}, 12_000);
		stage = 'observe old worker shutdown';
		await withDiagnosticTimeout(stage, () => waitForServiceWorkerMarkerToDisappear(previousMarker), 12_000);

		stage = 'start service worker';
		await withDiagnosticTimeout(stage, () => client!.send('ServiceWorker.startWorker', {
			scopeURL: `chrome-extension://${extensionId}/`,
		}));
		stage = 'reacquire replacement worker through the suspend-safe helper';
		const replacementRuntimeId = await withDiagnosticTimeout(
			stage,
			() => evaluateServiceWorker(() => chrome.runtime.id),
			17_000,
		);
		if (replacementRuntimeId !== extensionId) {
			throw new Error(`Replacement worker belongs to unexpected extension ${replacementRuntimeId}`);
		}
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Service-worker restart failed during ${stage}: ${detail}`, { cause: error });
	} finally {
		if (client) {
			await withDiagnosticTimeout(
				'disable service-worker CDP domain',
				() => client!.send('ServiceWorker.disable'),
				2_000,
			).catch(() => undefined);
			await withDiagnosticTimeout(
				'detach service-worker CDP session',
				() => client!.detach(),
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

beforeAll(async () => {
	server = Bun.serve({
		port: 0,
		hostname: '127.0.0.1',
		fetch(request) {
			const pathname = new URL(request.url).pathname;
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
			if (pathname !== '/' && pathname !== '/smoke-test.html') {
				return new Response('Not found', { status: 404 });
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
			`--disable-extensions-except=${EXTENSION_DIR}`,
			`--load-extension=${EXTENSION_DIR}`,
			'--no-sandbox',
			'--disable-setuid-sandbox',
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
	test('loads the MV3 worker and isolated zero-work bootstrap without MAIN', async () => {
		expect(serviceWorkerTarget.url()).toBe(`chrome-extension://${extensionId}/background.js`);
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
		const client = await openExtensionClient();
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
		const result = await evaluateServiceWorker(async ({ url }) => {
			const tabs = await chrome.tabs.query({});
			const tab = tabs.find((candidate) => candidate.url === url);
			if (tab?.id === undefined) throw new Error(`Unable to find fixture tab: ${url}`);
			await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				world: 'ISOLATED',
				func: () => {
					const scope = window as Window & {
						__SPECTRA_CONTENT_BOOTSTRAP__?: object;
						__spectraBootstrapBefore?: object;
					};
					scope.__spectraBootstrapBefore = scope.__SPECTRA_CONTENT_BOOTSTRAP__;
				},
			});
			await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				files: ['content-bootstrap.js'],
				world: 'ISOLATED',
			});
			const [inspection] = await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				world: 'ISOLATED',
				func: () => {
					const scope = window as Window & {
						__SPECTRA_CONTENT_BOOTSTRAP__?: { bootstrapRevision?: string };
						__spectraBootstrapBefore?: object;
					};
					return {
						same: scope.__SPECTRA_CONTENT_BOOTSTRAP__ === scope.__spectraBootstrapBefore,
						revision: scope.__SPECTRA_CONTENT_BOOTSTRAP__?.bootstrapRevision,
					};
				},
			});
			return inspection?.result;
		}, { url: fixtureUrl });
		expect(result).toMatchObject({ same: true });
		expect(typeof result?.revision).toBe('string');
		expect(await fixturePage.evaluate(() => '__SPECTRA_MAIN_RUNTIME__' in window)).toBe(false);
	});

	test('tracks SPA media additions and removals without activating WebAudio', async () => {
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

	test('synchronizes a deferred body-portal playback-rate menu with the controlled video', async () => {
		const state = await fixturePage.evaluate(async ({ eventName, requestAttribute, resultAttribute }) => {
			const video = document.querySelector<HTMLVideoElement>('#v');
			const player = video?.parentElement;
			if (!video || !player) throw new Error('SPA video is missing');
			player.classList.add('xgplayer');
			const requestId = crypto.randomUUID();
			video.setAttribute(requestAttribute, JSON.stringify({ requestId, speed: 1.5 }));
			video.dispatchEvent(new Event(eventName));
			const result = JSON.parse(video.getAttribute(resultAttribute) ?? '{}') as {
				requestId?: string;
				actual?: number;
			};

			let selectedClicks = 0;
			const portal = document.createElement('div');
			portal.className = 'm_a7b';
			for (const rate of [1, 1.5, 2]) {
				const option = document.createElement('div');
				option.className = `i_${String(rate).replace('.', '_')}`;
				const label = document.createElement('span');
				label.textContent = rate === 1 ? '正常' : `${rate}倍`;
				option.append(label);
				if (rate === 1) option.className = 'selected';
				if (rate === 1.5) option.addEventListener('click', () => { selectedClicks += 1; });
				portal.append(option);
			}
			document.body.append(portal);
			await new Promise((resolveWait) => setTimeout(resolveWait, 50));
			const options = [...portal.children] as HTMLElement[];
			return {
				requestMatches: result.requestId === requestId,
				actual: result.actual,
				playbackRate: video.playbackRate,
				rootRate: player.getAttribute('data-spectra-playback-rate'),
				selectedClicks,
				selected: options.map((option) => option.getAttribute('aria-selected')),
			};
		}, {
			eventName: SPECTRA_PLAYBACK_RATE_EVENT,
			requestAttribute: SPECTRA_PLAYBACK_RATE_REQUEST_ATTRIBUTE,
			resultAttribute: SPECTRA_PLAYBACK_RATE_RESULT_ATTRIBUTE,
		});
		expect(state).toEqual({
			requestMatches: true,
			actual: 1.5,
			playbackRate: 1.5,
			rootRate: '1.5',
			selectedClicks: 1,
			selected: ['false', 'true', 'false'],
		});
	});

	test('fullscreen lifecycle preserves the site volume, mute, and playback rate', async () => {
		const preserved = await fixturePage.evaluate(async () => {
			const video = document.querySelector<HTMLVideoElement>('#v');
			if (!video) throw new Error('SPA video is missing');
			video.volume = 0.37;
			video.muted = true;
			video.playbackRate = 0.75;
			document.dispatchEvent(new Event('fullscreenchange'));
			document.dispatchEvent(new Event('webkitfullscreenchange'));
			await new Promise((resolveWait) => setTimeout(resolveWait, 100));
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
			mode: 'bypass',
			phase: 'idle',
			config: { volume: 100, muted: false, speed: 1 },
		});
	});

	test('initializes popup and options scripts without page exceptions', async () => {
		const popupErrors: string[] = [];
		const popup = await browser.newPage();
		collectPageErrors(popup, popupErrors);
		await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
		await popup.waitForSelector('#view-main:not([hidden])');
		await popup.click('#btn-settings');
		await popup.waitForSelector('#view-settings:not([hidden])');
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
			listTag: document.querySelector('#registry-list')?.tagName,
			panelLabel: document.querySelector('#registry-list')?.getAttribute('aria-labelledby'),
			routeValues: [...document.querySelectorAll<HTMLOptionElement>('#registry-new-route option')]
				.map((option) => option.value),
			hasLegacyTabs: Boolean(document.querySelector('#tab-restricted, #tab-safe')),
		}))).toEqual({
			listTag: 'UL',
			panelLabel: 'registry-group-title',
			routeValues: ['capture', 'direct'],
			hasLegacyTabs: false,
		});
		await popup.click('#btn-back');
		await popup.waitForSelector('#view-main:not([hidden])');
		expect(popupErrors).toEqual([]);
		await popup.close();
		expect(await getOffscreenContextCount()).toBe(0);
		expect(await fixturePage.evaluate(() => {
			return (window as Window & { __spectraAudioContextCount?: number })
				.__spectraAudioContextCount;
		})).toBe(0);

		const optionsErrors: string[] = [];
		const options = await browser.newPage();
		collectPageErrors(options, optionsErrors);
		await options.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });
		await options.waitForFunction(() => document.querySelectorAll('#slots-list .slot-row').length === 20);
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
				slider.value = '180';
				slider.dispatchEvent(new Event('input', { bubbles: true }));
				slider.dispatchEvent(new Event('change', { bubbles: true }));
			});
			await popup.waitForFunction(() => (
				(document.querySelector('.vol-slider') as HTMLInputElement | null)?.value === '180'
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
		await options.waitForFunction(() => document.querySelectorAll('#slots-list .slot-row').length === 20);
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
			await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
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
			await popup.waitForFunction(() => document.querySelector('.btn-pip')?.getAttribute('aria-pressed') === 'false');
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

	test('renders non-idle spectrum bars from a neutral playing media graph', async () => {
		const visualizerErrors: string[] = [];
		const visualizerPage = await browser.newPage();
		collectPageErrors(visualizerPage, visualizerErrors);
		const visualizerUrl = `${fixtureUrl}?dynamic-visualizer=1`;
		let popup: Page | null = null;
		try {
			await visualizerPage.goto(visualizerUrl, { waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(visualizerUrl);
			await visualizerPage.bringToFront();
			await visualizerPage.click('body');
			await visualizerPage.evaluate(async () => {
			const media = document.querySelector<HTMLVideoElement>('#v');
			if (!media) throw new Error('Visualizer fixture media is missing');
			const sampleRate = 8_000;
			const sampleCount = sampleRate;
			const bytes = new ArrayBuffer(44 + sampleCount * 2);
			const view = new DataView(bytes);
			const writeAscii = (offset: number, value: string) => {
				for (let index = 0; index < value.length; index += 1) {
					view.setUint8(offset + index, value.charCodeAt(index));
				}
			};
			writeAscii(0, 'RIFF');
			view.setUint32(4, 36 + sampleCount * 2, true);
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
			for (let index = 0; index < sampleCount; index += 1) {
				const sample = Math.sin(2 * Math.PI * 440 * index / sampleRate);
				view.setInt16(44 + index * 2, Math.round(sample * 16_000), true);
			}
			media.src = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
			media.loop = true;
			media.muted = false;
			media.volume = 0.15;
			await media.play();
			});

			const popupTarget = await openActionPopupTarget();
			popup = await popupTarget.asPage();
			await popup.waitForSelector('.glass-card');
			await popup.waitForFunction(() => {
				const canvas = document.querySelector<HTMLCanvasElement>('.viz-canvas');
				if (!canvas) return false;
				const pixels = canvas.getContext('2d')?.getImageData(
					0,
					0,
					canvas.width,
					Math.max(1, canvas.height - 4),
				).data;
				return Boolean(pixels?.some((value, index) => index % 4 === 3 && value > 0));
			}, { timeout: 15_000 });
		} finally {
			if (popup) await closeActionPopup(popup);
			await visualizerPage.close().catch(() => undefined);
		}
		expect(visualizerErrors).toEqual([]);
	}, 25_000);

	test('keeps visualizer IPC at zero without an active processor and after popup close', async () => {
		await fixturePage.bringToFront();
		const tabId = await getTabId(fixturePage.url());
		const disabled = await sendFromActionPopup<{
			ok: boolean;
			data?: { fields?: { audioEnabled?: { actual?: boolean } } };
			error?: { message?: string };
		}>({
			protocolVersion: 2,
			tabId,
			type: 'spectra.control.intent.submit',
			payload: {
				tabId,
				source: 'popup',
				requestedCoverage: 'full',
				target: null,
				patch: { audioEnabled: false },
			},
		});
		if (!disabled.ok || disabled.data?.fields?.audioEnabled?.actual !== false) {
			throw new Error(disabled.error?.message ?? 'Unable to establish the bypass visualizer baseline');
		}
		await installVisualizerBatchProbe();
		let popupClient: CDPSession | null = null;
		try {
			const popupTarget = await openActionPopupTarget(5_000);
			popupClient = await popupTarget.createCDPSession();
			await popupClient.send('Runtime.enable');

			await new Promise((resolveWait) => setTimeout(resolveWait, 500));
			expect(await readVisualizerBatchCount()).toBe(0);

			await popupClient.send('Runtime.evaluate', { expression: 'close()' });
			await new Promise((resolveWait) => setTimeout(resolveWait, 100));
			const countAfterClose = await readVisualizerBatchCount();
			await new Promise((resolveWait) => setTimeout(resolveWait, 250));
			expect(await readVisualizerBatchCount()).toBe(countAfterClose);
		} finally {
			await popupClient?.send('Runtime.evaluate', { expression: 'close()' }).catch(() => undefined);
			await popupClient?.detach().catch(() => undefined);
			await removeVisualizerBatchProbe();
		}
	}, 10_000);

	test('delivers only the selected locale strings to the Content OSD', async () => {
		const targetUrl = fixturePage.url();
		const extensionClient = await openExtensionClient('options.html');
		const settings = await withDiagnosticTimeout('select zh-CN for the OSD smoke test', () => (
			extensionClient.evaluate(async () => {
				const request = (type: string, payload: Record<string, unknown>) => chrome.runtime.sendMessage({
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					type,
					payload,
				});
				const current = await request('spectra.settings.get', {});
				if (!current?.ok) throw new Error('Unable to read settings before OSD smoke test');
				const changed = await request('spectra.settings.patch', {
					expectedRevision: current.data.revision,
					patch: { scope: 'global', changes: { lang: 'zh-CN' } },
				});
				if (!changed?.ok) throw new Error('Unable to select zh-CN for OSD smoke test');
				return {
					originalLanguage: current.data.globalSettings.lang,
					revision: changed.data.revision,
				};
			})
		), 5_000);

		try {
			await configureRuntime(targetUrl, {
				...DEFAULT_AUDIO_CONFIG,
				muted: false,
			});
			const tabId = await getTabId(targetUrl);
			const nativeBaseline = await extensionClient.evaluate(async (targetTabId) => (
				chrome.runtime.sendMessage({
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					type: 'spectra.control.intent.submit',
					payload: {
						tabId: targetTabId,
						source: 'popup',
						requestedCoverage: 'active-target',
						target: null,
						mutations: [{ field: 'mediaMuted', operation: 'set', value: false }],
					},
				})
			), tabId);
			if (!nativeBaseline?.ok || nativeBaseline.data.fields.mediaMuted?.actual !== false) {
				throw new Error(nativeBaseline?.error?.message ?? 'Unable to establish the native mute baseline');
			}
			const hotkey = await withDiagnosticTimeout('trigger the mute OSD', () => (
				evaluateServiceWorker(async (targetTabId) => chrome.tabs.sendMessage(targetTabId, {
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					tabId: targetTabId,
					type: 'spectra.hotkey.trigger',
					payload: { action: 'volume_mute' },
				}), tabId)
			), 5_000);
			if (!hotkey?.ok) throw new Error(hotkey?.error?.message ?? 'Unable to trigger mute OSD');
			await withDiagnosticTimeout('observe the actual media mute', () => fixturePage.waitForFunction(() => (
				document.querySelector<HTMLMediaElement>('video,audio')?.muted === true
			), { timeout: 5_000 }), 6_000);
			await withDiagnosticTimeout('observe the localized mute OSD', () => fixturePage.waitForFunction(() => {
				for (const host of document.body.querySelectorAll('div')) {
					if (host.shadowRoot?.getElementById('t')?.textContent === '静音') return true;
				}
				return false;
			}, { timeout: 5_000 }), 6_000);
			const unmuted = await withDiagnosticTimeout('trigger the unmute ACK', () => (
				evaluateServiceWorker(async (targetTabId) => chrome.tabs.sendMessage(targetTabId, {
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					tabId: targetTabId,
					type: 'spectra.hotkey.trigger',
					payload: { action: 'volume_mute' },
				}), tabId)
			), 5_000);
			if (!unmuted?.ok) throw new Error(unmuted?.error?.message ?? 'Unable to trigger unmute');
			await withDiagnosticTimeout('observe the actual media unmute', () => fixturePage.waitForFunction(() => (
				document.querySelector<HTMLMediaElement>('video,audio')?.muted === false
			), { timeout: 5_000 }), 6_000);
		} finally {
			await evaluateServiceWorker(async ({ language, revision }) => {
				await chrome.runtime.sendMessage({
					protocolVersion: 2,
					requestId: crypto.randomUUID(),
					type: 'spectra.settings.patch',
					payload: {
						expectedRevision: revision,
						patch: { scope: 'global', changes: { lang: language } },
					},
				});
			}, {
				language: settings.originalLanguage,
				revision: settings.revision,
			});
			await configureRuntime(targetUrl, { ...DEFAULT_AUDIO_CONFIG, muted: false }).catch(() => undefined);
			await extensionClient.close().catch(() => undefined);
		}
	}, 20_000);

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
						await new Promise((resolveWait) => setTimeout(resolveWait, 50));
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
				expect(start).toMatchObject({ ok: true, data: { phase: 'error', active: false } });
				const describedTab = hostSnapshot.audioTabs.find(
					(audio: { tabId: number }) => audio.tabId === result.tabIds[index],
				);
				expect(start.data.lastError.message).toMatch(/not been invoked|activeTab permission/u);
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

	test('keeps one real WebAudio controller, graph, and source across content reinjection', async () => {
		const extensionClient = await openExtensionClient();
		try {
			await markRegistryDomain(extensionClient, '127.0.0.1', false);
		} finally {
			await extensionClient.close();
		}

		await fixturePage.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
		await waitForContentBootstrapStatus(fixtureUrl);
		await selectSafeWebAudioFixture();
		await fixturePage.bringToFront();
		await fixturePage.click('body');
		const tabId = await getTabId(fixturePage.url());
		await configureRuntime(fixturePage.url(), {
			...DEFAULT_AUDIO_CONFIG,
			volume: 130,
			boost: 1.3,
		});
		await waitForContentStatus(
			(status) => status.mode === 'webaudio' && status.phase === 'active',
			10_000,
		);

		const before = await inspectWebAudio(tabId, true);
		expect(before).toMatchObject({
			controllerReady: true,
			contextState: 'running',
			hasGraph: true,
			listenersReady: true,
			runtimeRevision: SPECTRA_CONTENT_RUNTIME_REVISION,
		});

		await reinjectContent(tabId);
		const after = await eventually(
			() => inspectWebAudio(tabId),
			(probe) => probe.listenersReady
				&& probe.sameController === true
				&& probe.sameSource === true
				&& probe.oldRuntimeDisposed === true,
			'reinjected isolated runtime handoff',
			10_000,
		);
		expect(after).toMatchObject({
			controllerReady: true,
			contextState: 'running',
			hasGraph: true,
			sameController: true,
			sameSource: true,
			oldRuntimeDisposed: true,
		});

		await configureRuntime(fixturePage.url(), DEFAULT_AUDIO_CONFIG);
		await waitForContentStatus((status) => status.mode === 'bypass' && status.phase === 'idle');
	}, 35_000);

	test('creates an acknowledged capture processor with a real synthetic MediaStream', async () => {
		await installSyntheticCaptureHarness();
		await installTabCaptureStreamIdStub();
		const extensionClient = await openExtensionClient();
		const tabId = await getTabId(fixturePage.url());
		try {
			const started = await sendCaptureRequest(extensionClient, tabId, true, 300);
			expect(started).toMatchObject({
				ok: true,
				data: { tabId, generation: 300, phase: 'active', active: true, actualMode: 'capture' },
			});
			const host = await readOffscreenSnapshot();
			expect(host.audioTabs).toEqual(expect.arrayContaining([
				expect.objectContaining({ tabId, generation: 300 }),
			]));
			expect(await getOffscreenContextCount()).toBe(1);
			const harness = await readSyntheticCaptureState();
			expect(harness.calls).toBeGreaterThan(0);
			expect(harness.processorStates.filter((state) => state === 'running')).toHaveLength(1);

			const stopped = await sendCaptureRequest(extensionClient, tabId, false, 301);
			expect(stopped).toMatchObject({ ok: true, data: { phase: 'idle', active: false } });
			expect((await readOffscreenSnapshot()).audioTabs).toEqual([]);
		} finally {
			await extensionClient.close();
		}
	}, 35_000);

	test('keeps the single 0-800 control and every color on acknowledged actual state', async () => {
		await installSyntheticCaptureHarness();
		await installTabCaptureStreamIdStub();
		await fixturePage.bringToFront();
		const extensionClient = await openExtensionClient();
		const tabId = await getTabId(fixturePage.url());
		let pendingStart: Promise<CaptureResponse> | null = null;
		try {
			await submitEffectiveVolume(tabId, 80);
			const initial = await readContentStatus();
			const captureGeneration = (initial.generation ?? 0) + 1;
			const started = await sendCaptureRequest(
				extensionClient,
				tabId,
				true,
				captureGeneration,
				{ ...DEFAULT_AUDIO_CONFIG, volume: 80, volumeBase: 80 },
			);
			expect(started).toMatchObject({
				ok: true,
				data: { phase: 'active', active: true, actualMode: 'capture' },
			});
			const captureSession = await sendFromActionPopup<{
				ok: boolean;
				data?: { actualMode?: string; phase?: string };
			}>({
				protocolVersion: 2,
				requestId: crypto.randomUUID(),
				type: 'spectra.audio.session.get',
				payload: { tabId },
			});
			expect(captureSession).toMatchObject({
				ok: true,
				data: { actualMode: 'capture', phase: 'active' },
			});
			const capture80 = await readPopupVolumePresentation('#7c3aed');
			expect(capture80).toMatchObject({
				sliderCount: 1,
				min: '0',
				max: '800',
				value: '80',
				fillColor: 'rgb(124, 58, 237)',
				valueColor: 'rgb(124, 58, 237)',
				sliderAccent: '#7c3aed',
			});
			expect(await readBadgeColor(tabId)).toEqual([124, 58, 237, 255]);

			await sendCaptureRequest(
				extensionClient,
				tabId,
				false,
				captureGeneration + 1,
				{ ...DEFAULT_AUDIO_CONFIG, volume: 80, volumeBase: 80 },
			);
			await markRegistryDomain(extensionClient, '127.0.0.1', false);
			await selectSafeWebAudioFixture();
			await submitEffectiveVolume(tabId, 350);
			const webAudio = await waitForContentStatus(
				(status) => status.mode === 'webaudio' && status.phase === 'active'
					&& status.config?.volume === 350,
				15_000,
			);
			const webAudio350 = await readPopupVolumePresentation();
			expect(webAudio350).toMatchObject({
				sliderCount: 1,
				min: '0',
				max: '800',
				value: '350',
				fillColor: 'rgb(37, 99, 235)',
				valueColor: 'rgb(37, 99, 235)',
				sliderAccent: '#2563eb',
			});
			expect(await readBadgeColor(tabId)).toEqual([37, 99, 235, 255]);

			await blockNextSyntheticCapture();
			pendingStart = sendCaptureRequest(
				extensionClient,
				tabId,
				true,
				(webAudio.generation ?? captureGeneration + 1) + 1,
				{ ...DEFAULT_AUDIO_CONFIG, volume: 350, volumeBase: 100, boost: 3.5 },
			);
			await eventually(
				readSyntheticCaptureState,
				(state) => state.pending,
				'blocked Capture startup for color verification',
			);
			const starting = await readPopupVolumePresentation();
			expect(starting).toMatchObject({
				value: '350',
				fillColor: 'rgb(37, 99, 235)',
				valueColor: 'rgb(37, 99, 235)',
				sliderAccent: '#2563eb',
			});
			expect(await readBadgeColor(tabId)).toEqual([37, 99, 235, 255]);

			await releaseSyntheticCapture();
			const active = await pendingStart;
			pendingStart = null;
			expect(active).toMatchObject({ ok: true, data: { phase: 'active', active: true } });
			const capture350 = await readPopupVolumePresentation('#7c3aed');
			expect(capture350).toMatchObject({
				value: '350',
				fillColor: 'rgb(124, 58, 237)',
				valueColor: 'rgb(124, 58, 237)',
				sliderAccent: '#7c3aed',
			});
			expect(await readBadgeColor(tabId)).toEqual([124, 58, 237, 255]);

			await submitEffectiveVolume(tabId, 0);
			const silent = await readPopupVolumePresentation();
			expect(silent).toMatchObject({
				value: '0',
				fillColor: 'rgb(156, 163, 175)',
				valueColor: 'rgb(156, 163, 175)',
				sliderAccent: '#9ca3af',
			});
			expect(await readBadgeColor(tabId)).toEqual([156, 163, 175, 255]);
		} finally {
			await releaseSyntheticCapture();
			await pendingStart?.catch(() => undefined);
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
			await extensionClient.close();
		}
	}, 60_000);

	test('switches atomically from WebAudio to explicit Capture and back', async () => {
		await installSyntheticCaptureHarness();
		await installTabCaptureStreamIdStub();
		const extensionClient = await openExtensionClient();
		const tabId = await getTabId(fixturePage.url());
		try {
			await markRegistryDomain(extensionClient, '127.0.0.1', false);
			await selectSafeWebAudioFixture();
			await configureRuntime(fixturePage.url(), {
				...DEFAULT_AUDIO_CONFIG,
				volume: 130,
				boost: 1.3,
			});
			const webAudio = await waitForContentStatus(
				(status) => status.mode === 'webaudio' && status.phase === 'active',
				10_000,
			);

			const started = await sendCaptureRequest(
				extensionClient,
				tabId,
				true,
				(webAudio.generation ?? 0) + 1,
				{ ...DEFAULT_AUDIO_CONFIG, volume: 130, boost: 1.3 },
			);
			expect(started).toMatchObject({ ok: true, data: { active: true, phase: 'active' } });
			const captured = await waitForContentStatus(
				(status) => status.mode === 'capture' && status.phase === 'active',
				15_000,
			);
			expect((await readOffscreenSnapshot()).audioTabs).toEqual(expect.arrayContaining([
				expect.objectContaining({ tabId, generation: captured.generation }),
			]));

			const stopped = await sendCaptureRequest(
				extensionClient,
				tabId,
				false,
				(captured.generation ?? 0) + 1,
				{ ...DEFAULT_AUDIO_CONFIG, volume: 130, boost: 1.3 },
			);
			expect(stopped).toMatchObject({ ok: true, data: { active: false } });
			const restored = await waitForContentStatus(
				(status) => status.mode === 'webaudio' && status.phase === 'active',
				15_000,
			);
			expect(restored.generation).toBeGreaterThan(captured.generation ?? 0);
			expect((await readOffscreenSnapshot()).audioTabs).toEqual([]);
		} finally {
			await extensionClient.close();
			await configureRuntime(fixturePage.url(), DEFAULT_AUDIO_CONFIG).catch(() => undefined);
			await waitForContentStatus(
				(status) => status.mode === 'bypass' && status.phase === 'idle',
				10_000,
			).catch(() => undefined);
		}
	}, 45_000);

	test('resolves START pending to a newer WebAudio mode and discards the stale capture ACK', async () => {
		const extensionClient = await openExtensionClient();
		const tabId = await getTabId(fixturePage.url());
		await blockNextSyntheticCapture();
		try {
			await selectSafeWebAudioFixture();
			const startPromise = sendCaptureRequest(extensionClient, tabId, true, 400);
			await eventually(
				readSyntheticCaptureState,
				(state) => state.pending,
				'pending offscreen getUserMedia',
			);
			await eventually(
				() => readContentStatus(),
				(status) => status.phase === 'starting' && (status.generation ?? 0) >= 400,
				'content capture starting state',
			);

			const webAudioPromise = configureRuntime(
				fixturePage.url(),
				{ ...DEFAULT_AUDIO_CONFIG, volume: 140, boost: 1.4 },
			);
			await releaseSyntheticCapture();
			const [startResponse] = await Promise.all([startPromise, webAudioPromise]);
			expect(startResponse.ok).toBe(true);

			const finalStatus = await waitForContentStatus(
				(status) => status.mode === 'webaudio' && status.phase === 'active',
				15_000,
			);
			expect((await readOffscreenSnapshot()).audioTabs).toEqual([]);
			const stale = await sendCaptureRequest(
				extensionClient,
				tabId,
				true,
				Math.max(0, (finalStatus.generation ?? 401) - 1),
			);
			expect(stale).toMatchObject({ ok: true, data: { active: false } });
			expect((await readOffscreenSnapshot()).audioTabs).toEqual([]);
			await extensionClient.close();
			await configureRuntime(fixturePage.url(), DEFAULT_AUDIO_CONFIG);
			await waitForContentStatus((status) => status.mode === 'bypass' && status.phase === 'idle');
		} finally {
			await releaseSyntheticCapture();
			await extensionClient.close().catch(() => undefined);
		}
	}, 45_000);

	test('restores active capture across worker restart and shares one host with authenticated remote', async () => {
		await installSyntheticCaptureHarness();
		await installTabCaptureStreamIdStub();
		const extensionClient = await openExtensionClient();
		const secondary = await browser.newPage();
		const wrongRemote = await browser.newPage();
		const authenticatedRemote = await browser.newPage();
		const wrongRemoteErrors: string[] = [];
		collectPageErrors(wrongRemote, wrongRemoteErrors);
		wrongRemote.on('console', (message) => {
			if (message.type() === 'error' || message.type() === 'warning') {
				wrongRemoteErrors.push(`console.${message.type()}: ${message.text()}`);
			}
		});
		const tabId = await getTabId(fixturePage.url());
		const secondaryUrl = `${fixtureUrl}?remote-secondary=1`;
		let session: RemotePublicSession | null = null;
		try {
			await configureRuntime(fixturePage.url(), DEFAULT_AUDIO_CONFIG);
			await waitForContentStatus((status) => status.mode === 'bypass' && status.phase === 'idle');
			await secondary.goto(secondaryUrl, { waitUntil: 'domcontentloaded' });
			await waitForContentBootstrapStatus(secondaryUrl);

			const started = await sendCaptureRequest(extensionClient, tabId, true, 500);
			expect(started).toMatchObject({ ok: true, data: { generation: 500, phase: 'active', active: true } });
			expect(await sendFromActionPopup({
				protocolVersion: 2,
				tabId,
				type: 'spectra.audio.session.get',
				payload: { tabId },
			})).toMatchObject({
				ok: true,
				data: { generation: 500, actualMode: 'capture', phase: 'active' },
			});
			await restartServiceWorker();

			const recovered = await sendCaptureConfig(
				extensionClient,
				tabId,
				501,
				DEFAULT_AUDIO_CONFIG,
			);
			expect(recovered).toMatchObject({
				ok: true,
				data: { generation: 501, phase: 'active', active: true, actualMode: 'capture' },
			});
			expect(await getOffscreenContextCount()).toBe(1);
			expect((await readOffscreenSnapshot()).audioTabs).toEqual(expect.arrayContaining([
				expect.objectContaining({ tabId, generation: 501 }),
			]));

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
				expect.objectContaining({ tabId, generation: 501 }),
			]));
			expect(sharedHost.remoteTabs).toContainEqual({ tabId, sessionId: session.sessionId });

			await wrongRemote.goto(remotePairingUrl(session, 'AAAAAAAAAAAAAAAAAAAAAA'), {
				waitUntil: 'domcontentloaded',
			});
			try {
				await eventually(
					() => wrongRemote.$eval('#status-text', (element) => element.textContent ?? ''),
					(status) => /Authentication failed|Host rejected authentication/u.test(status),
					'wrong-secret remote authentication rejection',
					25_000,
				);
			} catch (error) {
				const [status, host, remoteDebug] = await Promise.all([
					wrongRemote.$eval('#status-text', (element) => element.textContent ?? '').catch(() => null),
					readOffscreenSnapshot().catch(() => null),
					wrongRemote.evaluate(() => ({
						href: location.href,
						resources: performance.getEntriesByType('resource').map((entry) => entry.name),
						online: navigator.onLine,
					})).catch(() => null),
				]);
				throw new Error(
					`Wrong-secret remote did not receive an authentication result: ${JSON.stringify({ status, host, remoteDebug, wrongRemoteErrors })}`,
					{ cause: error },
				);
			}
			expect(await wrongRemote.$eval('#tab-title', (element) => element.textContent)).toBe(
				'Waiting for authenticated sync…',
			);
			expect(await wrongRemote.$eval('[data-command="volume_up"]', (element) => (
				(element as HTMLButtonElement).disabled
			))).toBe(true);
			expect((await readContentStatus()).config?.volume).toBe(100);

			await authenticatedRemote.goto(remotePairingUrl(session), { waitUntil: 'domcontentloaded' });
			try {
				await authenticatedRemote.waitForFunction(
					() => document.querySelector('#status-text')?.textContent === 'Authenticated and connected',
					{ timeout: 25_000, polling: 100 },
				);
			} catch (error) {
				const [remoteStatus, remoteTitle, hostSnapshot] = await Promise.all([
					authenticatedRemote.$eval('#status-text', (element) => element.textContent ?? ''),
					authenticatedRemote.$eval('#tab-title', (element) => element.textContent ?? ''),
					readOffscreenSnapshot(),
				]);
				throw new Error(
					`Authenticated remote did not connect: status=${JSON.stringify(remoteStatus)} title=${JSON.stringify(remoteTitle)} host=${JSON.stringify(hostSnapshot)}`,
					{ cause: error },
				);
			}
			try {
				await authenticatedRemote.waitForFunction(
					() => document.querySelector('#tab-title')?.textContent === 'SPECTRA extension smoke fixture',
					{ timeout: 10_000, polling: 100 },
				);
			} catch (error) {
				const [remoteStatus, remoteTitle, snapshotResponse] = await Promise.all([
					authenticatedRemote.$eval('#status-text', (element) => element.textContent ?? ''),
					authenticatedRemote.$eval('#tab-title', (element) => element.textContent ?? ''),
					extensionClient.evaluate(async (targetTabId) => chrome.runtime.sendMessage({
						protocolVersion: 2,
						requestId: crypto.randomUUID(),
						tabId: targetTabId,
						type: 'spectra.control.snapshot.get',
						payload: { tabId: targetTabId },
					}), tabId),
				]);
				throw new Error(
					`Authenticated remote did not receive state: status=${JSON.stringify(remoteStatus)} title=${JSON.stringify(remoteTitle)} snapshot=${JSON.stringify(snapshotResponse)}`,
					{ cause: error },
				);
			}
			expect(await authenticatedRemote.$eval('[data-command="volume_up"]', (element) => (
				(element as HTMLButtonElement).disabled
			))).toBe(false);
			await authenticatedRemote.waitForSelector('.volume-display.capture-active');
			expect(await authenticatedRemote.$eval('#vol-display', (element) => (
				getComputedStyle(element).color
			))).toBe('rgb(124, 58, 237)');
			expect((await readOffscreenSnapshot()).remoteTabs).toContainEqual({ tabId, sessionId: session.sessionId });

			// The offscreen host survives the worker. Its recovered generation must
			// authorize the first post-restart command instead of forcing a sync-only drop.
			await withDiagnosticTimeout(
				'restart service worker with an authenticated remote session',
				restartServiceWorker,
				45_000,
			);
			await withDiagnosticTimeout(
				'send the first authenticated remote command after worker restart',
				() => authenticatedRemote.$eval(
					'[data-command="volume_up"]',
					(element) => (element as HTMLButtonElement).click(),
				),
				5_000,
			);
			await eventually(
				() => readContentStatus(),
				(status) => status.config?.volume === 110 && status.config?.boost === 1.1,
				'first remote command after service-worker recovery',
				10_000,
			);
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
			await Promise.all([
				extensionClient.close(),
				secondary.close(),
				wrongRemote.close(),
				authenticatedRemote.close(),
			]);
		}
	}, 120_000);

	test('cleans active capture on immediate navigation and close after worker restart', async () => {
		await installSyntheticCaptureHarness();
		await installTabCaptureStreamIdStub();
		const extensionClient = await openExtensionClient();
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
			const starts = await Promise.all([
				sendCaptureRequest(extensionClient, navigatingTabId, true, 700),
				sendCaptureRequest(extensionClient, closingTabId, true, 800),
			]);
			expect(starts).toEqual([
				expect.objectContaining({ ok: true, data: expect.objectContaining({ active: true }) }),
				expect.objectContaining({ ok: true, data: expect.objectContaining({ active: true }) }),
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
			await extensionClient.close();
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
			await new Promise((resolveWait) => setTimeout(resolveWait, 500));
			await fixturePage.goto(`${fixtureUrl}?after-extension-reload=1`, {
				waitUntil: 'domcontentloaded',
			});
			await new Promise((resolveWait) => setTimeout(resolveWait, 500));
			expect(fixtureErrors.slice(errorsBefore)).toEqual([]);
			expect(reloadDiagnostics).toEqual([]);
		} finally {
			fixturePage.off('console', onConsole);
			await extensionClient.close().catch(() => undefined);
		}
	}, 30_000);
});

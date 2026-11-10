import { afterEach, describe, expect, test } from 'bun:test';
import { DEFAULT_AUDIO_CONFIG, type ControlOperationAck } from '@nexus/contracts';
import {
	appendBoundedSample,
	bindPopupControlPort,
	summarizeSettleLatency,
	type PopupControlBatch,
	type PopupControlBatchResult,
} from '../src/background/popup-control-port';
import {
	isPopupControlPortRequest,
	isPopupControlPortResponse,
	POPUP_CONTROL_PORT,
} from '../src/shared/popup-control-port';
import { openPopupControlTransport } from '../src/popup/card/control-port';
import { BADGE_COLORS, badgeState } from '../src/background/state';
import { hasBadgeUsage, resetBadgeUsageForTests } from '../src/background/badge-usage';

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');

afterEach(() => {
	badgeState.clear();
	resetBadgeUsageForTests();
	if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
	else Reflect.deleteProperty(globalThis, 'chrome');
});

describe('Popup Background control port', () => {

	test.each([false, true])('buffers the first pending frame and flush until identity resolves (disconnect: %s)', async (disconnect) => {
		installChrome();
		let text = '';
		let color = '';
		Object.assign(chrome, {
			storage: { session: { get: async () => ({}) } },
			action: {
				setBadgeText: async (value: { text: string }) => { text = value.text; },
				setBadgeBackgroundColor: async (value: { color: string }) => { color = value.color; },
				setBadgeTextColor: async () => undefined,
			},
		});
		let resolveIdentity!: (identity: { tabId: number; documentId: string; origin: string; generation: number }) => void;
		const verification = new Promise<{ tabId: number; documentId: string; origin: string; generation: number }>((resolve) => {
			resolveIdentity = resolve;
		});
		let complete!: (result: PopupControlBatchResult) => void;
		const submissions: PopupControlBatch[] = [];
		const port = new FakePort();
		bindPopupControlPort(port.value, {
			resolveIdentity: () => verification,
			submit: (batch) => {
				submissions.push(batch);
				return new Promise((resolve) => { complete = resolve; });
			},
		});
		port.message(openMessage());
		port.message({ ...stageMessage(1, 110), presentationVolume: 110, tone: 'capture' });
		port.message({ type: 'flush', sessionId: 'session', throughRevision: 1 });
		if (disconnect) port.disconnectFromBrowser();
		expect(text).toBe('');
		expect(submissions).toHaveLength(0);
		resolveIdentity({ tabId: 7, documentId: 'document', origin: 'https://media.example', generation: 1 });
		await waitFor(() => submissions.length === 1);
		expect(text).toBe('110');
		expect(color).toBe(BADGE_COLORS.CAPTURE);
		expect(badgeState.has(7)).toBe(false);
		expect(await hasBadgeUsage(7)).toBe(false);
		complete(success());
		await waitFor(() => text === '');
		expect(submissions).toHaveLength(1);
	});
	test('a failed staged request never paints or records successful badge usage', async () => {
		installChrome();
		let paints = 0;
		Object.assign(chrome, {
			storage: { session: { get: async () => ({}), set: async () => undefined } },
			action: {
				setBadgeText: async () => { paints += 1; },
				setBadgeBackgroundColor: async () => { paints += 1; },
				setBadgeTextColor: async () => { paints += 1; },
			},
		});
		const port = new FakePort();
		bindPopupControlPort(port.value, {
			resolveIdentity: async () => ({ tabId: 7, documentId: 'document', origin: 'https://media.example', generation: 1 }),
			submit: async () => { throw new Error('Control belongs to a stale document'); },
		});
		port.message(openMessage());
		port.message(stageMessage(1, 350));
		expect(paints).toBe(0);
		expect(badgeState.has(7)).toBe(false);
		port.message({ type: 'flush', sessionId: 'session', throughRevision: 1 });
		await waitFor(() => port.posts.length === 2);
		expect(port.posts[1]).toMatchObject({ error: { code: 'popup_control_failed' } });
		expect(paints).toBe(0);
		expect(badgeState.has(7)).toBe(false);
		expect(await hasBadgeUsage(7)).toBe(false);
	});

	test('continues the accepted latest value once after the Popup disconnects', async () => {
		installChrome();
		const port = new FakePort();
		const submissions: PopupControlBatch[] = [];
		const completions: Array<(result: PopupControlBatchResult) => void> = [];
		bindPopupControlPort(port.value, {
			resolveIdentity: async () => ({ tabId: 7, documentId: 'document', origin: 'https://media.example', generation: 1 }),
			submit: (batch) => {
				submissions.push(batch);
				return new Promise((resolve) => completions.push(resolve));
			},
		});
		port.message(openMessage());
		port.message(stageMessage(1, 80));
		port.message({ type: 'flush', sessionId: 'session', throughRevision: 1 });
		await waitFor(() => submissions.length === 1);
		port.message(stageMessage(2, 90));
		port.disconnectFromBrowser();
		completions[0]?.(success());
		await waitFor(() => submissions.length === 2);
		expect(submissions.map((batch) => batch.effectiveVolume)).toEqual([80, 90]);
		completions[1]?.(success());
		await Promise.resolve();
		expect(submissions).toHaveLength(2);
	});

	test('forwards partial acknowledgements together with the typed failure', async () => {
		installChrome();
		const port = new FakePort();
		const volumeAck = { operation: 'effective-volume' } as ControlOperationAck<'effective-volume'>;
		bindPopupControlPort(port.value, {
			resolveIdentity: async () => ({ tabId: 7, documentId: 'document', origin: 'https://media.example', generation: 1 }),
			submit: async () => ({
				volumeAck,
				fieldAcks: [],
				error: { code: 'field_failed', message: 'DSP failed', retryable: true },
			}),
		});
		port.message(openMessage());
		port.message(stageMessage(1, 90));
		port.message({ type: 'flush', sessionId: 'session', throughRevision: 1 });
		await waitFor(() => port.posts.length === 2);
		expect(port.posts[0]).toEqual({ type: 'ready', sessionId: 'session' });
		expect(port.posts[1]).toMatchObject({
			throughRevision: 1,
			volumeAck,
			error: { code: 'field_failed' },
		});
	});

	test('rejects a popup-looking Port that belongs to a tab', () => {
		installChrome();
		const port = new FakePort({ id: 'extension-id', url: 'chrome-extension://extension-id/popup.html', tab: {} });
		bindPopupControlPort(port.value, {
			resolveIdentity: async () => ({ tabId: 7, documentId: 'document', origin: 'https://media.example', generation: 1 }),
			submit: async () => success(),
		});
		expect(port.disconnected).toBe(true);
	});
});

describe('Popup control Port contract', () => {
	test('rejects malformed, unbounded, duplicate, and empty messages without throwing', () => {
		expect(isPopupControlPortRequest(null)).toBe(false);
		expect(isPopupControlPortRequest({ ...openMessage(), unknown: true })).toBe(false);
		expect(isPopupControlPortRequest(stageMessage(1, Number.POSITIVE_INFINITY))).toBe(false);
		expect(isPopupControlPortRequest({ ...stageMessage(1, 350), tone: 'capture' })).toBe(false);
		expect(isPopupControlPortRequest({ ...stageMessage(1, 350), tone: 'capture', presentationVolume: 350 })).toBe(true);
		expect(isPopupControlPortRequest({
			type: 'stage', sessionId: 'session', inputRevision: 1,
			groups: [
				{ requestedCoverage: 'full', patch: { bass: 1 } },
				{ requestedCoverage: 'full', patch: { mono: true } },
			],
		})).toBe(false);
		expect(isPopupControlPortResponse({
			type: 'settled', sessionId: 'session', throughRevision: 1,
			volumeAck: null, fieldAcks: [], error: null,
		})).toBe(false);
	});
});

describe('Popup control Port client', () => {

	test.each(['tabId', 'documentId'] as const)('rejects a fresh audio lifecycle for another %s', async (field) => {
		const port = new FakePort();
		installChrome(port.value);
		const transport = openPopupControlTransport(7, 'document');
		const { sessionId } = port.posts[0] as { sessionId: string };
		port.message({ type: 'ready', sessionId });
		transport.stage({ inputRevision: 1, effectiveVolume: 110, groups: [] });
		const failed = transport.flush(1).catch((error: unknown) => error);
		const audioSession = {
			tabId: 7, documentId: 'document', origin: 'https://media.example', generation: 1,
			configRevision: 1, desiredMode: 'capture', actualMode: 'capture', phase: 'active',
			actualConfig: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] }, lastError: null,
			...(field === 'tabId' ? { tabId: 8 } : { documentId: 'another-document' }),
		};
		const response = { type: 'settled', sessionId, throughRevision: 1, volumeAck: null,
			fieldAcks: [], audioSession, error: { code: 'unavailable', message: 'Control failed', retryable: true } };
		expect(isPopupControlPortResponse(response)).toBe(true);
		port.message(response);
		expect(await failed).toBeInstanceOf(Error);
		expect(port.disconnected).toBe(true);
	});

	test('accepts session ready and settles a staged input', async () => {
		const port = new FakePort();
		installChrome(port.value);
		const transport = openPopupControlTransport(7, 'document');
		const { sessionId } = port.posts[0] as { sessionId: string };
		port.message({ type: 'ready', sessionId });
		transport.stage({ inputRevision: 1, effectiveVolume: 90, groups: [] });
		const flush = transport.flush(1);
		const response = { type: 'settled', sessionId, throughRevision: 1, volumeAck: null,
			fieldAcks: [], error: { code: 'unavailable', message: 'Media unavailable', retryable: true } };
		port.message(response);
		expect(await flush).toEqual(response);
		expect(transport.hasPendingVolume()).toBe(false);
		transport.dispose();
	});

	test.each(['wrong-session', 'duplicate'])('rejects %s ready once with one causal failure', async (kind) => {
		const port = new FakePort();
		installChrome(port.value);
		const transport = openPopupControlTransport(7, 'document');
		const failures: Error[] = [];
		transport.onFailure((error) => failures.push(error));
		const { sessionId } = port.posts[0] as { sessionId: string };
		transport.stage({ inputRevision: 1, effectiveVolume: 90, groups: [] });
		const flush = transport.flush(1).catch((error: unknown) => error);
		if (kind === 'duplicate') port.message({ type: 'ready', sessionId });
		port.message({ type: 'ready', sessionId: kind === 'duplicate' ? sessionId : 'wrong' });
		port.disconnectFromBrowser();
		expect(failures).toHaveLength(1);
		expect(await flush).toBe(failures[0]);
		expect(await transport.flush(1).catch((error: unknown) => error)).toBe(failures[0]);
	});

	test('disposing before readiness remains silent beyond the deadline', async () => {
		const port = new FakePort();
		installChrome(port.value);
		const transport = openPopupControlTransport(7, 'document');
		const failures: Error[] = [];
		transport.onFailure((error) => failures.push(error));
		transport.dispose();
		port.disconnectFromBrowser();
		await new Promise((resolve) => setTimeout(resolve, 5_100));
		expect(failures).toEqual([]);
		expect(port.disconnected).toBe(true);
	}, 8_000);

	test('fails visibly when an older Background accepts the connection but never acknowledges it', async () => {
		const port = new FakePort();
		installChrome(port.value);
		const transport = openPopupControlTransport(7, 'document');
		const failure = new Promise<Error>((resolve) => { transport.onFailure(resolve); });
		transport.stage({ inputRevision: 1, effectiveVolume: 110, groups: [] });
		const flushed = transport.flush(1).then(() => false, () => true);
		try {
			expect((await failure).message).toContain('did not acknowledge');
			expect(await flushed).toBe(true);
			expect(transport.hasPendingVolume()).toBe(false);
			expect(port.disconnected).toBe(true);
		} finally { transport.dispose(); }
	}, 8_000);

	test('settles every flush after the browser disconnects an accepted input', async () => {
		const port = new FakePort();
		installChrome(port.value);
		const transport = openPopupControlTransport(7, 'document');
		transport.stage({ inputRevision: 1, effectiveVolume: 90, groups: [] });
		port.disconnectFromBrowser();
		let error: unknown;
		let settled = false;
		const flush = transport.flush(1).catch((failure: unknown) => { error = failure; })
			.finally(() => { settled = true; });
		await waitFor(() => settled);
		await flush;
		expect(error).toBeInstanceOf(Error);
	});

	test('returns the flush rejection when postMessage fails without orphaning its waiter', async () => {
		const port = new FakePort();
		let postCount = 0;
		port.onPost = () => {
			postCount += 1;
			if (postCount === 3) throw new Error('Port disappeared');
		};
		installChrome(port.value);
		const transport = openPopupControlTransport(7, 'document');
		transport.stage({ inputRevision: 1, effectiveVolume: 90, groups: [] });
		const flush = transport.flush(1);
		await expect(flush).rejects.toThrow('Background control channel disconnected');
		expect(postCount).toBe(3);
	});
});

function installChrome(connectedPort?: chrome.runtime.Port): void {
	Object.defineProperty(globalThis, 'chrome', {
		configurable: true,
		value: { runtime: {
			id: 'extension-id',
			getURL: (path: string) => `chrome-extension://extension-id/${path}`,
			connect: () => connectedPort,
		} },
	});
}

function openMessage() {
	return { type: 'open' as const, sessionId: 'session', tabId: 7, documentId: 'document' };
}

function stageMessage(inputRevision: number, effectiveVolume: number) {
	return { type: 'stage' as const, sessionId: 'session', inputRevision, effectiveVolume, groups: [] };
}

function success(): PopupControlBatchResult {
	return { volumeAck: null, fieldAcks: [], error: null };
}

class FakePort {
	readonly posts: unknown[] = [];
	disconnected = false;
	onPost: ((message: unknown) => void) | null = null;
	private readonly messageListeners = new Set<(message: unknown) => void>();
	private readonly disconnectListeners = new Set<() => void>();
	readonly value: chrome.runtime.Port;

	constructor(sender: chrome.runtime.MessageSender = {
		id: 'extension-id', url: 'chrome-extension://extension-id/popup.html',
	}) {
		this.value = {
			name: POPUP_CONTROL_PORT,
			sender,
			postMessage: (message: unknown) => {
				this.onPost?.(message);
				this.posts.push(message);
			},
			disconnect: () => { this.disconnected = true; },
			onMessage: {
				addListener: (listener: (message: unknown) => void) => { this.messageListeners.add(listener); },
				removeListener: (listener: (message: unknown) => void) => { this.messageListeners.delete(listener); },
			} as chrome.runtime.Port['onMessage'],
			onDisconnect: {
				addListener: (listener: () => void) => { this.disconnectListeners.add(listener); },
				removeListener: (listener: () => void) => { this.disconnectListeners.delete(listener); },
			} as chrome.runtime.Port['onDisconnect'],
		} as chrome.runtime.Port;
	}

	message(message: unknown): void {
		for (const listener of this.messageListeners) listener(message);
	}

	disconnectFromBrowser(): void {
		for (const listener of [...this.disconnectListeners]) listener();
	}
}

async function waitFor(condition: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (condition()) return;
		await Promise.resolve();
	}
	throw new Error('Condition did not become true');
}

describe('Popup control settle latency', () => {
	test('keeps the sample window bounded and ordered by arrival', () => {
		let samples: number[] = [];
		for (const value of [1, 2, 3, 4]) {
			samples = appendBoundedSample(samples, value, 3);
		}
		expect(samples).toEqual([2, 3, 4]);
	});

	test('reports percentiles from an independent nearest-rank oracle', () => {
		// Twenty samples 1..20: ceil(0.5*20)=10 -> 10, ceil(0.95*20)=19 -> 19.
		const samples = Array.from({ length: 20 }, (_, index) => index + 1);
		expect(summarizeSettleLatency(samples)).toEqual({ p50: 10, p95: 19, max: 20 });
	});

	test('reports zeros rather than inventing a latency before any sample', () => {
		expect(summarizeSettleLatency([])).toEqual({ p50: 0, p95: 0, max: 0 });
		expect(summarizeSettleLatency([7])).toEqual({ p50: 7, p95: 7, max: 7 });
	});
});

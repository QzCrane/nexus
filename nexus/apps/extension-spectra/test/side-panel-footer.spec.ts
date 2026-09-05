import { afterEach, describe, expect, test } from 'bun:test';
import { DEFAULT_AUDIO_CONFIG } from '@nexus/kernel';
import { bindFooterActions } from '../src/popup/side-panel/footer-actions';
import { setCurrentPanelTabId } from '../src/popup/side-panel/panel-session';
import { registerCard } from '../src/popup/side-panel/registry';

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

class FakeButton {
	onclick: (() => void) | null = null;
}

class FakeInput {
	constructor(public value: string) {}
}

class FakePanel {
	readonly speedSlider = new FakeInput('1');
	readonly speedInput = new FakeInput('9.99');

	querySelector<T>(selector: string): T | null {
		if (selector === '.sp-speed-slider') return this.speedSlider as unknown as T;
		if (selector === '.sp-speed-input') return this.speedInput as unknown as T;
		return null;
	}

	querySelectorAll<T>(_selector: string): T[] {
		return [];
	}
}

afterEach(() => {
	setCurrentPanelTabId(null);
	if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
	else Reflect.deleteProperty(globalThis, 'document');
});

describe('SidePanel footer tab identity', () => {
	test('does not project a reset result after switching to another tab while flush is pending', async () => {
		const panel = new FakePanel();
		const reset = new FakeButton();
		const save = new FakeButton();
		installDocument(panel, reset, save);

		const capturedTabId = 101;
		const config = { ...DEFAULT_AUDIO_CONFIG, speed: 2, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] };
		let releaseFlush: (() => void) | null = null;
		registerCard(capturedTabId, () => undefined, () => config, () => new Promise<void>((resolve) => {
			releaseFlush = resolve;
		}));
		setCurrentPanelTabId(capturedTabId);
		bindFooterActions();

		reset.onclick?.();
		await waitFor(() => releaseFlush !== null);
		setCurrentPanelTabId(202);
		releaseFlush?.();
		await settleMicrotasks();

		expect(panel.speedInput.value).toBe('9.99');
	});

	test('projects a reset result when the captured tab remains selected', async () => {
		const panel = new FakePanel();
		const reset = new FakeButton();
		const save = new FakeButton();
		installDocument(panel, reset, save);

		const capturedTabId = 303;
		const config = { ...DEFAULT_AUDIO_CONFIG, speed: 2, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] };
		let releaseFlush: (() => void) | null = null;
		registerCard(capturedTabId, () => undefined, () => config, () => new Promise<void>((resolve) => {
			releaseFlush = resolve;
		}));
		setCurrentPanelTabId(capturedTabId);
		bindFooterActions();

		reset.onclick?.();
		await waitFor(() => releaseFlush !== null);
		releaseFlush?.();
		await settleMicrotasks();

		expect(panel.speedInput.value).toBe('2.00');
	});

	test('does not project an old reset after closing and reopening the same tab', async () => {
		const panel = new FakePanel();
		const reset = new FakeButton();
		const save = new FakeButton();
		installDocument(panel, reset, save);

		const tabId = 404;
		const config = { ...DEFAULT_AUDIO_CONFIG, speed: 2, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] };
		let releaseFlush: (() => void) | null = null;
		registerCard(tabId, () => undefined, () => config, () => new Promise<void>((resolve) => {
			releaseFlush = resolve;
		}));
		setCurrentPanelTabId(tabId);
		bindFooterActions();

		reset.onclick?.();
		await waitFor(() => releaseFlush !== null);
		setCurrentPanelTabId(null);
		setCurrentPanelTabId(tabId);
		releaseFlush?.();
		await settleMicrotasks();

		expect(panel.speedInput.value).toBe('9.99');
	});
});

function installDocument(panel: FakePanel, reset: FakeButton, save: FakeButton): void {
	Object.defineProperty(globalThis, 'document', {
		configurable: true,
		value: {
			activeElement: null,
			querySelector: (selector: string) => {
				if (selector === '.sp-btn-reset') return reset;
				if (selector === '.sp-btn-save') return save;
				return null;
			},
			querySelectorAll: () => [],
			getElementById: (id: string) => id === 'side-panel' ? panel : null,
		},
	});
}

async function waitFor(condition: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (condition()) return;
		await Promise.resolve();
	}
	throw new Error('Condition was not reached after flushing microtasks');
}

async function settleMicrotasks(): Promise<void> {
	for (let attempt = 0; attempt < 5; attempt += 1) await Promise.resolve();
}

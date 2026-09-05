import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { showPopupStartupError } from '../src/popup/startup-error';

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

class FakeElement {
	id = '';
	className = '';
	textContent = '';
	type = '';
	disabled = false;
	onclick: (() => void) | null = null;
	readonly children: FakeElement[] = [];
	readonly attributes = new Map<string, string>();
	parent: FakeElement | null = null;

	setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
	removeAttribute(name: string): void { this.attributes.delete(name); }
	append(...children: FakeElement[]): void {
		for (const child of children) {
			child.parent = this;
			this.children.push(child);
		}
	}
	appendChild(child: FakeElement): FakeElement { this.append(child); return child; }
	remove(): void {
		if (!this.parent) return;
		const index = this.parent.children.indexOf(this);
		if (index >= 0) this.parent.children.splice(index, 1);
		this.parent = null;
	}
}

function findById(root: FakeElement, id: string): FakeElement | null {
	if (root.id === id) return root;
	for (const child of root.children) {
		const found = findById(child, id);
		if (found) return found;
	}
	return null;
}

afterEach(() => {
	if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
	else Reflect.deleteProperty(globalThis, 'chrome');
	if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
	else Reflect.deleteProperty(globalThis, 'document');
});

describe('Popup startup failure surface', () => {
	test('renders one localized alert and exposes a retry action', async () => {
		const body = new FakeElement();
		Object.defineProperty(globalThis, 'document', {
			configurable: true,
			value: {
				body,
				createElement: () => new FakeElement(),
				getElementById: (id: string) => findById(body, id),
			},
		});
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: {
				i18n: { getMessage: (key: string) => key === 'popupRetry' ? 'Retry localized' : 'Unavailable localized.' },
			},
		});
		let retries = 0;
		showPopupStartupError(new Error('worker booting'), async () => { retries += 1; });

		const surface = findById(body, 'popup-startup-status');
		expect(surface?.attributes.get('role')).toBe('alert');
		expect(surface?.children[0]?.textContent).toContain('Unavailable localized.');
		expect(surface?.children[0]?.textContent).toContain('worker booting');
		expect(surface?.children[1]?.textContent).toBe('Retry localized');

		surface?.children[1]?.onclick?.();
		await Promise.resolve();
		expect(retries).toBe(1);
		expect(findById(body, 'popup-startup-status')).toBeNull();
	});

	test('makes settings initialization disposable and never rolls back to invocation-time state', () => {
		const source = readFileSync(new URL('../src/popup/views/settings.ts', import.meta.url), 'utf8');
		expect(source).toContain('if (disposed || next.revision <= state.revision) return;');
		expect(source).toContain('if (disposed) return;');
		expect(source).toContain('unsubscribeSettings();');
		expect(source).toContain('state.dispose();\n    throw error;');
		expect(source).toContain('await getSettingsSnapshot(true)');
		expect(source).not.toContain('state.gSettings = previous');
	});

	test('supervises every async startup failure and retries through a fresh document', () => {
		const entry = readFileSync(new URL('../src/popup/index.ts', import.meta.url), 'utf8');
		const card = readFileSync(new URL('../src/popup/card/init.ts', import.meta.url), 'utf8');
		const sidePanel = readFileSync(new URL('../src/popup/side-panel/index.ts', import.meta.url), 'utf8');
		expect(entry).toContain("void main().catch((error: unknown) => {");
		expect(entry).toContain('showPopupStartupError(error, reloadPopup);');
		expect(entry).toContain('window.location.reload();');
		expect(entry).not.toContain('showPopupStartupError(error, main)');
		expect(entry).not.toContain("document.addEventListener('DOMContentLoaded', main)");
		expect(entry).toContain('registerPopupAttemptDisposer(initSidePanel());');
		expect(entry).toContain('loadVisualizer: loadPopupVisualizer,');
		expect(entry).toContain("import('./visualizer/loop')");
		expect(entry).not.toContain('await loadPopupVisualizer();');
		expect(card).not.toContain("await import('../visualizer/loop')");
		expect(card).not.toContain('createEqCurveDrawer');
		expect(card).not.toContain('eq-curve-canvas');
		expect(card).not.toContain('eq-sliders-row');
		expect(card).toContain('if (!getVizEnabled() || disposed)');
		expect(card).toContain('cleanupStack.push(disposeVisualizer);');
		expect(card).toContain('registerCleanup?.(disposeCard);');
		expect(sidePanel).toContain('export function initSidePanel(): () => void');
		expect(sidePanel).toContain('return disposeSidePanel;');
		expect(sidePanel).toContain('export function disposeSidePanel(): void');
		expect(sidePanel).toContain('lifecycleController?.abort();');
		expect(sidePanel).toContain('unsubscribePanelSnapshots?.();');
		expect(sidePanel).toContain('disposeVideoControls();');
		expect(sidePanel).toContain('disposeSidePanelControls();');
		expect(sidePanel).toContain('unbindFooterActions();');
	});

	test('keeps the card visualizer loader free of the retired card EQ drawer', () => {
		const cardTypes = readFileSync(new URL('../src/popup/card/types.ts', import.meta.url), 'utf8');
		const cardElements = readFileSync(new URL('../src/popup/card/ui-elements.ts', import.meta.url), 'utf8');
		const cardEvents = readFileSync(new URL('../src/popup/card/events.ts', import.meta.url), 'utf8');
		const cardRender = readFileSync(new URL('../src/popup/card/render.ts', import.meta.url), 'utf8');
		const visualizer = readFileSync(new URL('../src/popup/visualizer/loop.ts', import.meta.url), 'utf8');

		expect(cardTypes).not.toContain('EqCurveDrawerFactory');
		expect(cardTypes).not.toContain('createEqCurveDrawer');
		expect(cardElements).not.toContain(".eq-trigger");
		expect(cardElements).not.toContain(".eq-drawer");
		expect(cardEvents).not.toContain('onMetricsUpdate');
		expect(cardEvents).not.toContain('EQ_DRAWER_DELAY');
		expect(cardRender).not.toContain('drawEqCurve');
		expect(visualizer).not.toContain('draw-eq-curve');
		expect(visualizer).not.toContain('metrics-cache');
	});
});

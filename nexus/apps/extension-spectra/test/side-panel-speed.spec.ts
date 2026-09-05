import { afterEach, describe, expect, test } from 'bun:test';
import { setCurrentPanelTabId } from '../src/popup/side-panel/panel-session';
import { syncSidePanelSpeed } from '../src/popup/side-panel/speed-controls';
import { parseFiniteControlInput } from '../src/popup/utils/control-input';

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

class FakeInput {
	constructor(public value: string) {}
}

class FakePanel {
	readonly slider = new FakeInput('1');
	readonly input = new FakeInput('1.00');

	querySelector(selector: string): FakeInput | null {
		if (selector === '.sp-speed-slider') return this.slider;
		if (selector === '.sp-speed-input') return this.input;
		return null;
	}
}

afterEach(() => {
	setCurrentPanelTabId(null);
	if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
	else Reflect.deleteProperty(globalThis, 'document');
});

describe('SidePanel speed identity projection', () => {
	test('preserves zero for canonical clamping and falls back only for empty text', () => {
		expect(parseFiniteControlInput('0', 1)).toBe(0);
		expect(parseFiniteControlInput('', 1)).toBe(1);
	});

	test('ignores another tab and never overwrites a focused editor', () => {
		const panel = new FakePanel();
		const fakeDocument = {
			activeElement: null as FakeInput | null,
			getElementById: (id: string) => id === 'side-panel' ? panel : null,
		};
		Object.defineProperty(globalThis, 'document', {
			configurable: true,
			value: fakeDocument,
		});

		setCurrentPanelTabId(7);
		syncSidePanelSpeed(8, 2);
		expect(panel.slider.value).toBe('1');
		expect(panel.input.value).toBe('1.00');

		syncSidePanelSpeed(7, 1.25);
		expect(panel.slider.value).toBe('1.25');
		expect(panel.input.value).toBe('1.25');

		fakeDocument.activeElement = panel.input;
		syncSidePanelSpeed(7, 0);
		expect(panel.slider.value).toBe('0.1');
		expect(panel.input.value).toBe('1.25');
	});
});

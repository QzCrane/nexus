import { afterEach, describe, expect, test } from 'bun:test';
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
});

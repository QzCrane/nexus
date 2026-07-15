import { describe, expect, test } from 'bun:test';
import { DEFAULT_AUDIO_CONFIG } from '@nexus/contracts';
import { consumeStub, createSnapshot, mountStub } from '../src/content/core/sentinel';
import type { PolicyExecutorState } from '../src/content/types';

describe('authenticated content runtime handoff', () => {
	test('restores the complete generation state and rejects a page-forged DOM stub', () => {
		const environment = installDom();
		try {
			const state: PolicyExecutorState = {
				config: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues], volume: 180 },
				appliedConfig: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues], volume: 180 },
				activeMode: 'NATIVE_WEBAUDIO',
				desiredMode: 'NATIVE_WEBAUDIO',
				actualMode: 'webaudio',
				phase: 'active',
				generation: 27,
				hasGesture: true,
				userHasInteracted: true,
				isPopupOpen: false,
			};

			mountStub(createSnapshot(state));
				expect(consumeStub()).toMatchObject({
				config: expect.objectContaining({ volume: 180 }),
				appliedConfig: expect.objectContaining({ volume: 180 }),
				desiredMode: 'NATIVE_WEBAUDIO',
				actualMode: 'webaudio',
				phase: 'active',
				generation: 27,
				hasGesture: true,
				userHasInteracted: true,
			});

			const forged = environment.document.createElement('div');
			forged.id = '__SPECTRA_STATE_STUB__';
			forged.setAttribute('data-token', 'page-controlled');
			forged.setAttribute('data-state', createSnapshot({ ...state, generation: 999 }));
			environment.document.documentElement.appendChild(forged);
			expect(consumeStub()).toBeNull();
		} finally {
			environment.restore();
		}
	});

	test('rejects tampering and invalid state even with a fresh handoff marker', () => {
		const environment = installDom();
		try {
			const state: PolicyExecutorState = {
				config: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
				appliedConfig: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
				activeMode: 'DISABLED',
				desiredMode: 'DISABLED',
				actualMode: 'bypass',
				phase: 'idle',
				generation: 4,
				hasGesture: false,
				userHasInteracted: false,
				isPopupOpen: false,
			};
			mountStub(createSnapshot(state));
			environment.document.getElementById('__SPECTRA_STATE_STUB__')
				?.setAttribute('data-state', '{"generation":999}');
			expect(consumeStub()).toBeNull();
		} finally {
			environment.restore();
		}
	});

	test('rejects the legacy HEAD DOM-only sentinel and leaves recovery to background identity', () => {
		const environment = installDom();
		try {
			const legacy = environment.document.createElement('div');
			legacy.id = '__SPECTRA_STATE_STUB__';
			legacy.setAttribute('data-state', JSON.stringify({
				version: '1.3.4',
				config: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues], volume: 180 },
				userHasInteracted: true,
				hasGesture: true,
				timestamp: Date.now(),
			}));
			environment.document.documentElement.appendChild(legacy);

			expect(consumeStub()).toBeNull();
			expect(environment.document.getElementById('__SPECTRA_STATE_STUB__')).toBeNull();
		} finally {
			environment.restore();
		}
	});
});

class FakeElement {
	id = '';
	readonly style: Record<string, string> = {};
	private readonly attributes = new Map<string, string>();
	private owner: FakeDocument | null = null;

	setOwner(owner: FakeDocument): void { this.owner = owner; }
	setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
	getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
	remove(): void { this.owner?.remove(this); }
}

class FakeDocument {
	private readonly elements = new Set<FakeElement>();
	readonly documentElement = {
		appendChild: (element: FakeElement) => {
			element.setOwner(this);
			this.elements.add(element);
			return element;
		},
	};
	createElement(): FakeElement { return new FakeElement(); }
	getElementById(id: string): FakeElement | null {
		return [...this.elements].find((element) => element.id === id) ?? null;
	}
	remove(element: FakeElement): void { this.elements.delete(element); }
}

function installDom(): { document: FakeDocument; restore(): void } {
	const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
	const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
	const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
	const document = new FakeDocument();
	Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
	Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
	Object.defineProperty(globalThis, 'chrome', {
		configurable: true,
		value: { runtime: { getManifest: () => ({ version: '2.0.0' }) } },
	});
	return {
		document,
		restore() {
			restore('window', windowDescriptor);
			restore('document', documentDescriptor);
			restore('chrome', chromeDescriptor);
		},
	};
}

function restore(key: 'window' | 'document' | 'chrome', descriptor?: PropertyDescriptor): void {
	if (descriptor) Object.defineProperty(globalThis, key, descriptor);
	else Reflect.deleteProperty(globalThis, key);
}

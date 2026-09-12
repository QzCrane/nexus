import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	createSidepanelActivationEnvelope,
	isFreshSidepanelActivation,
	parseSidepanelActivationAck,
	parseSidepanelActivationDelivery,
	parseSidepanelActivationEnvelope,
} from '../src/kernel/core/sidepanel-activation';
import {
	acknowledgeSidepanelActivation,
	getSidepanelActivationSnapshot,
	persistQrcodeActivation,
	publishSidepanelActivation,
	QRCODE_ACTIVATION_GENERATION_STORAGE_KEY,
	QRCODE_ACTIVATION_ID_STORAGE_KEY,
	QRCODE_MODE_STORAGE_KEY,
	QRCODE_TEXT_STORAGE_KEY,
} from '../src/kernel/core/sidepanel-activation-store';
import { ledgerRevisionKey } from '../src/kernel/core/safe-storage';

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');

afterEach(() => {
	if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
	else Reflect.deleteProperty(globalThis, 'chrome');
});

describe('durable SidePanel activation', () => {
	test('validates bounded envelopes and exact acknowledgements', () => {
		const envelope = createSidepanelActivationEnvelope(
			'activation_0000000001',
			{ type: 'HALO_ACTIVATE_TOOL', toolId: 'qrcode', payload: { text: 'B' } },
			1_000,
		);
		expect(parseSidepanelActivationEnvelope(envelope)).toEqual(envelope);
		expect(parseSidepanelActivationDelivery({
			type: 'HALO_SIDEPANEL_ACTIVATION_DELIVER',
			envelope,
		})).toEqual(envelope);
		expect(parseSidepanelActivationAck({
			type: 'HALO_SIDEPANEL_ACTIVATION_ACK',
			id: envelope.id,
		})).toEqual({ type: 'HALO_SIDEPANEL_ACTIVATION_ACK', id: envelope.id });
		expect(isFreshSidepanelActivation(envelope, 1_001)).toBe(true);
		expect(isFreshSidepanelActivation(envelope, 1_000 + 5 * 60_000 + 1)).toBe(false);
	});

	test('publishes a new payload while the same tool instance remains mounted', () => {
		const first = createSidepanelActivationEnvelope(
			'activation_0000000002',
			{ type: 'HALO_ACTIVATE_TOOL', toolId: 'qrcode', payload: { text: 'A' } },
			1_000,
			1,
		);
		const second = createSidepanelActivationEnvelope(
			'activation_0000000003',
			{ type: 'HALO_ACTIVATE_TOOL', toolId: 'qrcode', payload: { text: 'B' } },
			1_001,
			2,
		);
		expect(publishSidepanelActivation(first)).toBe(true);
		expect(getSidepanelActivationSnapshot()?.activation).toEqual(first.activation);
		expect(publishSidepanelActivation(second)).toBe(true);
		expect(getSidepanelActivationSnapshot()?.activation).toEqual(second.activation);
		expect(publishSidepanelActivation(second)).toBe(false);
		expect(publishSidepanelActivation(first)).toBe(false);
		expect(getSidepanelActivationSnapshot()?.activation).toEqual(second.activation);
	});

	test('does not accept an acknowledgement that did not clear the durable owner', async () => {
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: { runtime: { sendMessage: async () => ({ ok: true, cleared: false }) } },
		});
		expect(await acknowledgeSidepanelActivation('activation_0000000003')).toBe(false);
		expect(getSidepanelActivationSnapshot()?.id).toBe('activation_0000000003');
	});

	test('persists the exact QR value before acknowledgement eligibility', async () => {
		const durable: Record<string, unknown> = {};
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: { storage: { local: {
				set: async (value: Record<string, unknown>) => { Object.assign(durable, value); },
				get: async () => ({ ...durable }),
			} } },
		});
		const envelope = createSidepanelActivationEnvelope(
			'activation_0000000004',
			{ type: 'HALO_ACTIVATE_TOOL', toolId: 'qrcode', payload: { text: 'durable' } },
			1_002,
			3,
		);
		expect(await persistQrcodeActivation(envelope)).toBe(true);
		expect(durable).toEqual({
			[QRCODE_MODE_STORAGE_KEY]: 'generate',
			[ledgerRevisionKey(QRCODE_MODE_STORAGE_KEY)]: 1,
			[QRCODE_TEXT_STORAGE_KEY]: 'durable',
			[ledgerRevisionKey(QRCODE_TEXT_STORAGE_KEY)]: 1,
			[QRCODE_ACTIVATION_ID_STORAGE_KEY]: envelope.id,
			[ledgerRevisionKey(QRCODE_ACTIVATION_ID_STORAGE_KEY)]: 1,
			[QRCODE_ACTIVATION_GENERATION_STORAGE_KEY]: envelope.generation,
			[ledgerRevisionKey(QRCODE_ACTIVATION_GENERATION_STORAGE_KEY)]: 1,
		});
	});

	test('serializes rapid QR commits and never lets an older payload settle last', async () => {
		let releaseFirstWrite: (() => void) | undefined;
		const firstWrite = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
		let markFirstWriteStarted: (() => void) | undefined;
		const firstWriteStarted = new Promise<void>((resolve) => { markFirstWriteStarted = resolve; });
		const durable: Record<string, unknown> = {};
		const writes: string[] = [];
		Object.defineProperty(globalThis, 'chrome', {
			configurable: true,
			value: { storage: { local: {
				set: async (value: Record<string, unknown>) => {
					if (value[QRCODE_TEXT_STORAGE_KEY] !== undefined) {
						writes.push(String(value[QRCODE_TEXT_STORAGE_KEY]));
						if (writes.length === 1) { markFirstWriteStarted?.(); await firstWrite; }
					}
					Object.assign(durable, value);
				},
				get: async () => ({ ...durable }),
			} } },
		});
		const first = createSidepanelActivationEnvelope(
			'activation_0000000005',
			{ type: 'HALO_ACTIVATE_TOOL', toolId: 'qrcode', payload: { text: 'old' } },
			1_003,
			4,
		);
		const second = createSidepanelActivationEnvelope(
			'activation_0000000006',
			{ type: 'HALO_ACTIVATE_TOOL', toolId: 'qrcode', payload: { text: 'new' } },
			1_004,
			5,
		);
		const firstCommit = persistQrcodeActivation(first);
		await firstWriteStarted;
		const secondCommit = persistQrcodeActivation(second);
		expect(writes).toEqual(['old']);
		releaseFirstWrite?.();
		expect(await firstCommit).toBe(false);
		expect(await secondCommit).toBe(true);
		expect(writes).toEqual(['old', 'new']);
		expect(durable[QRCODE_TEXT_STORAGE_KEY]).toBe('new');
		expect(durable[QRCODE_ACTIVATION_GENERATION_STORAGE_KEY]).toBe(5);
	});

	test('persists before delivery and mounted QR subscribes instead of mount-only sessionStorage', () => {
		const background = readFileSync(new URL('../src/entry/background.ts', import.meta.url), 'utf8');
		const contract = readFileSync(new URL('../src/kernel/core/sidepanel-activation.ts', import.meta.url), 'utf8');
		const sidepanel = readFileSync(new URL('../src/components/sidepanel/use-sidepanel-state.ts', import.meta.url), 'utf8');
		const qrcode = readFileSync(new URL('../src/tools/qrcode/panel.tsx', import.meta.url), 'utf8');
		expect(background).toContain('scheduleStorageSet({ [SIDEPANEL_ACTIVATION_STORAGE_KEY]: envelope }');
		expect(background).toContain('parseSidepanelActivationAck');
		expect(contract).toContain('HALO_SIDEPANEL_ACTIVATION_ACK');
		expect(sidepanel).toContain('chrome.storage.session.get');
		expect(sidepanel).toContain('publishSidepanelActivation');
		expect(qrcode).toContain('useSyncExternalStore');
		expect(qrcode).toContain('acknowledgeSidepanelActivation');
		expect(qrcode).toContain('persistQrcodeActivation');
		expect(qrcode.indexOf('persistQrcodeActivation')).toBeLessThan(qrcode.lastIndexOf('acknowledgeSidepanelActivation'));
		expect(qrcode).not.toContain('sessionStorage');
	});
});

// goal: one SidePanel-realm activation projection for mounted and lazy tools
// inv: pending background state clears only after the exact activation ID ACKs

import type { SidepanelActivationEnvelope } from './sidepanel-activation';
import { conditionalLedgerWrite, readLedgerEntry } from './safe-storage';
export const QRCODE_MODE_STORAGE_KEY = 'halo_tool_state_qrcode-mode';
export const QRCODE_TEXT_STORAGE_KEY = 'halo_tool_state_qrcode';
export const QRCODE_ACTIVATION_ID_STORAGE_KEY = 'halo_tool_state_qrcode-activation-id';
export const QRCODE_ACTIVATION_GENERATION_STORAGE_KEY = 'halo_tool_state_qrcode-activation-generation';

let snapshot: SidepanelActivationEnvelope | null = null;
const listeners = new Set<() => void>();
let latestQrcodeActivation: SidepanelActivationEnvelope | null = null;
let qrcodeCommitTail = Promise.resolve();

async function commitQrcodeField(key: string, value: unknown): Promise<boolean> {
	const base = await readLedgerEntry(key, { area: 'local' });
	const outcome = await conditionalLedgerWrite(key, {
		area: 'local', baseRevision: base.revision, value, remerge: () => value,
	});
	return outcome.kind === 'committed';
}

function admitQrcodeActivation(envelope: SidepanelActivationEnvelope): boolean {
	if (envelope.activation.toolId !== 'qrcode') return false;
	if (latestQrcodeActivation
		&& (envelope.generation < latestQrcodeActivation.generation
			|| envelope.generation === latestQrcodeActivation.generation
			&& envelope.id !== latestQrcodeActivation.id)) return false;
	if (!latestQrcodeActivation || envelope.generation > latestQrcodeActivation.generation) {
		latestQrcodeActivation = envelope;
	}
	return latestQrcodeActivation.id === envelope.id;
}

export function getSidepanelActivationSnapshot(): SidepanelActivationEnvelope | null {
	return snapshot;
}

export function subscribeSidepanelActivation(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function publishSidepanelActivation(envelope: SidepanelActivationEnvelope): boolean {
	if (snapshot && (snapshot.id === envelope.id || envelope.generation <= snapshot.generation)) return false;
	snapshot = envelope;
	admitQrcodeActivation(envelope);
	for (const listener of [...listeners]) listener();
	return true;
}

function clearSidepanelActivation(id: string): void {
	if (snapshot?.id !== id) return;
	snapshot = null;
	for (const listener of [...listeners]) listener();
}

export async function acknowledgeSidepanelActivation(id: string): Promise<boolean> {
	try {
		const response: unknown = await chrome.runtime.sendMessage({
			type: 'HALO_SIDEPANEL_ACTIVATION_ACK',
			id,
		});
		if (typeof response !== 'object' || response === null
			|| (response as Record<string, unknown>).ok !== true
			|| (response as Record<string, unknown>).cleared !== true) return false;
		clearSidepanelActivation(id);
		return true;
	} catch {
		// The durable storage.session envelope remains available after a worker or
		// SidePanel restart. Never clear the local projection without Background ACK.
		return false;
	}
}

/** Persist the QR payload before Background is allowed to retire its envelope. */
export async function persistQrcodeActivation(
	envelope: SidepanelActivationEnvelope,
): Promise<boolean> {
	if (!admitQrcodeActivation(envelope)) return false;
	const commit = qrcodeCommitTail.then(async () => {
		if (latestQrcodeActivation?.id !== envelope.id) return false;
		if (typeof chrome === 'undefined' || !chrome.storage?.local) return false;
		const durableState = {
			[QRCODE_MODE_STORAGE_KEY]: 'generate',
			[QRCODE_TEXT_STORAGE_KEY]: envelope.activation.toolId === 'qrcode'
				? envelope.activation.payload.text
				: '',
			[QRCODE_ACTIVATION_ID_STORAGE_KEY]: envelope.id,
			[QRCODE_ACTIVATION_GENERATION_STORAGE_KEY]: envelope.generation,
		};
		try {
			// The domain tail serializes activations; each field also participates in
			// the canonical ledger used by its useToolState consumer.
			for (const [key, value] of Object.entries(durableState)) {
				if (!await commitQrcodeField(key, value)) return false;
			}
			if (latestQrcodeActivation?.id !== envelope.id) return false;
			const readback = Object.fromEntries(await Promise.all(Object.keys(durableState).map(async (key) => [key, (await readLedgerEntry(key, { area: 'local' })).value])));
			return latestQrcodeActivation?.id === envelope.id
				&& Object.entries(durableState).every(([key, value]) => readback[key] === value);
		} catch {
			return false;
		}
	});
	qrcodeCommitTail = commit.then(() => undefined, () => undefined);
	return commit;
}

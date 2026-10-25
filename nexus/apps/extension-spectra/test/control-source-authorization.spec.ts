import { describe, expect, test } from 'bun:test';
import type { MediaTarget } from '@nexus/contracts';
import {
	authorizeRuntimeControl,
	type RuntimeControlClaim,
} from '../src/background/control-source-authorization';

const TARGET: MediaTarget = {
	frameId: 0,
	documentId: 'document-7',
	mediaId: 'media-1',
	sourceRevision: 3,
	kind: 'audio',
};

function sender(overrides: Partial<chrome.runtime.MessageSender> = {}): chrome.runtime.MessageSender {
	return {
		id: 'spectra-test',
		tab: { id: 7 } as chrome.tabs.Tab,
		frameId: 0,
		documentId: 'document-7',
		url: 'https://media.example/page',
		...overrides,
	};
}

function claim(overrides: Partial<RuntimeControlClaim> = {}): RuntimeControlClaim {
	return {
		sender: sender(),
		tabId: 7,
		source: 'page',
		target: TARGET,
		popupSender: false,
		hotkeySender: false,
		...overrides,
	};
}

describe('runtime control source authorization', () => {
	test('refuses background-only sources claimed by runtime RPC', () => {
		for (const source of ['remote', 'system'] as const) {
			expect(authorizeRuntimeControl(claim({ source }))).toEqual({
				code: 'forbidden',
				message: 'Background-only control sources cannot be asserted by runtime RPC',
			});
		}
	});

	test('admits restore only from its exact top-level document and target', () => {
		expect(authorizeRuntimeControl(claim({ source: 'restore' }))).toBeNull();
		for (const disputed of [
			claim({ source: 'restore', target: null }),
			claim({ source: 'restore', sender: sender({ frameId: 1 }) }),
			claim({ source: 'restore', target: { ...TARGET, documentId: 'document-other' } }),
			claim({ source: 'restore', sender: sender({ tab: { id: 8 } as chrome.tabs.Tab }) }),
			claim({ source: 'restore', sender: sender({ frameId: undefined }) }),
		]) {
			expect(authorizeRuntimeControl(disputed)).toEqual({
				code: 'forbidden',
				message: 'Restore control must match its exact top-level document sender',
			});
		}
	});

	test('admits page control from its top-level document with a matching or absent target', () => {
		expect(authorizeRuntimeControl(claim({ source: 'page', target: null }))).toBeNull();
		expect(authorizeRuntimeControl(claim({ source: 'page' }))).toBeNull();
		for (const disputed of [
			claim({ source: 'page', sender: sender({ frameId: 2 }) }),
			claim({ source: 'page', sender: sender({ tab: undefined }) }),
			claim({ source: 'page', target: { ...TARGET, documentId: 'document-other' } }),
		]) {
			expect(authorizeRuntimeControl(disputed)).toEqual({
				code: 'forbidden',
				message: 'Page observation identity does not match its top-level sender',
			});
		}
	});

	test('admits extension-invoked sources only with their resolved evidence', () => {
		expect(authorizeRuntimeControl(claim({ source: 'popup', target: null }))).toEqual({
			code: 'forbidden',
			message: 'Extension-invoked control requires a trusted Popup or top-level hotkey document',
		});
		expect(authorizeRuntimeControl(claim({ source: 'popup', target: null, popupSender: true }))).toBeNull();
		expect(authorizeRuntimeControl(claim({ source: 'hotkey' }))).toEqual({
			code: 'forbidden',
			message: 'Extension-invoked control requires a trusted Popup or top-level hotkey document',
		});
		expect(authorizeRuntimeControl(claim({ source: 'hotkey', hotkeySender: true }))).toBeNull();
	});
});

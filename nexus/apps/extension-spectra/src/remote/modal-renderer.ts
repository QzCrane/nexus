/** Secure remote pairing modal. Dynamic values are assigned through DOM APIs. */

import { isSpectraUiEventEnvelope } from '@nexus/contracts/ui-runtime';
import type { I18NDict } from '../popup/types';
import { getRemoteUrl } from './constants.js';
import type { RemotePairing } from './protocol';
import { sendSpectraRequest } from '../shared/ui-spectra-client';
import { handleDialogKeydown } from '../popup/utils/dialog';

let isModalOpen = false;
let currentDict: I18NDict | null = null;
let activePairing: RemotePairing | null = null;
let activeTabId: number | null = null;
let statusMessageListener: ((message: unknown) => false) | null = null;
let previouslyFocused: HTMLElement | null = null;

export const isRemoteModalOpen = () => isModalOpen;

export function setRemoteI18n(dict: I18NDict): void {
	currentDict = dict;
}

function t(key: keyof I18NDict, fallback: string): string {
	return (currentDict?.[key] as string) || fallback;
}

export function renderRemoteModal(
	qrDataUrl: string,
	pairing: RemotePairing,
	tabId: number,
	isConnected = false,
): void {
	if (!isSafeRemoteQrDataUrl(qrDataUrl)) throw new Error('Invalid remote QR image URL');
	void closeRemoteModal();
	activePairing = pairing;
	activeTabId = tabId;
	previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

	const modal = element('div', 'remote-modal');
	modal.id = 'remote-modal';
	modal.setAttribute('role', 'dialog');
	modal.setAttribute('aria-modal', 'true');
	modal.setAttribute('aria-labelledby', 'remote-modal-title');
	modal.tabIndex = -1;

	const content = element('div', 'remote-modal-content');
	const header = element('div', 'remote-modal-header');
	const title = element('span');
	title.id = 'remote-modal-title';
	title.textContent = t('remoteModalTitle', '📱 Remote Control');
	const closeButton = element('button', 'remote-modal-close');
	closeButton.type = 'button';
	closeButton.textContent = '✕';
	closeButton.setAttribute('aria-label', t('btnClose', 'Close'));
	header.append(title, closeButton);

	const body = element('div', 'remote-modal-body');
	const qr = element('img', 'remote-qr');
	qr.src = qrDataUrl;
	qr.alt = t('remoteModalTitle', 'Remote Control');

	const sessionRow = element('div', 'remote-session-id');
	const sessionLabel = element('span');
	sessionLabel.textContent = t('remoteSessionCode', 'Secure pairing');
	const sessionCode = element('code');
	sessionCode.textContent = `${pairing.sessionId.slice(0, 8)}…`;
	sessionCode.title = t('remoteSessionCode', 'Session Code');
	sessionCode.tabIndex = 0;
	sessionCode.setAttribute('role', 'button');
	sessionRow.append(sessionLabel, sessionCode);

	const linkRow = element('div', 'remote-url');
	const remoteUrl = getRemoteUrl(pairing);
	const link = element('a');
	link.href = remoteUrl;
	link.target = '_blank';
	link.rel = 'noopener noreferrer';
	link.title = t('remoteOpenLinkTitle', 'Open secure remote in a new tab');
	link.textContent = t('remoteOpenLinkTitle', 'Open secure remote');
	linkRow.append(link);

	const status = element('div', 'remote-status');
	status.setAttribute('role', 'status');
	status.setAttribute('aria-live', 'polite');
	status.setAttribute('aria-atomic', 'true');
	const statusDot = element('span', `remote-status-dot${isConnected ? ' connected' : ''}`);
	statusDot.setAttribute('aria-hidden', 'true');
	const statusText = element('span', 'remote-status-text');
	statusText.textContent = isConnected
		? t('remoteConnected', '✅ Connected')
		: t('remoteWaiting', 'Waiting for authenticated connection…');
	status.append(statusDot, statusText);

	const hint = element('p', 'remote-hint');
	appendSafeHint(hint, t('remoteHint', 'Scan the QR code or copy the secure link. Closing this dialog will not disconnect.'));

	const disconnectButton = element('button', 'remote-disconnect-btn');
	disconnectButton.type = 'button';
	disconnectButton.textContent = t('remoteDisconnect', '🔌 Disconnect & Close');

	body.append(qr, sessionRow, linkRow, status, hint, disconnectButton);
	content.append(header, body);
	modal.append(content);
	document.body.append(modal);
	isModalOpen = true;

	const dismiss = () => {
		if (modal.getAttribute('aria-busy') !== 'true') void closeRemoteModal();
	};
	closeButton.addEventListener('click', dismiss);
	disconnectButton.addEventListener('click', () => { void closeRemoteModal(true); });
	modal.addEventListener('click', (event) => {
		if (event.target === modal) dismiss();
	});
	modal.addEventListener('keydown', (event) => {
		handleDialogKeydown(event, modal, dismiss);
	});
	const copyLink = () => void copyPairingLink(sessionCode, remoteUrl);
	sessionCode.addEventListener('click', copyLink);
	sessionCode.addEventListener('keydown', (event) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			copyLink();
		}
	});

	closeButton.focus();
	statusMessageListener = (message: unknown): false => {
		if (!isSpectraUiEventEnvelope(message)) return false;
		if (message.type === 'spectra.remote.session.changed'
			&& message.payload.tabId === tabId
			&& message.payload.sessionId === pairing.sessionId) {
			updateStatusNodes(modal, message.payload.connected);
		} else if (message.type === 'spectra.remote.session.closed'
			&& message.payload.tabId === tabId
			&& message.payload.sessionId === pairing.sessionId) {
			void closeRemoteModal();
		}
		return false;
	};
	chrome.runtime.onMessage.addListener(statusMessageListener);
}

async function copyPairingLink(code: HTMLElement, remoteUrl: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(remoteUrl);
		const oldText = code.textContent;
		code.textContent = t('remoteCopied', 'Copied!');
		window.setTimeout(() => {
			if (code.isConnected) code.textContent = oldText;
		}, 1000);
	} catch {
		// Clipboard permission may be unavailable; the visible link remains usable.
		code.focus();
		code.scrollIntoView({ block: 'nearest' });
	}
}

function appendSafeHint(target: HTMLElement, text: string): void {
	const lines = text.split(/<br\s*\/?\s*>|\n/iu);
	lines.forEach((line, index) => {
		if (index > 0) target.append(document.createElement('br'));
		target.append(document.createTextNode(line));
	});
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	return node;
}

export async function closeRemoteModal(closeConnection = false): Promise<void> {
	const modal = document.getElementById('remote-modal');
	if (closeConnection && activePairing && activeTabId !== null && modal) {
		if (modal.getAttribute('aria-busy') === 'true') return;
		const pairing = activePairing;
		const tabId = activeTabId;
		const button = modal.querySelector<HTMLButtonElement>('.remote-disconnect-btn');
		modal.setAttribute('aria-busy', 'true');
		if (button) button.disabled = true;
		try {
			const response = await sendSpectraRequest(
				'spectra.remote.session.close',
				{ tabId, sessionId: pairing.sessionId },
				{ tabId },
			);
			if (!response.ok) throw new Error(response.error.message);
		} catch {
			if (activePairing !== pairing || !modal.isConnected) return;
			modal.removeAttribute('aria-busy');
			if (button) button.disabled = false;
			const status = modal.querySelector<HTMLElement>('.remote-status-text');
			if (status) status.textContent = t('remoteDisconnectFailed', 'Could not disconnect. Please try again.');
			return;
		}
		// A close event or another dialog may have superseded this transaction.
		if (activePairing !== pairing || !modal.isConnected) return;
	}
	modal?.remove();
	isModalOpen = false;
	if (statusMessageListener) {
		chrome.runtime.onMessage.removeListener(statusMessageListener);
		statusMessageListener = null;
	}
	activePairing = null;
	activeTabId = null;
	previouslyFocused?.focus();
	previouslyFocused = null;
}

function updateStatusNodes(modal: HTMLElement, connected: boolean): void {
	const dot = modal.querySelector('.remote-status-dot');
	const text = modal.querySelector('.remote-status-text');
	if (!(dot instanceof HTMLElement) || !(text instanceof HTMLElement)) return;
	dot.classList.toggle('connected', connected);
	text.textContent = connected
		? t('remoteConnected', '✅ Connected')
		: t('remoteWaiting', 'Waiting for authenticated connection…');
}

function isPngDataUrl(value: string): boolean {
	return /^data:image\/png;base64,[A-Za-z0-9+/=]+$/u.test(value);
}

export function isSafeRemoteQrDataUrl(value: string): boolean {
	if (isPngDataUrl(value)) return true;
	const prefix = 'data:image/svg+xml;charset=utf-8,';
	if (!value.startsWith(prefix) || value.length > 1_000_000) return false;
	try {
		const svg = decodeURIComponent(value.slice(prefix.length));
		if (!/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+">/u.test(svg)
			|| !/<rect fill="#[0-9A-Fa-f]{6}" width="\d+" height="\d+"\/>/u.test(svg)
			|| !/<path fill="#[0-9A-Fa-f]{6}" d="[A-Za-z0-9,.\-\s]+"\/><\/svg>$/u.test(svg)) {
			return false;
		}
		return !/<(?:script|foreignObject|iframe|object|embed)\b|\bon\w+\s*=|\b(?:href|style)\s*=/iu.test(svg);
	} catch {
		return false;
	}
}

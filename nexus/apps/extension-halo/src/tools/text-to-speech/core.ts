// goal: Text-to-Speech core logic - Web Speech API

import type { TtsSettings } from './types';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';

export const ttsSettingsCodec: ToolStateCodec<TtsSettings> = {
	decode(value) {
		if (typeof value !== 'object' || value === null || Array.isArray(value)) return { kind: 'invalid', reason: 'Speech settings must be an object.' };
		const settings = value as Record<string, unknown>;
		if (typeof settings.rate !== 'number' || !Number.isFinite(settings.rate) || settings.rate < 0.1 || settings.rate > 10
			|| typeof settings.pitch !== 'number' || !Number.isFinite(settings.pitch) || settings.pitch < 0 || settings.pitch > 2
			|| typeof settings.volume !== 'number' || !Number.isFinite(settings.volume) || settings.volume < 0 || settings.volume > 1
			|| typeof settings.voiceUri !== 'string') return { kind: 'invalid', reason: 'Speech rate, pitch, volume, or voice is invalid.' };
		return { kind: 'valid', value: settings as unknown as TtsSettings };
	},
	encode(value) { return value; },
};

export interface SpeechLifecycleCallbacks {
	onStart?: () => void;
	onEnd?: () => void;
	onError?: (event: SpeechSynthesisErrorEvent) => void;
	onPause?: () => void;
	onResume?: () => void;
}

// Get available voices
export function getVoices(): SpeechSynthesisVoice[] {
	return speechSynthesis.getVoices();
}

// Speak text. Lifecycle callbacks are attached before queueing so the panel can
// stay event-driven instead of polling speechSynthesis every 200ms.
export function speak(
	text: string,
	settings: TtsSettings,
	callbacks: SpeechLifecycleCallbacks = {},
): SpeechSynthesisUtterance {
	stop();

	const utterance = new SpeechSynthesisUtterance(text);
	utterance.rate = settings.rate;
	utterance.pitch = settings.pitch;
	utterance.volume = settings.volume;

	const voices = getVoices();
	const voice = voices.find((candidate) => candidate.voiceURI === settings.voiceUri);
	if (voice) utterance.voice = voice;

	if (callbacks.onStart) utterance.addEventListener('start', callbacks.onStart);
	if (callbacks.onEnd) utterance.addEventListener('end', callbacks.onEnd);
	if (callbacks.onError) utterance.addEventListener('error', callbacks.onError);
	if (callbacks.onPause) utterance.addEventListener('pause', callbacks.onPause);
	if (callbacks.onResume) utterance.addEventListener('resume', callbacks.onResume);

	speechSynthesis.speak(utterance);
	return utterance;
}

// Stop speaking
export function stop(): void {
	speechSynthesis.cancel();
}

// Pause
export function pause(): void {
	speechSynthesis.pause();
}

// Resume
export function resume(): void {
	speechSynthesis.resume();
}

// Get selected text from page
export async function getSelectedText(): Promise<string> {
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (!tab?.id) return '';

		const [result] = await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			func: () => window.getSelection()?.toString() || '',
		});

		return result?.result || '';
	} catch {
		return '';
	}
}

// Default settings
export const DEFAULT_SETTINGS: TtsSettings = {
	rate: 1,
	pitch: 1,
	volume: 1,
	voiceUri: '',
};

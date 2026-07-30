// goal: Text-to-Speech core logic - Web Speech API

import type { TtsSettings } from './types';

// Get available voices
export function getVoices(): SpeechSynthesisVoice[] {
	return speechSynthesis.getVoices();
}

// Speak text
export function speak(text: string, settings: TtsSettings): void {
	stop();

	const utterance = new SpeechSynthesisUtterance(text);
	utterance.rate = settings.rate;
	utterance.pitch = settings.pitch;
	utterance.volume = settings.volume;

	const voices = getVoices();
	const voice = voices.find((v) => v.voiceURI === settings.voiceUri);
	if (voice) utterance.voice = voice;

	speechSynthesis.speak(utterance);
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

// Check if speaking
export function isSpeaking(): boolean {
	return speechSynthesis.speaking;
}

// Check if paused
export function isPaused(): boolean {
	return speechSynthesis.paused;
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

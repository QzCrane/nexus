// goal: Text-to-Speech panel UI - TTS with controls

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import type { TtsSettings } from './types';
import { getVoices, speak, stop, pause, resume, isSpeaking, isPaused, getSelectedText, DEFAULT_SETTINGS } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const TextToSpeechPanel: React.FC = () => {
	const { t } = useTranslation();
	const [text, setText] = useToolState<string>('text-to-speech' as any, '');
	const [settings, setSettings] = useToolState<TtsSettings>('text-to-speech-settings' as any, DEFAULT_SETTINGS);

	const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
	const [speaking, setSpeaking] = useState(false);
	const [paused, setPaused] = useState(false);

	// Load voices
	useEffect(() => {
		const loadVoices = () => {
			const v = getVoices();
			setVoices(v);
			if (v.length > 0 && !settings.voiceUri) {
				setSettings((s) => ({ ...s, voiceUri: v[0].voiceURI }));
			}
		};

		loadVoices();
		speechSynthesis.onvoiceschanged = loadVoices;
	}, []);

	// Load selected text
	const handleLoadSelected = useCallback(async () => {
		const selected = await getSelectedText();
		if (selected) setText(selected);
	}, []);

	// Speak
	const handleSpeak = useCallback(() => {
		if (!text.trim()) return;
		speak(text, settings);
		setSpeaking(true);
		setPaused(false);
	}, [text, settings]);

	// Pause/Resume
	const handlePauseResume = useCallback(() => {
		if (isPaused()) {
			resume();
			setPaused(false);
		} else {
			pause();
			setPaused(true);
		}
	}, []);

	// Stop
	const handleStop = useCallback(() => {
		stop();
		setSpeaking(false);
		setPaused(false);
	}, []);

	// Update status periodically
	useEffect(() => {
		const timer = setInterval(() => {
			setSpeaking(isSpeaking());
			setPaused(speechSynthesis.paused);
		}, 200);
		return () => clearInterval(timer);
	}, []);

	return (
		<div style={styles.wrapper}>
			{/* Text input */}
			<textarea
				style={styles.textarea}
				value={text}
				onChange={(e) => setText(e.target.value)}
				placeholder={t('tts.placeholder')}
			/>

			{/* Load selected */}
			<button style={styles.btnSecondary} onClick={handleLoadSelected}>
				📋 {t('tts.loadSelected')}
			</button>

			{/* Controls */}
			<div style={styles.controls}>
				{!speaking ? (
					<button style={styles.btn} onClick={handleSpeak}>▶️ {t('tts.play')}</button>
				) : (
					<>
						<button style={styles.btnSecondary} onClick={handlePauseResume}>
							{paused ? '▶️' : '⏸️'}
						</button>
						<button style={styles.btnSecondary} onClick={handleStop}>⏹️</button>
					</>
				)}
			</div>

			{/* Settings */}
			<div style={styles.settings}>
				{/* Voice */}
				<div style={styles.row}>
					<span style={styles.label}>{t('tts.voice')}</span>
					<select style={styles.select} value={settings.voiceUri} onChange={(e) => setSettings((s) => ({ ...s, voiceUri: e.target.value }))}>
						{voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
					</select>
				</div>

				{/* Rate */}
				<div style={styles.row}>
					<span style={styles.label}>{t('tts.rate')}</span>
					<input type="range" style={styles.slider} min="0.5" max="2" step="0.1" value={settings.rate} onChange={(e) => setSettings((s) => ({ ...s, rate: parseFloat(e.target.value) }))} />
					<span style={styles.value}>{settings.rate.toFixed(1)}x</span>
				</div>

				{/* Pitch */}
				<div style={styles.row}>
					<span style={styles.label}>{t('tts.pitch')}</span>
					<input type="range" style={styles.slider} min="0.5" max="2" step="0.1" value={settings.pitch} onChange={(e) => setSettings((s) => ({ ...s, pitch: parseFloat(e.target.value) }))} />
					<span style={styles.value}>{settings.pitch.toFixed(1)}</span>
				</div>
			</div>
		</div>
	);
};

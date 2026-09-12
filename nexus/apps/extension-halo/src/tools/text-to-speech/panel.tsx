// goal: Text-to-Speech panel UI - TTS with controls
// eff: speech lifecycle is event-driven; no periodic status polling

import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../i18n';
import type { TtsSettings } from './types';
import { getVoices, speak, stop, pause, resume, getSelectedText, DEFAULT_SETTINGS, ttsSettingsCodec } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';

export const TextToSpeechPanel: React.FC = () => {
	const { t } = useTranslation();
	const [text, setText] = useToolState<string>('text-to-speech', '');
	const [settings, setSettings, , settingsRecovery] = useToolState<TtsSettings>('text-to-speech-settings', DEFAULT_SETTINGS, { codec: ttsSettingsCodec });

	const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
	const [speaking, setSpeaking] = useState(false);
	const [paused, setPaused] = useState(false);
	const speechGenerationRef = useRef(0);

	// The panel owns the browser SpeechSynthesis lifecycle. Switching Home/tools
	// unmounts the current tool panel; any utterance must therefore be cancelled
	// at the same boundary instead of continuing without a Stop control. Voice
	// selection changes only rebind the voiceschanged listener below and do not
	// retire the active utterance generation.
	useEffect(() => {
		return () => {
			speechGenerationRef.current += 1;
			stop();
		};
	}, []);

	useEffect(() => {
		const loadVoices = () => {
			const available = getVoices();
			setVoices(available);
			const firstVoice = available[0];
			if (firstVoice && !settings.voiceUri) {
				setSettings((current) => ({ ...current, voiceUri: firstVoice.voiceURI }));
			}
		};

		loadVoices();
		speechSynthesis.addEventListener('voiceschanged', loadVoices);
		return () => {
			speechSynthesis.removeEventListener('voiceschanged', loadVoices);
		};
	}, [setSettings, settings.voiceUri]);

	const handleLoadSelected = useCallback(async () => {
		const selected = await getSelectedText();
		if (selected) setText(selected);
	}, [setText]);

	const handleSpeak = useCallback(() => {
		if (!text.trim()) return;
		const generation = ++speechGenerationRef.current;
		const isCurrent = () => speechGenerationRef.current === generation;

		speak(text, settings, {
			onStart: () => {
				if (!isCurrent()) return;
				setSpeaking(true);
				setPaused(false);
			},
			onPause: () => {
				if (isCurrent()) setPaused(true);
			},
			onResume: () => {
				if (isCurrent()) setPaused(false);
			},
			onEnd: () => {
				if (!isCurrent()) return;
				setSpeaking(false);
				setPaused(false);
			},
			onError: () => {
				if (!isCurrent()) return;
				setSpeaking(false);
				setPaused(false);
			},
		});

		// Queueing is synchronous even if the browser dispatches `start` later.
		setSpeaking(true);
		setPaused(false);
	}, [text, settings]);

	const handlePauseResume = useCallback(() => {
		if (paused) {
			resume();
			setPaused(false);
		} else {
			pause();
			setPaused(true);
		}
	}, [paused]);

	const handleStop = useCallback(() => {
		speechGenerationRef.current += 1;
		stop();
		setSpeaking(false);
		setPaused(false);
	}, []);

	return (
		<div style={styles.wrapper}>
			<StorageRecoveryActions recovery={settingsRecovery} emptyValue={DEFAULT_SETTINGS} exportName="halo-tts-settings-damaged.json" />
			<textarea
				style={styles.textarea}
				value={text}
				onChange={(e) => setText(e.target.value)}
				placeholder={t('tts.placeholder')}
			/>

			<button type="button" style={styles.btnSecondary} onClick={handleLoadSelected}>
				📋 {t('tts.loadSelected')}
			</button>

			<div style={styles.controls}>
				{!speaking ? (
					<button type="button" style={styles.btn} onClick={handleSpeak}>▶️ {t('tts.play')}</button>
				) : (
					<>
						<button type="button" style={styles.btnSecondary} onClick={handlePauseResume}>
							{paused ? '▶️' : '⏸️'}
						</button>
						<button type="button" style={styles.btnSecondary} onClick={handleStop}>⏹️</button>
					</>
				)}
			</div>

			<div style={styles.settings}>
				<div style={styles.row}>
					<span style={styles.label}>{t('tts.voice')}</span>
					<select style={styles.select} value={settings.voiceUri} onChange={(e) => setSettings((current) => ({ ...current, voiceUri: e.target.value }))}>
						{voices.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} ({voice.lang})</option>)}
					</select>
				</div>

				<div style={styles.row}>
					<span style={styles.label}>{t('tts.rate')}</span>
					<input type="range" style={styles.slider} min="0.5" max="2" step="0.1" value={settings.rate} onChange={(e) => setSettings((current) => ({ ...current, rate: parseFloat(e.target.value) }))} />
					<span style={styles.value}>{settings.rate.toFixed(1)}x</span>
				</div>

				<div style={styles.row}>
					<span style={styles.label}>{t('tts.pitch')}</span>
					<input type="range" style={styles.slider} min="0.5" max="2" step="0.1" value={settings.pitch} onChange={(e) => setSettings((current) => ({ ...current, pitch: parseFloat(e.target.value) }))} />
					<span style={styles.value}>{settings.pitch.toFixed(1)}</span>
				</div>
			</div>
		</div>
	);
};

// goal: Timer panel UI - countdown and stopwatch
// eff: persistent time authority is anchor-based; display ticks are isolated to the clock node

import type React from 'react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from '../../i18n';
import type { TimerMode, TimerState } from './types';
import { formatTime, PRESETS, INITIAL_TIMER_STATE, normalizeTimerState, timerElapsedAt, timerMinutesCodec, timerSecondsCodec, type TimerCommand } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import { sendDeadlineCommand } from '../../kernel/core/deadline-jobs/protocol';

const initialState = INITIAL_TIMER_STATE;

const TimerDisplay: React.FC<{ state: TimerState }> = memo(({ state }) => {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (!state.isRunning) {
			setNow(Date.now());
			return;
		}
		let frameId = 0;
		let disposed = false;
		const tick = () => {
			if (disposed) return;
			setNow(Date.now());
			frameId = requestAnimationFrame(tick);
		};
		frameId = requestAnimationFrame(tick);
		return () => {
			disposed = true;
			cancelAnimationFrame(frameId);
		};
	}, [state.isRunning]);

	const currentElapsed = timerElapsedAt(state, now);
	const displayTime = state.mode === 'countdown'
		? formatTime(Math.max(0, state.target - currentElapsed))
		: formatTime(currentElapsed, true);

	return <div style={styles.display}>{displayTime}</div>;
});

export const TimerPanel: React.FC = () => {
	const { t } = useTranslation();
	const [state, , stateReady] = useToolState<TimerState>('timer', initialState, { normalize: normalizeTimerState });
	const [inputMins, setInputMins, minsReady] = useToolState<number>('timer-mins', 5, { codec: timerMinutesCodec });
	const [inputSecs, setInputSecs, secsReady] = useToolState<number>('timer-secs', 0, { codec: timerSecondsCodec });
	const command = useCallback((payload: TimerCommand) => {
		void sendDeadlineCommand({ job: 'timer', command: payload }).catch((error: unknown) => {
			console.warn('[HALO:Timer] Background command failed', error);
		});
	}, []);

	const handleToggle = useCallback(() => {
		command({ type: 'toggle' });
	}, [command]);

	const handleReset = useCallback(() => {
		command({ type: 'reset' });
	}, [command]);

	const handleLap = useCallback(() => {
		if (state.mode !== 'stopwatch') return;
		command({ type: 'lap' });
	}, [state.mode, command]);

	const handleMode = useCallback((mode: TimerMode) => {
		command({ type: 'set-mode', mode, target: (inputMins * 60 + inputSecs) * 1000 });
	}, [inputMins, inputSecs, command]);

	const handlePreset = useCallback((ms: number) => {
		setInputMins(Math.floor(ms / 60000));
		setInputSecs(Math.floor((ms % 60000) / 1000));
		command({ type: 'set-target', target: ms });
	}, [command, setInputSecs, setInputMins]);

	useEffect(() => {
		if (!stateReady || !minsReady || !secsReady || state.isRunning) return;
		const target = (inputMins * 60 + inputSecs) * 1000;
		if (state.target !== target) command({ type: 'set-target', target });
	}, [inputMins, inputSecs, stateReady, minsReady, secsReady, state.isRunning, state.target, command]);

	return (
		<div style={styles.wrapper}>
			<div style={styles.tabs}>
				<button type="button" style={{ ...styles.tab, ...(state.mode === 'stopwatch' ? styles.active : styles.inactive) }} onClick={() => handleMode('stopwatch')}>
					⏱️ {t('timer.stopwatch')}
				</button>
				<button type="button" style={{ ...styles.tab, ...(state.mode === 'countdown' ? styles.active : styles.inactive) }} onClick={() => handleMode('countdown')}>
					⏰ {t('timer.countdown')}
				</button>
			</div>

			{state.mode === 'countdown' && !state.isRunning && state.elapsed === 0 && (
				<>
					<div style={styles.inputRow}>
						<input type="number" style={styles.input} value={inputMins} onChange={(e) => setInputMins(Math.max(0, parseInt(e.target.value, 10) || 0))} />
						<span style={{ fontSize: '24px' }}>:</span>
						<input type="number" style={styles.input} value={inputSecs} onChange={(e) => setInputSecs(Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0)))} />
					</div>
					<div style={styles.presets}>
						{PRESETS.map((preset) => <button type="button" key={preset.ms} style={styles.preset} onClick={() => handlePreset(preset.ms)}>{preset.label}</button>)}
					</div>
				</>
			)}

			<TimerDisplay state={state} />

			<div style={styles.controls}>
				<button type="button" style={styles.btn} onClick={handleToggle}>
					{state.isRunning ? '⏸️' : '▶️'} {state.isRunning ? t('timer.pause') : t('timer.start')}
				</button>
				{state.mode === 'stopwatch' && state.isRunning && (
					<button type="button" style={styles.btnSecondary} onClick={handleLap}>{t('timer.lap')}</button>
				)}
				<button type="button" style={styles.btnSecondary} onClick={handleReset}>🔄</button>
			</div>

			{state.laps.length > 0 && (
				<div style={styles.laps}>
					{state.laps.map((lap, index) => {
						// biome-ignore lint/suspicious/noArrayIndexKey: Stopwatch laps are append-only and their ordinal position is the displayed identity.
						return <div key={index} style={styles.lap}>
							<span>Lap {index + 1}</span>
							<span>{formatTime(lap, true)}</span>
						</div>;
					})}
				</div>
			)}
		</div>
	);
};

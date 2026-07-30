// goal: Timer panel UI - countdown and stopwatch

import type React from 'react';
import { useEffect, useCallback, useRef } from 'react';
import { useTranslation } from '../../i18n';
import type { TimerMode, TimerState } from './types';
import { formatTime, PRESETS } from './core';
import { styles } from './panel.styles';
import { playCompletionTone, useToolState } from '../../kernel';


const initialState: TimerState = { mode: 'stopwatch', elapsed: 0, target: 300000, isRunning: false, laps: [] };

export const TimerPanel: React.FC = () => {
	const { t } = useTranslation();
	const [state, setState] = useToolState<TimerState>('timer', initialState);
	const [inputMins, setInputMins] = useToolState<number>('timer-mins', 5);
	const [inputSecs, setInputSecs] = useToolState<number>('timer-secs', 0);

	const intervalRef = useRef<number | null>(null);
	const elapsedRef = useRef(state.elapsed);
	elapsedRef.current = state.elapsed;

	// Timer tick
	useEffect(() => {
		if (!state.isRunning) return;

		const startedAt = Date.now();
		const startingElapsed = elapsedRef.current;
		intervalRef.current = window.setInterval(() => {
			const newElapsed = startingElapsed + Date.now() - startedAt;
			if (state.mode === 'countdown' && newElapsed >= state.target) {
				if (intervalRef.current !== null) {
					clearInterval(intervalRef.current);
					intervalRef.current = null;
				}
				setState((current) => ({
					...current,
					elapsed: current.target,
					isRunning: false,
				}));
				void playCompletionTone().catch((error: unknown) => {
					console.warn('[HALO:Timer] Completion tone failed', error);
				});
				return;
			}
			setState((current) => ({ ...current, elapsed: newElapsed }));
		}, 10);

		return () => {
			if (intervalRef.current !== null) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		};
	}, [state.isRunning, state.mode, state.target, setState]);

	// Start/Stop
	const handleToggle = useCallback(() => {
		setState((s) => ({ ...s, isRunning: !s.isRunning }));
	}, [setState]);

	// Reset
	const handleReset = useCallback(() => {
		setState((s) => ({ ...s, elapsed: 0, isRunning: false, laps: [] }));
	}, [setState]);

	// Lap (stopwatch only)
	const handleLap = useCallback(() => {
		if (state.mode === 'stopwatch') {
			setState((s) => ({ ...s, laps: [...s.laps, s.elapsed] }));
		}
	}, [state.mode, setState]);

	// Switch mode
	const handleMode = useCallback((mode: TimerMode) => {
		setState({ ...initialState, mode, target: (inputMins * 60 + inputSecs) * 1000 });
	}, [inputMins, inputSecs, setState]);

	// Set preset
	const handlePreset = useCallback((ms: number) => {
		setInputMins(Math.floor(ms / 60000));
		setInputSecs(Math.floor((ms % 60000) / 1000));
		setState((s) => ({ ...s, target: ms, elapsed: 0, isRunning: false }));
	}, [setState, setInputSecs, setInputMins]);

	// Update target from input
	useEffect(() => {
		if (!state.isRunning) {
			setState((s) => ({ ...s, target: (inputMins * 60 + inputSecs) * 1000 }));
		}
	}, [inputMins, inputSecs, state.isRunning, setState]);

	// Display time
	const displayTime = state.mode === 'countdown'
		? formatTime(Math.max(0, state.target - state.elapsed))
		: formatTime(state.elapsed, true);

	return (
		<div style={styles.wrapper}>
			{/* Mode Tabs */}
			<div style={styles.tabs}>
				<button type="button" style={{ ...styles.tab, ...(state.mode === 'stopwatch' ? styles.active : styles.inactive) }} onClick={() => handleMode('stopwatch')}>
					⏱️ {t('timer.stopwatch')}
				</button>
				<button type="button" style={{ ...styles.tab, ...(state.mode === 'countdown' ? styles.active : styles.inactive) }} onClick={() => handleMode('countdown')}>
					⏰ {t('timer.countdown')}
				</button>
			</div>

			{/* Countdown Input */}
			{state.mode === 'countdown' && !state.isRunning && state.elapsed === 0 && (
				<>
					<div style={styles.inputRow}>
						<input type="number" style={styles.input} value={inputMins} onChange={(e) => setInputMins(Math.max(0, parseInt(e.target.value, 10) || 0))} />
						<span style={{ fontSize: '24px' }}>:</span>
						<input type="number" style={styles.input} value={inputSecs} onChange={(e) => setInputSecs(Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0)))} />
					</div>
					<div style={styles.presets}>
						{PRESETS.map((p) => <button type="button" key={p.ms} style={styles.preset} onClick={() => handlePreset(p.ms)}>{p.label}</button>)}
					</div>
				</>
			)}

			{/* Time Display */}
			<div style={styles.display}>{displayTime}</div>

			{/* Controls */}
			<div style={styles.controls}>
				<button type="button" style={styles.btn} onClick={handleToggle}>
					{state.isRunning ? '⏸️' : '▶️'} {state.isRunning ? t('timer.pause') : t('timer.start')}
				</button>
				{state.mode === 'stopwatch' && state.isRunning && (
					<button type="button" style={styles.btnSecondary} onClick={handleLap}>{t('timer.lap')}</button>
				)}
				<button type="button" style={styles.btnSecondary} onClick={handleReset}>🔄</button>
			</div>

			{/* Laps */}
			{state.laps.length > 0 && (
				<div style={styles.laps}>
					{state.laps.map((lap, i) => {
						// biome-ignore lint/suspicious/noArrayIndexKey: Stopwatch laps are append-only and their ordinal position is the displayed identity.
						return <div key={i} style={styles.lap}>
							<span>Lap {i + 1}</span>
							<span>{formatTime(lap, true)}</span>
						</div>;
					})}
				</div>
			)}
		</div>
	);
};

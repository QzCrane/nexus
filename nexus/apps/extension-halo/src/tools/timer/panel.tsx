// goal: Timer panel UI - countdown and stopwatch

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from '../../i18n';
import type { TimerMode, TimerState } from './types';
import { formatTime, PRESETS } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


const initialState: TimerState = { mode: 'stopwatch', elapsed: 0, target: 300000, isRunning: false, laps: [] };

export const TimerPanel: React.FC = () => {
	const { t } = useTranslation();
	const [state, setState] = useToolState<TimerState>('timer' as any, initialState);
	const [inputMins, setInputMins] = useToolState<number>('timer-mins' as any, 5);
	const [inputSecs, setInputSecs] = useToolState<number>('timer-secs' as any, 0);

	const intervalRef = useRef<number | null>(null);
	const startTimeRef = useRef(0);

	// Timer tick
	useEffect(() => {
		if (state.isRunning) {
			startTimeRef.current = Date.now() - state.elapsed;
			intervalRef.current = window.setInterval(() => {
				const newElapsed = Date.now() - startTimeRef.current;
				if (state.mode === 'countdown' && newElapsed >= state.target) {
					setState((s) => ({ ...s, elapsed: s.target, isRunning: false }));
					try { new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10').play(); } catch { /* ignore */ }
				} else {
					setState((s) => ({ ...s, elapsed: newElapsed }));
				}
			}, 10);
		}
		return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
	}, [state.isRunning, state.mode, state.target]);

	// Start/Stop
	const handleToggle = useCallback(() => {
		setState((s) => ({ ...s, isRunning: !s.isRunning }));
	}, []);

	// Reset
	const handleReset = useCallback(() => {
		setState((s) => ({ ...s, elapsed: 0, isRunning: false, laps: [] }));
	}, []);

	// Lap (stopwatch only)
	const handleLap = useCallback(() => {
		if (state.mode === 'stopwatch') {
			setState((s) => ({ ...s, laps: [...s.laps, s.elapsed] }));
		}
	}, [state.mode]);

	// Switch mode
	const handleMode = useCallback((mode: TimerMode) => {
		setState({ ...initialState, mode, target: (inputMins * 60 + inputSecs) * 1000 });
	}, [inputMins, inputSecs]);

	// Set preset
	const handlePreset = useCallback((ms: number) => {
		setInputMins(Math.floor(ms / 60000));
		setInputSecs(Math.floor((ms % 60000) / 1000));
		setState((s) => ({ ...s, target: ms, elapsed: 0, isRunning: false }));
	}, []);

	// Update target from input
	useEffect(() => {
		if (!state.isRunning) {
			setState((s) => ({ ...s, target: (inputMins * 60 + inputSecs) * 1000 }));
		}
	}, [inputMins, inputSecs, state.isRunning]);

	// Display time
	const displayTime = state.mode === 'countdown'
		? formatTime(Math.max(0, state.target - state.elapsed))
		: formatTime(state.elapsed, true);

	return (
		<div style={styles.wrapper}>
			{/* Mode Tabs */}
			<div style={styles.tabs}>
				<button style={{ ...styles.tab, ...(state.mode === 'stopwatch' ? styles.active : styles.inactive) }} onClick={() => handleMode('stopwatch')}>
					⏱️ {t('timer.stopwatch')}
				</button>
				<button style={{ ...styles.tab, ...(state.mode === 'countdown' ? styles.active : styles.inactive) }} onClick={() => handleMode('countdown')}>
					⏰ {t('timer.countdown')}
				</button>
			</div>

			{/* Countdown Input */}
			{state.mode === 'countdown' && !state.isRunning && state.elapsed === 0 && (
				<>
					<div style={styles.inputRow}>
						<input type="number" style={styles.input} value={inputMins} onChange={(e) => setInputMins(Math.max(0, parseInt(e.target.value) || 0))} />
						<span style={{ fontSize: '24px' }}>:</span>
						<input type="number" style={styles.input} value={inputSecs} onChange={(e) => setInputSecs(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))} />
					</div>
					<div style={styles.presets}>
						{PRESETS.map((p) => <button key={p.ms} style={styles.preset} onClick={() => handlePreset(p.ms)}>{p.label}</button>)}
					</div>
				</>
			)}

			{/* Time Display */}
			<div style={styles.display}>{displayTime}</div>

			{/* Controls */}
			<div style={styles.controls}>
				<button style={styles.btn} onClick={handleToggle}>
					{state.isRunning ? '⏸️' : '▶️'} {state.isRunning ? t('timer.pause') : t('timer.start')}
				</button>
				{state.mode === 'stopwatch' && state.isRunning && (
					<button style={styles.btnSecondary} onClick={handleLap}>{t('timer.lap')}</button>
				)}
				<button style={styles.btnSecondary} onClick={handleReset}>🔄</button>
			</div>

			{/* Laps */}
			{state.laps.length > 0 && (
				<div style={styles.laps}>
					{state.laps.map((lap, i) => (
						<div key={i} style={styles.lap}>
							<span>Lap {i + 1}</span>
							<span>{formatTime(lap, true)}</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
};

// goal: Timer panel UI - countdown and stopwatch
// eff: persistent time authority is anchor-based; display ticks remain local/ephemeral

import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../i18n';
import type { TimerMode, TimerState } from './types';
import { formatTime, PRESETS } from './core';
import { styles } from './panel.styles';
import { playCompletionTone, useToolState } from '../../kernel';

const initialState: TimerState = {
	mode: 'stopwatch',
	elapsed: 0,
	startedAt: undefined,
	target: 300000,
	isRunning: false,
	laps: [],
};

function runningElapsed(state: TimerState, now: number): number {
	if (!state.isRunning || typeof state.startedAt !== 'number') return state.elapsed;
	return state.elapsed + Math.max(0, now - state.startedAt);
}

export const TimerPanel: React.FC = () => {
	const { t } = useTranslation();
	const [state, setState] = useToolState<TimerState>('timer', initialState);
	const [inputMins, setInputMins] = useToolState<number>('timer-mins', 5);
	const [inputSecs, setInputSecs] = useToolState<number>('timer-secs', 0);
	const [now, setNow] = useState(() => Date.now());

	// One-time compatibility repair for pre-anchor persisted running states.
	useEffect(() => {
		if (!state.isRunning || typeof state.startedAt === 'number') return;
		setState((current) => {
			if (!current.isRunning || typeof current.startedAt === 'number') return current;
			return { ...current, startedAt: Date.now() };
		});
	}, [state.isRunning, state.startedAt, setState]);

	// Display projection only. rAF aligns updates to paint and naturally pauses
	// when the SidePanel is not rendered; persistent TimerState is untouched.
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

	const currentElapsed = useMemo(
		() => runningElapsed(state, now),
		[state, now],
	);

	// Countdown owns one completion timer instead of a 10ms repeating writer.
	useEffect(() => {
		if (
			!state.isRunning
			|| state.mode !== 'countdown'
			|| typeof state.startedAt !== 'number'
		) return;

		const elapsedAtSchedule = state.elapsed + Math.max(0, Date.now() - state.startedAt);
		const remaining = Math.max(0, state.target - elapsedAtSchedule);
		const timeoutId = window.setTimeout(() => {
			setState((current) => {
				if (
					!current.isRunning
					|| current.mode !== 'countdown'
					|| typeof current.startedAt !== 'number'
				) return current;
				if (runningElapsed(current, Date.now()) < current.target) return current;
				return {
					...current,
					elapsed: current.target,
					startedAt: undefined,
					isRunning: false,
				};
			});
			void playCompletionTone().catch((error: unknown) => {
				console.warn('[HALO:Timer] Completion tone failed', error);
			});
		}, remaining);

		return () => window.clearTimeout(timeoutId);
	}, [state.isRunning, state.mode, state.startedAt, state.elapsed, state.target, setState]);

	const handleToggle = useCallback(() => {
		const timestamp = Date.now();
		setState((current) => {
			if (current.isRunning) {
				const elapsed = runningElapsed(current, timestamp);
				return {
					...current,
					elapsed: current.mode === 'countdown'
						? Math.min(current.target, elapsed)
						: elapsed,
					startedAt: undefined,
					isRunning: false,
				};
			}
			return {
				...current,
				startedAt: timestamp,
				isRunning: true,
			};
		});
	}, [setState]);

	const handleReset = useCallback(() => {
		setState((current) => ({
			...current,
			elapsed: 0,
			startedAt: undefined,
			isRunning: false,
			laps: [],
		}));
	}, [setState]);

	const handleLap = useCallback(() => {
		if (state.mode !== 'stopwatch') return;
		const lapElapsed = runningElapsed(state, Date.now());
		setState((current) => ({ ...current, laps: [...current.laps, lapElapsed] }));
	}, [state, setState]);

	const handleMode = useCallback((mode: TimerMode) => {
		setState({
			...initialState,
			mode,
			target: (inputMins * 60 + inputSecs) * 1000,
		});
	}, [inputMins, inputSecs, setState]);

	const handlePreset = useCallback((ms: number) => {
		setInputMins(Math.floor(ms / 60000));
		setInputSecs(Math.floor((ms % 60000) / 1000));
		setState((current) => ({
			...current,
			target: ms,
			elapsed: 0,
			startedAt: undefined,
			isRunning: false,
		}));
	}, [setState, setInputSecs, setInputMins]);

	useEffect(() => {
		if (state.isRunning) return;
		const target = (inputMins * 60 + inputSecs) * 1000;
		setState((current) => current.target === target
			? current
			: { ...current, target });
	}, [inputMins, inputSecs, state.isRunning, setState]);

	const displayTime = state.mode === 'countdown'
		? formatTime(Math.max(0, state.target - currentElapsed))
		: formatTime(currentElapsed, true);

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

			<div style={styles.display}>{displayTime}</div>

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

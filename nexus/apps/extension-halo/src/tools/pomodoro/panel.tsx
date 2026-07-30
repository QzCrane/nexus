// goal: Pomodoro panel UI - timer with phases

import type React from 'react';
import { useEffect, useCallback, useRef } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { PomodoroConfig, PomodoroState } from './types';
import { DEFAULT_CONFIG } from './types';
import { formatTime, getPhaseDuration, getNextPhase, createInitialState, PHASE_COLORS } from './core';
import { styles } from './panel.styles';
import { playCompletionTone, useToolState } from '../../kernel';


export const PomodoroPanel: React.FC = () => {
	const { t } = useTranslation();
	const [config, setConfig] = useToolState<PomodoroConfig>('pomodoro-config', DEFAULT_CONFIG);
	const [state, setState] = useToolState<PomodoroState>('pomodoro-state', () => createInitialState(config));

	const intervalRef = useRef<number | null>(null);
	// rule: hold latest remaining in a ref so the timer effect doesn't re-run every
	// second. Previously `state.remaining` was in the effect deps, so every tick
	// triggered setState → re-render → effect cleanup → new setInterval, recreating
	// the interval 60 times per minute (and never letting it fire more than once).
	const remainingRef = useRef(state.remaining);
	useEffect(() => { remainingRef.current = state.remaining; }, [state.remaining]);

	// Timer tick
	useEffect(() => {
		if (!state.isRunning) return;

		intervalRef.current = window.setInterval(() => {
			const currentRemaining = remainingRef.current;
			if (currentRemaining <= 1) {
				// Phase complete — clear interval immediately to prevent double-firing
				// before React re-renders and the effect cleanup runs.
				if (intervalRef.current) {
					clearInterval(intervalRef.current);
					intervalRef.current = null;
					// rule: play sound outside the setState updater to avoid side
					// effects in the reducer (StrictMode double-invokes updaters).
					void playCompletionTone().catch((error: unknown) => {
						console.warn('[HALO:Pomodoro] Completion tone failed', error);
					});
				}
				// rule: use functional setState so phase/sessionsCompleted are read
				// from the latest state — this lets us keep them OUT of the effect
				// deps (otherwise the effect re-runs every tick, defeating the ref).
				setState((s) => {
					const nextPhase = getNextPhase(s, config);
					const newSessions = s.phase === 'work' ? s.sessionsCompleted + 1 : s.sessionsCompleted;
					return {
						phase: nextPhase,
						remaining: getPhaseDuration(nextPhase, config),
						isRunning: false,
						sessionsCompleted: newSessions,
					};
				});
			} else {
				setState((s) => ({ ...s, remaining: s.remaining - 1 }));
			}
		}, 1000);

		return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
	}, [state.isRunning, config, setState]);

	// Toggle timer
	const handleToggle = useCallback(() => {
		setState((s) => ({ ...s, isRunning: !s.isRunning }));
	}, [setState]);

	// Reset timer
	const handleReset = useCallback(() => {
		setState(createInitialState(config));
	}, [config, setState]);

	// Skip to next phase
	const handleSkip = useCallback(() => {
		const nextPhase = getNextPhase(state, config);
		const newSessions = state.phase === 'work' ? state.sessionsCompleted + 1 : state.sessionsCompleted;
		setState({
			phase: nextPhase,
			remaining: getPhaseDuration(nextPhase, config),
			isRunning: false,
			sessionsCompleted: newSessions,
		});
	}, [state, config, setState]);

	// Progress calculation
	const total = getPhaseDuration(state.phase, config);
	const progress = (total - state.remaining) / total;
	const color = PHASE_COLORS[state.phase];

	return (
		<div style={styles.wrapper}>
			{/* Timer Circle */}
			<div style={styles.timer}>
				<svg width="200" height="200" style={styles.circle} role="img" aria-label={t('pomodoro.timerAria', { defaultValue: 'Pomodoro timer progress' })}>
					<circle cx="100" cy="100" r="90" fill="none" stroke="var(--halo-bg-tertiary)" strokeWidth="8" />
					<circle
						cx="100" cy="100" r="90" fill="none" stroke={color} strokeWidth="8"
						strokeDasharray={`${progress * 565.48} 565.48`}
						strokeLinecap="round"
					/>
				</svg>
				<div style={styles.time}>{formatTime(state.remaining)}</div>
			</div>

			{/* Phase & Sessions */}
			<div style={{ ...styles.phase, color }}>{t(`pomodoro.phases.${state.phase}`, { defaultValue: state.phase })}</div>
			<div style={styles.sessions}>{t('pomodoro.sessions')}: {state.sessionsCompleted}</div>

			{/* Controls */}
			<div style={styles.controls}>
				<button type="button" style={styles.btn} onClick={handleToggle}>
					{state.isRunning ? '⏸️' : '▶️'} {state.isRunning ? t('pomodoro.pause') : t('pomodoro.start')}
				</button>
				<button type="button" style={styles.btnSecondary} onClick={handleSkip}>⏭️</button>
				<button type="button" style={styles.btnSecondary} onClick={handleReset}>🔄</button>
			</div>

			{/* Config */}
			<Card variant="default" padding="sm">
				<div style={styles.config}>
					<div style={styles.configItem}>
						<input type="number" style={styles.input} value={config.workMinutes}
							onChange={(e) => setConfig((c) => ({ ...c, workMinutes: Math.max(1, parseInt(e.target.value, 10) || 25) }))} />
						<span style={styles.label}>{t('pomodoro.work')}</span>
					</div>
					<div style={styles.configItem}>
						<input type="number" style={styles.input} value={config.shortBreakMinutes}
							onChange={(e) => setConfig((c) => ({ ...c, shortBreakMinutes: Math.max(1, parseInt(e.target.value, 10) || 5) }))} />
						<span style={styles.label}>{t('pomodoro.shortBreak')}</span>
					</div>
					<div style={styles.configItem}>
						<input type="number" style={styles.input} value={config.longBreakMinutes}
							onChange={(e) => setConfig((c) => ({ ...c, longBreakMinutes: Math.max(1, parseInt(e.target.value, 10) || 15) }))} />
						<span style={styles.label}>{t('pomodoro.longBreak')}</span>
					</div>
				</div>
			</Card>
		</div>
	);
};

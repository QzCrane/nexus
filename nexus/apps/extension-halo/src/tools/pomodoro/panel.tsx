// goal: Pomodoro panel UI - timer with phases
// eff: persistent state changes only at user/phase boundaries; display time is projected from a deadline

import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { PomodoroConfig, PomodoroState } from './types';
import { DEFAULT_CONFIG } from './types';
import { normalizePomodoroConfig, normalizePomodoroState, formatTime, getPhaseDuration, getNextPhase, createInitialState, PHASE_COLORS } from './core';
import { styles } from './panel.styles';
import { playCompletionTone, useToolState } from '../../kernel';

function projectedRemaining(state: PomodoroState, now: number): number {
	if (!state.isRunning || typeof state.endsAt !== 'number') return state.remaining;
	return Math.max(0, Math.ceil((state.endsAt - now) / 1000));
}

export const PomodoroPanel: React.FC = () => {
	const { t } = useTranslation();
	const [config, setConfig] = useToolState<PomodoroConfig>('pomodoro-config', DEFAULT_CONFIG, { normalize: normalizePomodoroConfig });
	const [state, setState, stateReady] = useToolState<PomodoroState>('pomodoro-state', () => createInitialState(config), { normalize: normalizePomodoroState });
	const [now, setNow] = useState(() => Date.now());
	const stateRef = useRef(state);
	stateRef.current = state;

	// Compatibility repair for old persisted running states that predate endsAt.
	useEffect(() => {
		if (!stateReady || !state.isRunning || typeof state.endsAt === 'number') return;
		setState((current) => {
			if (!current.isRunning || typeof current.endsAt === 'number') return current;
			return { ...current, endsAt: Date.now() + current.remaining * 1000 };
		});
	}, [stateReady, state.isRunning, state.endsAt, setState]);

	// One 1Hz owner handles both the whole-second display projection and phase
	// completion. Every tick compares the latest persisted deadline against a
	// fresh wall-clock sample, so forward/backward system-clock changes cannot
	// strand an expired phase or fire an early tone. Persistent PomodoroState
	// still changes only once at the real phase boundary.
	useEffect(() => {
		if (!stateReady || !state.isRunning || typeof state.endsAt !== 'number') return;

		const tick = () => {
			const observedNow = Date.now();
			setNow(observedNow);
			const current = stateRef.current;
			if (!current.isRunning || typeof current.endsAt !== 'number') return;
			if (current.endsAt > observedNow) return;

			const nextPhase = getNextPhase(current, config);
			const sessionsCompleted = current.phase === 'work'
				? current.sessionsCompleted + 1
				: current.sessionsCompleted;
			const next: PomodoroState = {
				phase: nextPhase,
				remaining: getPhaseDuration(nextPhase, config),
				endsAt: null,
				isRunning: false,
				sessionsCompleted,
			};
			stateRef.current = next;
			setState(next);
			void playCompletionTone().catch((error: unknown) => {
				console.warn('[HALO:Pomodoro] Completion tone failed', error);
			});
		};

		tick();
		const intervalId = window.setInterval(tick, 1000);
		return () => window.clearInterval(intervalId);
	}, [stateReady, state.isRunning, state.endsAt, config, setState]);

	const remaining = useMemo(() => projectedRemaining(state, now), [state, now]);

	const handleToggle = useCallback(() => {
		const timestamp = Date.now();
		setState((current) => {
			if (current.isRunning) {
				return {
					...current,
					remaining: projectedRemaining(current, timestamp),
					endsAt: null,
					isRunning: false,
				};
			}
			return {
				...current,
				endsAt: timestamp + current.remaining * 1000,
				isRunning: true,
			};
		});
	}, [setState]);

	const handleReset = useCallback(() => {
		setState(createInitialState(config));
	}, [config, setState]);

	const handleSkip = useCallback(() => {
		const nextPhase = getNextPhase(state, config);
		const sessionsCompleted = state.phase === 'work'
			? state.sessionsCompleted + 1
			: state.sessionsCompleted;
		setState({
			phase: nextPhase,
			remaining: getPhaseDuration(nextPhase, config),
			endsAt: null,
			isRunning: false,
			sessionsCompleted,
		});
	}, [state, config, setState]);

	const total = getPhaseDuration(state.phase, config);
	const progress = total > 0 ? (total - remaining) / total : 0;
	const color = PHASE_COLORS[state.phase];

	return (
		<div style={styles.wrapper}>
			<div style={styles.timer}>
				<svg width="200" height="200" style={styles.circle} role="img" aria-label={t('pomodoro.timerAria', { defaultValue: 'Pomodoro timer progress' })}>
					<circle cx="100" cy="100" r="90" fill="none" stroke="var(--halo-bg-tertiary)" strokeWidth="8" />
					<circle
						cx="100" cy="100" r="90" fill="none" stroke={color} strokeWidth="8"
						strokeDasharray={`${progress * 565.48} 565.48`}
						strokeLinecap="round"
					/>
				</svg>
				<div style={styles.time}>{formatTime(remaining)}</div>
			</div>

			<div style={{ ...styles.phase, color }}>{t(`pomodoro.phases.${state.phase}`, { defaultValue: state.phase })}</div>
			<div style={styles.sessions}>{t('pomodoro.sessions')}: {state.sessionsCompleted}</div>

			<div style={styles.controls}>
				<button type="button" style={styles.btn} onClick={handleToggle}>
					{state.isRunning ? '⏸️' : '▶️'} {state.isRunning ? t('pomodoro.pause') : t('pomodoro.start')}
				</button>
				<button type="button" style={styles.btnSecondary} onClick={handleSkip}>⏭️</button>
				<button type="button" style={styles.btnSecondary} onClick={handleReset}>🔄</button>
			</div>

			<Card variant="default" padding="sm">
				<div style={styles.config}>
					<div style={styles.configItem}>
						<input type="number" style={styles.input} value={config.workMinutes}
							onChange={(e) => setConfig((current) => ({ ...current, workMinutes: Math.max(1, parseInt(e.target.value, 10) || 25) }))} />
						<span style={styles.label}>{t('pomodoro.work')}</span>
					</div>
					<div style={styles.configItem}>
						<input type="number" style={styles.input} value={config.shortBreakMinutes}
							onChange={(e) => setConfig((current) => ({ ...current, shortBreakMinutes: Math.max(1, parseInt(e.target.value, 10) || 5) }))} />
						<span style={styles.label}>{t('pomodoro.shortBreak')}</span>
					</div>
					<div style={styles.configItem}>
						<input type="number" style={styles.input} value={config.longBreakMinutes}
							onChange={(e) => setConfig((current) => ({ ...current, longBreakMinutes: Math.max(1, parseInt(e.target.value, 10) || 15) }))} />
						<span style={styles.label}>{t('pomodoro.longBreak')}</span>
					</div>
				</div>
			</Card>
		</div>
	);
};

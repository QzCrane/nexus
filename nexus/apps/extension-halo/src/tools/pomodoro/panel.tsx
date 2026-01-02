// goal: Pomodoro panel UI - timer with phases

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { PomodoroConfig, PomodoroState } from './types';
import { DEFAULT_CONFIG } from './types';
import { formatTime, getPhaseDuration, getNextPhase, createInitialState, PHASE_LABELS, PHASE_COLORS } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const PomodoroPanel: React.FC = () => {
	const { t } = useTranslation();
	const [config, setConfig] = useToolState<PomodoroConfig>('pomodoro-config' as any, DEFAULT_CONFIG);
	const [state, setState] = useToolState<PomodoroState>('pomodoro-state' as any, () => createInitialState(config));

	const intervalRef = useRef<number | null>(null);

	// Timer tick
	useEffect(() => {
		if (state.isRunning && state.remaining > 0) {
			intervalRef.current = window.setInterval(() => {
				setState((s) => ({ ...s, remaining: s.remaining - 1 }));
			}, 1000);
		} else if (state.remaining === 0 && state.isRunning) {
			// Phase complete
			const nextPhase = getNextPhase(state, config);
			const newSessions = state.phase === 'work' ? state.sessionsCompleted + 1 : state.sessionsCompleted;
			setState({
				phase: nextPhase,
				remaining: getPhaseDuration(nextPhase, config),
				isRunning: false,
				sessionsCompleted: newSessions,
			});
			// Play notification sound
			try { new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10').play(); } catch { /* ignore */ }
		}
		return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
	}, [state.isRunning, state.remaining, state.phase, config]);

	// Toggle timer
	const handleToggle = useCallback(() => {
		setState((s) => ({ ...s, isRunning: !s.isRunning }));
	}, []);

	// Reset timer
	const handleReset = useCallback(() => {
		setState(createInitialState(config));
	}, [config]);

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
	}, [state, config]);

	// Progress calculation
	const total = getPhaseDuration(state.phase, config);
	const progress = (total - state.remaining) / total;
	const color = PHASE_COLORS[state.phase];

	return (
		<div style={styles.wrapper}>
			{/* Timer Circle */}
			<div style={styles.timer}>
				<svg width="200" height="200" style={styles.circle}>
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
			<div style={{ ...styles.phase, color }}>{PHASE_LABELS[state.phase]}</div>
			<div style={styles.sessions}>{t('pomodoro.sessions')}: {state.sessionsCompleted}</div>

			{/* Controls */}
			<div style={styles.controls}>
				<button style={styles.btn} onClick={handleToggle}>
					{state.isRunning ? '⏸️' : '▶️'} {state.isRunning ? t('pomodoro.pause') : t('pomodoro.start')}
				</button>
				<button style={styles.btnSecondary} onClick={handleSkip}>⏭️</button>
				<button style={styles.btnSecondary} onClick={handleReset}>🔄</button>
			</div>

			{/* Config */}
			<Card variant="default" padding="sm">
				<div style={styles.config}>
					<div style={styles.configItem}>
						<input type="number" style={styles.input} value={config.workMinutes}
							onChange={(e) => setConfig((c) => ({ ...c, workMinutes: Math.max(1, parseInt(e.target.value) || 25) }))} />
						<span style={styles.label}>{t('pomodoro.work')}</span>
					</div>
					<div style={styles.configItem}>
						<input type="number" style={styles.input} value={config.shortBreakMinutes}
							onChange={(e) => setConfig((c) => ({ ...c, shortBreakMinutes: Math.max(1, parseInt(e.target.value) || 5) }))} />
						<span style={styles.label}>{t('pomodoro.shortBreak')}</span>
					</div>
					<div style={styles.configItem}>
						<input type="number" style={styles.input} value={config.longBreakMinutes}
							onChange={(e) => setConfig((c) => ({ ...c, longBreakMinutes: Math.max(1, parseInt(e.target.value) || 15) }))} />
						<span style={styles.label}>{t('pomodoro.longBreak')}</span>
					</div>
				</div>
			</Card>
		</div>
	);
};

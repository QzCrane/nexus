// goal: Pomodoro panel UI - timer with phases
// eff: persistent state changes only at user/phase boundaries; display time is projected from a deadline

import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { PomodoroConfig, PomodoroState } from './types';
import { DEFAULT_CONFIG } from './types';
import { normalizePomodoroConfig, normalizePomodoroState, formatTime, getPhaseDuration, createInitialState, PHASE_COLORS, projectedPomodoroRemaining, type PomodoroCommand } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import { sendDeadlineCommand } from '../../kernel/core/deadline-jobs/protocol';

export const PomodoroPanel: React.FC = () => {
	const { t } = useTranslation();
	const [config, setConfig] = useToolState<PomodoroConfig>('pomodoro-config', DEFAULT_CONFIG, { normalize: normalizePomodoroConfig });
	const [state, , stateReady] = useToolState<PomodoroState>('pomodoro-state', () => createInitialState(config), { normalize: normalizePomodoroState });
	const [now, setNow] = useState(() => Date.now());

	// The panel owns only display projection. Durable completion belongs to the
	// background alarm/reconciliation owner and survives this component.
	useEffect(() => {
		if (!stateReady || !state.isRunning || typeof state.endsAt !== 'number') return;
		const tick = () => setNow(Date.now());
		tick();
		const intervalId = window.setInterval(tick, 1000);
		return () => window.clearInterval(intervalId);
	}, [stateReady, state.isRunning, state.endsAt]);

	const remaining = useMemo(() => projectedPomodoroRemaining(state, now), [state, now]);
	const command = useCallback((payload: PomodoroCommand) => {
		void sendDeadlineCommand({ job: 'pomodoro', command: payload }).catch((error: unknown) => {
			console.warn('[HALO:Pomodoro] Background command failed', error);
		});
	}, []);

	const handleToggle = useCallback(() => {
		command({ type: 'toggle' });
	}, [command]);

	const handleReset = useCallback(() => {
		command({ type: 'reset', config });
	}, [command, config]);

	const handleSkip = useCallback(() => {
		command({ type: 'skip', config });
	}, [command, config]);

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

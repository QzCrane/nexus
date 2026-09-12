// goal: Regex tester panel UI
// eff: Styles extracted to reduce file size

import type React from 'react';
import { useMemo, useCallback, useEffect, useState } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { buildFlagsString, REGEX_MAX_PATTERN_UNITS, regexFlagsCodec } from './core';
import type { RegexFlags, RegexMatch } from './types';
import { DEFAULT_FLAGS, PRESETS } from './types';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import { useOwnedAsyncTask } from '../../kernel/hooks/use-owned-async-task';
import { extensionWorkerFactory, oneShotWorker } from '../../kernel/utils/one-shot-worker';
import { REGEX_TASK_DEADLINE_MS, REGEX_WORKER_PATH, type RegexWorkerRequest, type RegexWorkerResponse } from './worker-contract';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';


export const RegexPanel: React.FC = () => {
	const { t } = useTranslation();
	const [pattern, setPattern] = useToolState<string>('regex', '');
	const [testString, setTestString] = useToolState<string>('regex-test', '');
	const [replacement, setReplacement] = useToolState<string>('regex-replace', '');
	const [flags, setFlags, , flagsRecovery] = useToolState<RegexFlags>('regex-flags', DEFAULT_FLAGS, { codec: regexFlagsCodec });
	const [showReplace, setShowReplace] = useToolState<boolean>('regex-show-replace', false);
	const [matches, setMatches] = useState<RegexMatch[]>([]);
	const [replaced, setReplaced] = useState('');
	const [workerError, setWorkerError] = useState<string | null>(null);
	const task = useOwnedAsyncTask();
	const workerFactory = useMemo(() => extensionWorkerFactory(REGEX_WORKER_PATH), []);

	const patternError = pattern.length > REGEX_MAX_PATTERN_UNITS
		? `Pattern exceeds the ${REGEX_MAX_PATTERN_UNITS}-character limit.`
		: null;
	useEffect(() => {
		if (patternError !== null || !pattern || !testString) {
			task.cancel();
			setMatches([]);
			setReplaced('');
			setWorkerError(null);
			return;
		}
		const request: RegexWorkerRequest = {
			pattern,
			testString,
			replacement,
			flags: structuredClone(flags),
			includeReplacement: showReplace,
		};
		const timer = setTimeout(() => {
			void task.run(
				() => oneShotWorker<RegexWorkerRequest, RegexWorkerResponse>(workerFactory, request),
				REGEX_TASK_DEADLINE_MS,
			).then((outcome) => {
				if (outcome.kind !== 'succeeded') return;
				if (outcome.value.ok === false) {
					setMatches([]);
					setReplaced('');
					setWorkerError(outcome.value.error);
					return;
				}
				setMatches(outcome.value.matches);
				setReplaced(outcome.value.replaced);
				setWorkerError(null);
			});
		}, 150);
		return () => {
			clearTimeout(timer);
			task.cancel();
		};
	}, [pattern, testString, replacement, flags, showReplace, patternError, task.run, task.cancel, workerFactory]);

	const toggleFlag = useCallback((key: keyof RegexFlags) => {
		setFlags((prev) => ({ ...prev, [key]: !prev[key] }));
	}, [setFlags]);

	const loadPreset = useCallback((preset: typeof PRESETS[0]) => {
		setPattern(preset.pattern);
		setFlags({
			global: preset.flags.includes('g'),
			ignoreCase: preset.flags.includes('i'),
			multiline: preset.flags.includes('m'),
			dotAll: preset.flags.includes('s'),
			unicode: preset.flags.includes('u'),
		});
	}, [setPattern, setFlags]);

	return (
		<div style={styles.wrapper}>
			<StorageRecoveryActions recovery={flagsRecovery} emptyValue={DEFAULT_FLAGS} exportName="halo-regex-flags-damaged.json" />
			{/* Pattern Input */}
			<Card variant="default" padding="sm">
				<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
					<div style={styles.row}>
						<span style={styles.label}>/{' '}</span>
						<input
							style={styles.input}
							value={pattern}
							onChange={(e) => setPattern(e.target.value)}
							placeholder={t('regex.patternPlaceholder') || 'Enter regex pattern...'}
						/>
						<span style={styles.label}>/{buildFlagsString(flags)}</span>
					</div>
					{patternError !== null && <div style={styles.error}>⚠️ {patternError}</div>}
					{(workerError !== null || task.error !== null) && <div style={styles.error}>⚠️ {workerError ?? String(task.error)}</div>}

					{/* Flags */}
					<div style={styles.row}>
						{(['global', 'ignoreCase', 'multiline', 'dotAll', 'unicode'] as const).map((key) => (
							<button type="button"
								key={key}
								style={{ ...styles.flagBtn, ...(flags[key] ? styles.flagActive : styles.flagInactive) }}
								onClick={() => toggleFlag(key)}
							title={key}
						>
							{key.charAt(0).toUpperCase()}
						</button>
						))}
					</div>

					{/* Presets */}
					<div style={{ ...styles.row, flexWrap: 'wrap', gap: '6px' }}>
						<span style={styles.label}>Presets:</span>
						{PRESETS.map((p) => (
							<button type="button" key={p.name} style={styles.presetBtn} onClick={() => loadPreset(p)}>
								{p.name}
							</button>
						))}
					</div>
				</div>
			</Card>

			{/* Test String */}
			<Card variant="default" padding="sm">
				<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
					<span style={styles.label}>{t('regex.testString') || 'Test String'}</span>
					<textarea
						style={styles.textarea}
						value={testString}
						onChange={(e) => setTestString(e.target.value)}
						placeholder={t('regex.testPlaceholder') || 'Enter text to test...'}
					/>
				</div>
			</Card>

			{/* Replace (Optional) */}
			<Card variant="default" padding="sm">
				<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
					<div style={styles.row}>
						<input
							type="checkbox"
							checked={showReplace}
							onChange={(e) => setShowReplace(e.target.checked)}
						/>
						<span style={styles.label}>{t('regex.replaceMode') || 'Replace Mode'}</span>
					</div>
					{showReplace && (
						<>
							<input
								style={styles.input}
								value={replacement}
								onChange={(e) => setReplacement(e.target.value)}
								placeholder={t('regex.replacePlaceholder') || 'Replacement text...'}
							/>
							{replaced && (
								<div style={{ ...styles.textarea, minHeight: '60px', overflow: 'auto' }}>
									{replaced}
								</div>
							)}
						</>
					)}
				</div>
			</Card>

			{/* Matches */}
			<Card variant="default" padding="sm">
				<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
					<div style={styles.row}>
						<span style={styles.label}>{t('regex.matches') || 'Matches'}</span>
						<span style={styles.count}>{task.phase === 'running' ? '…' : matches.length}</span>
					</div>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflow: 'auto' }}>
						{matches.length === 0 && pattern && patternError === null && task.phase !== 'running' && workerError === null && (
							<div style={{ color: 'var(--halo-text-muted)', fontSize: '11px' }}>{t('regex.noMatches')}</div>
						)}
						{matches.map((m) => (
							<div key={`${m.index}:${m.text}`} style={styles.matchItem}>
								<span style={styles.matchText}>"{m.text}"</span>
								<div style={styles.matchMeta}>
									{t('regex.matchInfo').replace('{{line}}', String(m.line)).replace('{{col}}', String(m.column)).replace('{{index}}', String(m.index))}
								</div>
								{m.groups && Object.keys(m.groups).length > 0 && (
									<div style={styles.matchMeta}>
										{t('regex.groups')}: {JSON.stringify(m.groups)}
									</div>
								)}
							</div>
						))}
					</div>
				</div>
			</Card>
		</div>
	);
};

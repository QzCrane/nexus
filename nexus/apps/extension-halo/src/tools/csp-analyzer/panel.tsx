// goal: CSP facts and evaluator findings with explicit header disposition

import type React from 'react';
import { useMemo } from 'react';
import { useTranslation } from '../../i18n';
import { useToolState } from '../../kernel';
import { analyzeCsp } from './core';
import { styles } from './panel.styles';

export const CspAnalyzerPanel: React.FC = () => {
	const { t } = useTranslation();
	const [enforced, setEnforced] = useToolState<string>('csp-analyzer', '');
	const [reportOnly, setReportOnly] = useToolState<string>('csp-analyzer-report-only', '');
	const analysis = useMemo(() => {
		try { return { value: analyzeCsp(enforced, reportOnly), error: '' }; }
		catch (error) { return { value: null, error: error instanceof Error ? error.message : String(error) }; }
	}, [enforced, reportOnly]);

	return <div style={styles.wrapper}>
		<div style={styles.boundary}>{t('cspAnalyzer.boundary')}</div>
		<label htmlFor="csp-enforced" style={styles.label}>{t('cspAnalyzer.enforced')}</label>
		<textarea id="csp-enforced" style={styles.textarea} value={enforced} onChange={(event) => setEnforced(event.target.value)} placeholder="default-src 'self'; object-src 'none'" />
		<label htmlFor="csp-report-only" style={styles.label}>{t('cspAnalyzer.reportOnly')}</label>
		<textarea id="csp-report-only" style={styles.textarea} value={reportOnly} onChange={(event) => setReportOnly(event.target.value)} placeholder="script-src 'nonce-…' 'strict-dynamic'" />
		{analysis.error && <div style={styles.error}>{analysis.error}</div>}
		{analysis.value && analysis.value.status !== 'absent' && <>
			<div style={styles.status}>{t(`cspAnalyzer.status.${analysis.value.status}`)}</div>
			<div style={styles.fact}>{t(`cspAnalyzer.fact.${analysis.value.compositionFact}`)}</div>
			<div style={styles.list}>{analysis.value.policies.map((policy, index) => {
				// biome-ignore lint/suspicious/noArrayIndexKey: Response-header order is the policy's source identity and duplicate headers are semantically distinct.
				return <div key={`${policy.disposition}-${index}`} style={styles.card}>
				<div style={styles.name}>{t(`cspAnalyzer.disposition.${policy.disposition}`)} · {t('cspAnalyzer.policy')} {index + 1}</div>
				<code style={styles.policyText}>{policy.policy}</code>
				{policy.ignoredDuplicateDirectives.length > 0 && <div style={styles.duplicate}>{t('cspAnalyzer.duplicates')}: {policy.ignoredDuplicateDirectives.join(', ')}</div>}
				{policy.findings.length === 0 ? <div style={styles.desc}>{t('cspAnalyzer.noFindings')}</div> : policy.findings.map((finding, findingIndex) => {
					// biome-ignore lint/suspicious/noArrayIndexKey: The evaluator can emit identical findings whose ordered occurrence is their only stable identity.
					return <div key={`${finding.directive}-${findingIndex}`} style={styles.finding}>
					<span style={styles[`risk-${finding.risk}`]}>{t(`cspAnalyzer.risk.${finding.risk}`)}</span>
					<div style={styles.findingText}><strong>{finding.directive || t('cspAnalyzer.policy')}</strong>{finding.value ? ` · ${finding.value}` : ''}<br />{finding.description}</div>
					</div>;
				})}
			</div>;
			})}</div>
		</>}
	</div>;
};

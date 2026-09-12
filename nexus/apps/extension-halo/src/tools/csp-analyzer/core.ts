// goal: CSP parser/evaluator adapter that reports facts and findings without a synthetic score

import { CspEvaluator, DEFAULT_CHECKS, STRICTCSP_CHECKS } from 'csp_evaluator/dist/evaluator';
import { Severity } from 'csp_evaluator/dist/finding';
import { CspParser } from 'csp_evaluator/dist/parser';

export type CspDisposition = 'enforce' | 'report-only';
export type CspRisk = 'high' | 'syntax' | 'medium' | 'recommendation' | 'info' | 'effective';
export interface CspFinding { directive: string; value?: string; description: string; risk: CspRisk; }
export interface CspPolicyAnalysis {
	disposition: CspDisposition;
	policy: string;
	directives: Array<{ name: string; values: string[] }>;
	ignoredDuplicateDirectives: string[];
	findings: CspFinding[];
}
export interface CspAnalysis {
	status: 'absent' | 'report-only' | 'enforced';
	enforcedPolicyCount: number;
	reportOnlyPolicyCount: number;
	policies: CspPolicyAnalysis[];
	compositionFact: 'none' | 'report-only-does-not-enforce' | 'enforced-policies-intersect';
}

export const CSP_LIMITS = Object.freeze({ totalCharacters: 65_536, policyCharacters: 16_384, policies: 8 });

function riskForSeverity(severity: Severity): CspRisk {
	if (severity === Severity.HIGH) return 'high';
	if (severity === Severity.SYNTAX) return 'syntax';
	if (severity === Severity.STRICT_CSP) return 'recommendation';
	if (severity === Severity.INFO) return 'info';
	if (severity === Severity.NONE) return 'effective';
	return 'medium';
}

function duplicateNames(policy: string): string[] {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const part of policy.split(';')) {
		const name = part.trim().split(/\s+/, 1)[0]?.toLowerCase();
		if (!name) continue;
		if (seen.has(name)) duplicates.add(name);
		else seen.add(name);
	}
	return [...duplicates];
}

function policyLines(input: string): string[] {
	return input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function analyzeCsp(enforcedInput: string, reportOnlyInput = ''): CspAnalysis {
	if (enforcedInput.length + reportOnlyInput.length > CSP_LIMITS.totalCharacters) throw new RangeError('CSP input exceeds 65536 characters');
	const entries = [
		...policyLines(enforcedInput).map((policy) => ({ disposition: 'enforce' as const, policy })),
		...policyLines(reportOnlyInput).map((policy) => ({ disposition: 'report-only' as const, policy })),
	];
	if (entries.length > CSP_LIMITS.policies) throw new RangeError('CSP input exceeds 8 policies');
	if (entries.some(({ policy }) => policy.length > CSP_LIMITS.policyCharacters)) throw new RangeError('A CSP policy exceeds 16384 characters');

	const policies = entries.map(({ disposition, policy }): CspPolicyAnalysis => {
		const parsed = new CspParser(policy).csp;
		const findings = new CspEvaluator(parsed).evaluate(undefined, [...DEFAULT_CHECKS, ...STRICTCSP_CHECKS]);
		return {
			disposition,
			policy,
			directives: Object.entries(parsed.directives).map(([name, values]) => ({ name, values: values ?? [] })),
			ignoredDuplicateDirectives: duplicateNames(policy),
			findings: findings.map((finding) => ({
				directive: finding.directive,
				...(finding.value === undefined ? {} : { value: finding.value }),
				description: finding.description,
				risk: riskForSeverity(finding.severity),
			})),
		};
	});
	const enforcedPolicyCount = policies.filter(({ disposition }) => disposition === 'enforce').length;
	const reportOnlyPolicyCount = policies.length - enforcedPolicyCount;
	return {
		status: enforcedPolicyCount > 0 ? 'enforced' : reportOnlyPolicyCount > 0 ? 'report-only' : 'absent',
		enforcedPolicyCount,
		reportOnlyPolicyCount,
		policies,
		compositionFact: enforcedPolicyCount > 0 ? 'enforced-policies-intersect' : reportOnlyPolicyCount > 0 ? 'report-only-does-not-enforce' : 'none',
	};
}

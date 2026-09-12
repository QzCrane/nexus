export const en = {
	'tools.csp-analyzer.name': 'CSP Analyzer',
	'tools.csp-analyzer.desc': 'Analyze Content Security Policy',
	cspAnalyzer: {
		boundary: 'Advisory analysis of CSP3 policy text. Findings do not prove that a site is secure; actual headers, browser behavior, resources, and bypasses remain relevant.',
		enforced: 'Content-Security-Policy (one header per line)',
		reportOnly: 'Content-Security-Policy-Report-Only (one header per line)',
		policy: 'Policy', duplicates: 'Later duplicate directives are ignored', noFindings: 'No evaluator findings for this policy.',
		status: { enforced: 'Enforced policy present', 'report-only': 'Report-only policies only' },
		fact: { 'enforced-policies-intersect': 'Multiple enforced policies all apply; a load must satisfy every policy.', 'report-only-does-not-enforce': 'Report-only policies report violations but do not block loads.', none: '' },
		disposition: { enforce: 'Enforced', 'report-only': 'Report only' },
		risk: { high: 'High', syntax: 'Syntax', medium: 'Medium', recommendation: 'Recommendation', info: 'Info', effective: 'Effective behavior' }
	}
};

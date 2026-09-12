export const zh = {
	'tools.csp-analyzer.name': 'CSP 分析',
	'tools.csp-analyzer.desc': '分析内容安全策略',
	cspAnalyzer: {
		boundary: '对 CSP3 策略文本提供辅助分析。发现项不能证明站点安全；仍需结合真实响应头、浏览器行为、资源和绕过方式判断。',
		enforced: 'Content-Security-Policy（每行一个响应头）',
		reportOnly: 'Content-Security-Policy-Report-Only（每行一个响应头）',
		policy: '策略', duplicates: '后续同名指令会被忽略', noFindings: '该策略没有评估器发现项。',
		status: { enforced: '存在强制执行的策略', 'report-only': '只有报告模式策略' },
		fact: { 'enforced-policies-intersect': '多个强制策略会同时生效；资源必须满足每一个策略。', 'report-only-does-not-enforce': '报告模式策略只报告违规，不会阻止资源加载。', none: '' },
		disposition: { enforce: '强制执行', 'report-only': '仅报告' },
		risk: { high: '高风险', syntax: '语法', medium: '中风险', recommendation: '建议', info: '信息', effective: '实际行为' }
	}
};

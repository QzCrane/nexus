export const zh = {
	'tools.code-formatter.name': '代码格式化',
	'tools.code-formatter.desc': '按各语言的明确边界格式化或压缩文本',
	codeFormatter: {
		placeholder: '粘贴代码...',
		indentSize: '缩进大小',
		format: '格式化',
		minify: '压缩',
		boundaries: {
			json: '严格 JSON；格式化和压缩都会保留原始数字位数。',
			html: '仅调整空白和缩进，不验证 HTML 语法。',
			xml: '仅调整空白和缩进；需要文档级 XML 保真时请使用 XML 格式化工具。',
			css: '格式化只调整空白；压缩由 CSSO 执行并报告引擎错误。',
			js: '仅做基础缩进及注释/空白处理，不验证 JavaScript 语法。',
			sql: '格式化由 sql-formatter 执行；压缩只移除注释并折叠字符串之外的空白。'
		}
	}
};

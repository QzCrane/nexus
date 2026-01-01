export const modules = {
	tools: {
		qrcode: {
			name: '二维码',
			desc: '生成二维码，支持历史记录与右键菜单',
		},
		'color-picker': {
			name: '取色器',
			desc: '支持 HEX/RGB/HSL 格式与历史记录',
		},
		ruler: {
			name: '尺子',
			desc: '测量页面元素尺寸 (px/rem)',
		},
		'json-formatter': {
			name: 'JSON',
			desc: '格式化、压缩、排序 JSON 键',
		},
		outline: {
			name: '大纲',
			desc: '页面标题导航与 Markdown 导出',
		},
		clipboard: {
			name: '剪贴板',
			desc: '智能剪贴板，支持跨页面引用',
		},
		pdf: {
			name: 'PDF 工具',
			desc: '本地合并、拆分、压缩 PDF',
		},
		archive: {
			name: '网页存档',
			desc: '完整保存网页离线浏览',
		},
		screenshot: {
			name: '截图',
			desc: '截图与批注工具',
		},
		regex: {
			name: '正则测试',
			desc: '正则表达式实时测试',
		},
		'base64': {
			name: 'Base64',
			desc: '编码/解码 Base64 字符串',
		},
		timer: {
			name: '计时器',
			desc: '番茄钟与秒表',
		},
		notes: {
			name: '快捷便签',
			desc: '随时随地记录笔记',
		},
		hash: {
			name: '哈希计算',
			desc: '计算 MD5, SHA-1, SHA-256, SHA-512',
		},
		uuid: {
			name: 'UUID 生成',
			desc: '批量生成 UUID v4',
		},
		timestamp: {
			name: '时间戳',
			desc: '时间戳与日期格式转换',
		},
		url: {
			name: 'URL 工具',
			desc: 'URL 编码/解码与参数解析',
		},
		settings: {
			name: '设置',
			desc: '自定义 HALO 外观与行为',
		},
		'smooth-scroll': {
			name: '平滑滚动',
			desc: '丝滑顺畅的页面滚动体验',
		},
		tabs: {
			name: '标签页',
			desc: '垂直标签管理与搜索',
		},
		'module-store': {
			name: '模块商店',
			desc: '安装或卸载工具模块',
		},
		crypto: {
			name: '加密工具',
			desc: 'JWT, RSA, AES 加密解密',
		},
		network: {
			name: '网络工具',
			desc: 'UA 解析, Curl 转换',
		},

		'mock-data': {
			name: '模拟数据',
			desc: '生成测试数据',
		},
		userscripts: {
			name: '用户脚本',
			desc: '注入自定义 JavaScript',
		},
		yaml: {
			name: 'YAML',
			desc: 'YAML 与 JSON 互转',
		},
		diff: {
			name: '文本对比',
			desc: '比对文本差异 (Diff)',
		},
		'number-base': {
			name: '进制转换',
			desc: '二进制、八进制、十进制、十六进制',
		},
		'text-tools': {
			name: '文本工具',
			desc: '大小写、排序、去重、统计',
		},
		permissions: {
			name: '权限管理',
			desc: '管理扩展的可选权限',
		},
		'lorem-ipsum': {
			name: '乱数假文',
			desc: '生成 Lorem Ipsum 占位文本',
		},
		// New translations v1.3+
		markdown: {
			name: 'Markdown',
			desc: '实时预览与编辑器',
		},
		'unit-converter': {
			name: '单位转换',
			desc: '长度、重量、温度、数据单位转换',
		},
		cron: {
			name: 'Cron 解析',
			desc: '解析 Cron 表达式',
		},
		'html-entity': {
			name: 'HTML 实体',
			desc: '编码/解码 HTML 实体',
		},
		'code-formatter': {
			name: '代码格式化',
			desc: '格式化与压缩代码',
		},
		'password-gen': {
			name: '密码生成',
			desc: '生成安全随机密码',
		},
		'image-tools': {
			name: '图片工具',
			desc: '压缩与格式转换',
		},
		'cookie-manager': {
			name: 'Cookie 管理',
			desc: '查看与编辑网站 Cookie',
		},
		'reader-mode': {
			name: '阅读模式',
			desc: '无干扰阅读体验',
		},
		totp: {
			name: 'TOTP 验证器',
			desc: '两步验证码生成器',
		},
		'bookmark-manager': {
			name: '书签管理',
			desc: '搜索与整理书签',
		},
		'tech-stack': {
			name: '技术栈',
			desc: '检测网站使用的技术栈',
		},
		'sticky-notes': {
			name: '便利贴',
			desc: '快速记录备忘',
		},
		pomodoro: {
			name: '番茄钟',
			desc: '专注工作与休息计时',
		},
		'http-status': {
			name: 'HTTP 状态',
			desc: 'HTTP 状态码查询',
		},
		'csv-viewer': {
			name: 'CSV 查看器',
			desc: '解析与预览 CSV 数据',
		},
		shortcuts: {
			name: '快捷键',
			desc: '常用键盘快捷键速查',
		},
		'ip-lookup': {
			name: 'IP 查询',
			desc: '查询 IP 地址信息',
		},
		'font-inspector': {
			name: '字体检测',
			desc: '识别网页字体',
		},
		'xml-formatter': {
			name: 'XML 格式化',
			desc: '格式化与校验 XML',
		},
		'history-search': {
			name: '历史记录',
			desc: '搜索浏览历史',
		},
		'headers-viewer': {
			name: 'Headers 查看',
			desc: '查看 HTTP 请求头',
		},
		'exif-reader': {
			name: 'EXIF 读取',
			desc: '读取图片元数据',
		},
		'table-extractor': {
			name: '表格提取',
			desc: '提取网页表格为 CSV',
		},
		'todo-list': {
			name: '待办清单',
			desc: '任务管理列表',
		},
		'storage-editor': {
			name: 'Storage 编辑',
			desc: '编辑 localStorage',
		},
		'text-to-speech': {
			name: '文字转语音',
			desc: '朗读文本内容',
		},
		'user-agent': {
			name: 'User Agent',
			desc: 'UA 字符串解析与参考',
		},
		'color-palette': {
			name: '调色盘',
			desc: '从图片提取配色方案',
		},
		gzip: {
			name: 'Gzip',
			desc: 'Gzip 压缩与解压',
		},
		'jwt-decoder': {
			name: 'JWT 解码',
			desc: '解码 JWT 令牌',
		},
		morse: {
			name: '摩斯密码',
			desc: '摩斯密码编码解码',
		},
		'emoji-picker': {
			name: '表情拾取',
			desc: '浏览与复制 Emoji',
		},
		'json-to-csv': {
			name: 'JSON 转 CSV',
			desc: 'JSON 数据转换为 CSV',
		},
		'sql-formatter': {
			name: 'SQL 格式化',
			desc: '格式化与美化 SQL',
		},
		'json-path': {
			name: 'JSONPath',
			desc: 'JSON 数据查询调试',
		},
		checksum: {
			name: '校验和',
			desc: '文件哈希校验',
		},
		punycode: {
			name: 'Punycode',
			desc: 'IDN 域名转换',
		},
		rot13: {
			name: 'ROT13',
			desc: 'ROT13/ROT47 加密',
		},
		'csv-to-json': {
			name: 'CSV 转 JSON',
			desc: 'CSV 数据转换为 JSON',
		},
		'hex-dump': {
			name: 'Hex Dump',
			desc: '查看文件十六进制',
		},
		'ssl-cert': {
			name: 'SSL 证书',
			desc: '解析 SSL 证书信息',
		},
		xor: {
			name: 'XOR 计算',
			desc: '异或运算工具',
		},
		protobuf: {
			name: 'Protobuf',
			desc: '解析 Protobuf 数据',
		},
		'random-gen': {
			name: '随机生成',
			desc: '生成 UUID 与密钥',
		},
		subresource: {
			name: 'SRI 生成',
			desc: '生成子资源完整性哈希',
		},
		'csp-analyzer': {
			name: 'CSP 分析',
			desc: '分析内容安全策略',
		},
		'dom-selector': {
			name: 'DOM 选择器',
			desc: '获取元素 CSS/XPath 选择器',
		},
		'session-manager': {
			name: '会话管理',
			desc: '保存与恢复标签页会话',
		},
		'page-annotate': {
			name: '页面标注',
			desc: '在这个网页上绘画',
		},
		translate: {
			name: '翻译',
			desc: '快速翻译页面或文本',
		},
		'tab-group': {
			name: '标签组',
			desc: '管理浏览器标签组',
		},
		'media-sniffer': {
			name: '媒体嗅探',
			desc: '检测并下载页面媒体资源',
		},
		'code-snippets': {
			name: '代码片段',
			desc: '保存和管理代码片段',
		},
		'api-tester': {
			name: 'API 测试',
			desc: '发送 HTTP 请求并查看响应',
		},
	},
};

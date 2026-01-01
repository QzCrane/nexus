// goal: v0.6.0 tool translations (Chinese)

export const panelsV6 = {
	textTools: {
		modes: { case: '大小写', stats: '统计', dedupe: '去重', sort: '排序' },
		placeholder: '在此输入或粘贴文本...',
		convert: '转换', dedupe: '去除重复', trim: '修剪行',
		sortAsc: '升序 A-Z', sortDesc: '降序 Z-A', reverse: '反转',
		stats: { chars: '字符', charsNoSpaces: '无空格', words: '单词', lines: '行', bytes: '字节' },
	},
	loremIpsum: {
		generate: '生成', generateBtn: '生成', startWithLorem: '以 "Lorem ipsum" 开头',
		units: { words: '单词', sentences: '句子', paragraphs: '段落' },
	},
	diff: {
		original: '原始文本', modified: '修改文本', compare: '对比',
		swap: '交换', clear: '清除', additions: '新增', deletions: '删除',
		pasteOriginal: '粘贴原始文本...', pasteModified: '粘贴修改文本...',
	},
	yaml: {
		convert: '转换', swap: '交换', pasteYaml: '粘贴 YAML...', pasteJson: '粘贴 JSON...',
	},
	numberBase: {
		input: '输入', placeholder: '输入数字...', invalidInput: '所选进制的输入无效',
	},
	markdown: {
		edit: '编辑', split: '分屏', preview: '预览',
		placeholder: '在此编写 Markdown...', copyMd: '复制 MD', copyHtml: '复制 HTML',
	},
	unitConverter: {
		from: '从', to: '到', swap: '交换',
	},
	cron: {
		minute: '分钟', hour: '小时', dayOfMonth: '日', month: '月', dayOfWeek: '星期',
		invalid: '无效的 cron 表达式', presets: '预设', nextRuns: '未来 5 次运行',
	},
	htmlEntity: {
		encode: '编码', decode: '解码', input: '输入', output: '输出',
		encodeSpecial: '仅特殊字符', encodeNamed: '命名实体', encodeAll: '所有字符',
		decodeBtn: '解码', reference: '实体参考',
	},
	codeFormatter: {
		placeholder: '粘贴代码...', indentSize: '缩进大小',
		format: '格式化', minify: '压缩',
	},
	passwordGen: {
		generate: '生成', length: '长度', history: '历史',
		uppercase: '大写', lowercase: '小写', numbers: '数字', symbols: '符号',
		excludeAmbiguous: '排除相似字符 (0, O, l, 1)',
	},
	imageTools: {
		dropHint: '拖放图片或点击选择', format: '格式', quality: '质量',
		process: '压缩/转换', download: '下载', saved: '节省',
	},
	cookieManager: {
		title: 'Cookie', cookies: '个 Cookie', search: '搜索 Cookie...',
		loading: '加载中...', noCookies: '未找到 Cookie',
	},
	readerMode: {
		extract: '提取文章', fontSize: '字体大小', font: '字体',
		clickToExtract: '点击从当前页面提取文章',
	},
	totp: {
		addAccount: '添加账户', cancel: '取消', add: '添加',
		name: '账户名称', secretOrUri: '密钥或 otpauth:// URI',
		noAccounts: '未添加 2FA 账户',
	},
	bookmarkManager: {
		recent: '最近', search: '搜索', searchPlaceholder: '搜索书签...',
		loading: '加载中...', noResults: '未找到书签', noRecent: '无最近书签',
	},
	techStack: {
		scan: '扫描页面', detected: '检测到的技术', categories: '分类',
		noTech: '未检测到技术', clickToScan: '点击扫描当前页面',
	},
	stickyNotes: {
		title: '便签', add: '新建便签', empty: '点击 + 添加便签', placeholder: '写点什么...',
	},
	pomodoro: {
		sessions: '完成次数', start: '开始', pause: '暂停',
		work: '工作', shortBreak: '短休', longBreak: '长休',
	},
	timer: {
		stopwatch: '秒表', countdown: '倒计时',
		start: '开始', pause: '暂停', lap: '计次',
	},
	httpStatus: {
		search: '搜索状态码...',
	},
	csvViewer: {
		placeholder: '粘贴 CSV 数据...', empty: '粘贴 CSV 以表格形式查看',
		showing100: '显示前 100 行',
	},
	shortcuts: {
		search: '搜索快捷键...', noResults: '未找到快捷键',
	},
	ipLookup: {
		placeholder: '输入 IP 地址或留空查询本机 IP',
		loading: '加载中...', invalidIp: '无效 IP 地址', notFound: '未找到 IP',
		location: '位置', org: '运营商', hostname: '主机名',
		timezone: '时区', coords: '坐标',
	},
	fontInspector: {
		scan: '扫描页面字体', noFonts: '未检测到字体', clickToScan: '点击扫描页面字体',
	},
	xmlFormatter: {
		placeholder: '粘贴 XML...', format: '格式化', minify: '压缩',
		valid: '有效', invalid: '无效', elements: '元素', attributes: '属性',
	},
	historySearch: {
		placeholder: '搜索历史...', loading: '加载中...', noResults: '未找到历史记录',
	},
	headersViewer: {
		placeholder: '输入 URL...', loading: '加载中...', empty: '输入 URL 查看请求头',
	},
	exifReader: {
		dropHere: '拖放图片或点击选择',
		noExif: '未找到 EXIF 数据',
		make: '制造商', model: '型号', dateTime: '日期', software: '软件',
		dimensions: '尺寸', fileSize: '大小',
	},
	tableExtractor: {
		extract: '提取表格', noTables: '页面中没有表格',
		clickToExtract: '点击从当前页面提取表格',
	},
	todoList: {
		placeholder: '添加新任务...', empty: '暂无任务',
		all: '全部', active: '进行中', completed: '已完成',
		remaining: '剩余', clearCompleted: '清除已完成',
	},
	storageEditor: {
		scan: '扫描存储', empty: '无存储数据', clickToScan: '点击扫描页面存储',
	},
	tts: {
		placeholder: '输入要朗读的文本...', loadSelected: '加载选中文本',
		play: '播放', voice: '语音', rate: '语速', pitch: '音调',
	},
	userAgent: {
		current: '当前 User Agent',
	},
	colorPalette: {
		dropHere: '拖放图片或点击选择',
	},
	gzip: {
		compress: '压缩', decompress: '解压',
		input: '输入', output: '输出', inputText: '输入要压缩的文本...',
		inputBase64: '输入 Base64 gzip 数据...', saved: '已节省', error: '无效输入',
	},
	jwt: {
		placeholder: '粘贴 JWT 令牌...', invalid: '无效的 JWT 令牌',
	},
	morse: {
		encode: '文本 → 摩尔斯', decode: '摩尔斯 → 文本',
		input: '输入', output: '输出', copy: '复制',
	},
	jsonToCsv: {
		input: 'JSON 输入', output: 'CSV 输出', delimiter: '分隔符', copy: '复制 CSV', download: '下载 CSV',
	},
	sql: {
		format: '格式化', minify: '压缩', copy: '复制',
	},
	jsonPath: {
		matches: '个匹配项', copy: '复制结果',
	},
	checksum: {
		dropFile: '拖放文件以计算哈希', algorithm: '算法', expectedHash: '粘贴预期哈希以验证...',
	},
	punycode: {
		input: '域名 (Unicode / Punycode)', encode: '编码 (转 ASCII)', decode: '解码 (转 Unicode)',
	},
	rot13: {
		input: '输入', output: '输出', mode: '模式', shift: '位移',
	},
	csvToJson: {
		input: 'CSV 输入', output: 'JSON 输出', separator: '分隔符', header: '包含表头',
	},
	hexDump: {
		drop: '拖放文件以查看', offset: '偏移', hex: '十六进制', ascii: 'ASCII',
	},
};

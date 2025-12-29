// goal: 中文翻译
// eff: 简体中文本地化

import type { TranslationKeys } from '../types';

export const zh: TranslationKeys = {
	common: {
		search: '搜索工具...',
		settings: '设置',
		tools: '工具',
		favorites: '收藏',
		all: '全部',
		enabled: '已启用',
		disabled: '已禁用',
		comingSoon: '即将推出',
		selectTool: '选择一个工具开始',
		noResults: '未找到工具',
		loading: '加载中...',
		save: '保存',
		cancel: '取消',
		reset: '重置',
		language: '语言',
	},
	categories: {
		general: '通用工具',
		dev: '开发工具',
		efficiency: '效率工具',
		visual: '视觉工具',
		ai: 'AI 智能',
	},
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
		settings: {
			name: '设置',
			desc: '自定义 HALO 外观与行为',
		},
	},
	settings: {
		title: '设置',
		appearance: '外观',
		theme: '主题',
		themeDesc: '选择你喜欢的配色方案',
		dark: '深色',
		light: '浅色',
		system: '跟随系统',
		accentColor: '强调色',
		accentColorDesc: '自定义主色调',
		interface: '界面',
		compactMode: '紧凑模式',
		compactModeDesc: '减少间距适配小屏幕',
		showLabels: '显示工具标签',
		showLabelsDesc: '在图标下方显示文字',
		animations: '动画效果',
		animationsDesc: '启用平滑过渡动画',
		toolManagement: '工具管理',
		manageTools: '管理工具',
		manageToolsDesc: '启用、禁用、置顶和排序工具',
		languageSetting: '语言',
		languageSettingDesc: '选择界面语言',
		actions: '操作',
		resetAll: '重置所有设置',
		version: '用 💜 打造',
	},
	toolManager: {
		title: '工具管理',
		searchPlaceholder: '按名称搜索工具...',
		enableAll: '全部启用',
		disableAll: '全部禁用',
		sortByName: '按名称排序',
		sortByUsage: '按使用频率排序',
		pinned: '已置顶',
		unpinned: '未置顶',
		enable: '启用',
		disable: '禁用',
		pin: '置顶',
		unpin: '取消置顶',
	},
	footer: {
		zeroTracking: '零追踪',
		localOnly: '本地处理',
	},
};

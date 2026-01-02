
export const zh = {
	permissions: {
		title: '权限管理器',
		subtitle: '控制 HALO 可以访问的功能',
		categoryBasic: '基础功能',
		categoryAdvanced: '高级访问',
		categoryPrivacy: '隐私敏感',
		grant: '授权',
		revoke: '撤销',
		usedBy: '使用者',
		privacyNote: 'HALO 遵循隐私优先原则。仅启用您实际需要的权限。',
		cannotRevoke: 'HALO 需要此权限才能正常工作，无法撤销。',
		items: {
			pageCapture: { name: '页面捕获', desc: '将网页保存为完整的 MHTML 文件' },
			webNavigation: { name: '网页导航', desc: '检测页面跳转以便进行脚本注入' },
			clipboardRead: { name: '剪贴板读取', desc: '从您的剪贴板读取文本内容' },
			clipboardWrite: { name: '剪贴板写入', desc: '将文本内容复制到您的剪贴板' },
			downloads: { name: '下载管理', desc: '管理和保存文件下载' },
			history: { name: '历史记录', desc: '访问您的浏览器浏览历史' },
			bookmarks: { name: '书签管理', desc: '访问并管理您的浏览器书签' },
			topSites: { name: '常用网站', desc: '访问最常访问网站的数据' },
			notifications: { name: '桌面通知', desc: '显示系统级桌面通知' },
			allHosts: { name: '所有网站', desc: '允许在任何网站注入脚本（用户脚本功能必需）' },
		},
	},
};

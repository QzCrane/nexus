export const zh = {
	// Registry i18n (required format)
	"tools.hover-zoom.name": "浮图秀",
	"tools.hover-zoom.desc": "鼠标悬停显示高清大图",

	// Panel i18n
	hoverZoom: {
		enable: "启用浮图秀",
		enableDesc: "PhotoShow 风格预览，可用性取决于页面与浏览器权限",

		resourceKeys: {
			title: "资源快捷键",
			desc: "配置图片和视频预览的触发键，更具体的组合键优先",
			image: "图片",
			video: "视频",
			tip: "无缝切换：浮图显示时，按另一组合键可直接切换图片/视频"
		},

		trigger: {
			title: "触发设置",
			key: "触发键",
			action: "触发模式",
			hold: "按住",
			toggle: "点按",
			delay: "显示延迟"
		},

		view: {
			title: "外观设置",
			highlight: "触发高亮框",
			viewMode: "显示尺寸",
			borderRadius: "边框样式",
			loadingIndicator: "加载指示器",
			antiHotlink: "反防盗链 (隐私模式)",
			videoFallback: "视频失败降级为图片"
		},

		viewMode: {
			original: "原始尺寸",
			fit: "适应屏幕"
		},

		highlight: {
			always: "常开",
			hotkey: "快捷键",
			off: "关闭"
		},

		altKeyMode: {
			label: "Alt键处理",
			compat: "兼容模式",
			compatDesc: "仅当浮图可见时阻止浏览器菜单弹出",
			block: "完全阻断",
			blockDesc: "按下Alt时始终阻止浏览器菜单弹出"
		},

		exemptions: {
			title: "触发豁免",
			smallInteractive: "忽略小型交互元素"
		},

		infoBar: {
			title: "信息栏",
			typeIcon: "类型图标",
			dimensions: "尺寸",
			ratio: "宽高比",
			scale: "缩放比",
			format: "格式",
			size: "文件大小",
			caption: "描述",
			source: "规则来源",
			hostname: "图片域名"
		},

		hotkeys: {
			title: "快捷键",
			download: "S - 保存图片",
			copy: "C - 复制链接",
			newtab: "T - 新标签页打开",
			rotate: "R - 旋转90°",
			close: "Esc - 关闭",
			pin: "固定"
		},

		pinMode: {
			title: "固定模式",
			key: "固定键",
			keyDesc: "浮图显示时按此键固定浮窗（可拖动、缩放）。留空 = 禁用",
			space: "空格",
			none: "禁用"
		}
	}
};

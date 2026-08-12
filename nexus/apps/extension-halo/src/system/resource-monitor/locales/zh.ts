export const zh = {
	"tools.resource-monitor.name": "运行影响清单",
	"tools.resource-monitor.desc": "展示声明机制和观测到的运行状态，不代表 CPU 或内存实测",
	"tools.resource-monitor.sections.active": "运行中",
	"tools.resource-monitor.sections.inactive": "已停止",
	"tools.resource-monitor.sections.system": "系统核心",
	"tools.resource-monitor.noActive": "无活跃后台服务",
	"tools.resource-monitor.noModules": "无后台服务",

	// Impact level labels
	"impact.level.high": "高",
	"impact.level.medium": "中",
	"impact.level.low": "低",
	"impact.level.idle": "空闲",

	// Generic mechanism descriptions (frequency from manifest)
	"impact.mechanism.interval_fast": "快速定时器",
	"impact.mechanism.interval_slow": "定时器",
	"impact.mechanism.raf_active": "动画帧",
	"impact.mechanism.raf_idle": "动画空闲",
	"impact.mechanism.event_listener": "事件监听",
	"impact.mechanism.storage_listener": "存储监听",
	"impact.mechanism.message_listener": "消息监听",
	"impact.mechanism.wheel_listener": "滚轮监听",
	"impact.mechanism.copy_listener": "复制监听",
	"impact.mechanism.mutation_observer": "DOM 监控",
	"impact.mechanism.service_worker": "Service Worker",
	"impact.mechanism.content_script": "内容脚本",
	"impact.mechanism.userscript": "用户脚本",

	// System core names
	"system.background": "后台工作线程",
	"system.content": "内容脚本",
	"system.sidepanel": "侧边面板"
};

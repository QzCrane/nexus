# Dark Reader 市场调研 (2024-2025)

> **目标**: 识别痛点 → 设计 HALO 深色模式差异化方案  
> **数据源**: Chrome/Firefox 商店评论 | GitHub Issues | Reddit

---

## 📊 基础数据

| 指标            | 数值               |
| --------------- | ------------------ |
| 用户量          | 6M+ (Chrome)       |
| 评分            | 4.7/5 (12.8k 评价) |
| 开放 Issues     | **1360**           |
| Bug 标签 Issues | 372                |

---

## 🔴 核心痛点 (按频次排序)

### P0: 性能问题 ⭐⭐⭐⭐⭐

| 子问题            | 描述                       | 来源             |
| ----------------- | -------------------------- | ---------------- |
| **浏览器变慢 2x** | Benchmark 测试显示性能减半 | Reddit           |
| **高 CPU 占用**   | 关闭状态仍消耗 CPU         | Reddit/Store     |
| **输入卡顿**      | 地址栏输入延迟             | GitHub #14877    |
| **Reddit 崩溃**   | Firefox 警告"扩展拖慢页面" | Reddit (2024 Q4) |
| **白色闪烁**      | 页面加载时先白后黑         | 普遍反馈         |

**技术根因**: DOM 遍历 + JS 注入在页面渲染后执行

### P1: 网站兼容性问题 ⭐⭐⭐⭐

| 子问题              | 描述                          |
| ------------------- | ----------------------------- |
| Akamai CDN          | 触发 IP 封禁 (误判为机器人)   |
| PDF 查看            | 工具栏/背景被反转             |
| adopted stylesheets | Firefox 无法直接访问 → 需绕路 |
| 图标变黑            | 无法识别 SVG/icon 颜色        |

### P2: 复杂配置 ⭐⭐⭐

- **模式过多**: Filter/Filter+/Static/Dynamic 让用户困惑
- **站点设置散落**: 需逐站调整参数
- **恢复困难**: 卸载后浏览器颜色仍异常 (chrome://flags 被改)

### P3: 安全顾虑 ⭐⭐

- 恶意克隆版本频现 (窃取数据)
- 用户难辨真伪

---

## 🟢 竞品分析

| 扩展                | 优势                     | 劣势            |
| ------------------- | ------------------------ | --------------- |
| **UltimaDark** (FF) | 预渲染拦截 → 无白闪/极快 | 仅 Firefox      |
| **Midnight Lizard** | 低资源/精细调节          | 配置更复杂      |
| **Night Eye**       | 智能转换/无反色          | 付费            |
| **浏览器原生**      | 零扩展 `force-dark` flag | 效果差/无白名单 |

---

## 💡 HALO 差异化方向

### 技术策略

| 痛点     | HALO 方案                         |
| -------- | --------------------------------- |
| 性能慢   | **CSS filter 注入** (非 DOM 遍历) |
| 白色闪烁 | **早期注入** via `document_start` |
| 复杂配置 | **一键开关 + 智能白名单**         |
| 高 CPU   | **纯 CSS 无 JS 轮询**             |
| 安全     | **开源 + 零遥测**                 |

### 性能目标

```
Dark Reader: ~500-2000ms 生效
HALO 目标:   <50ms 生效 (10x 提升)
```

### MVP 功能

```
v0.1 (W1-2)
├─ 全局深色开关
├─ CSS filter: invert(1) hue-rotate(180deg)
├─ 站点白名单 (本地存储)
├─ 图片/视频保护 (排除反色)
└─ 性能指标: <50ms | <5MB 内存
```

---

## 📝 用户原声 (摘录)

> "Dark Reader makes Chrome lag when typing in address bar" — GitHub

> "Nearly 2x slower in browser benchmark with Dark Reader on" — Reddit

> "Firefox shows warning that Dark Reader slows down Reddit" — Reddit 2024

> "Access Denied on Akamai sites - 10 min IP ban triggered" — GitHub #8774

---

## 🔗 参考

- GitHub: darkreader/darkreader (1360 open issues)
- Reddit: r/firefox, r/chrome 性能讨论
- 商店: 1★ 评论关键词 = slow/crash/lag/break

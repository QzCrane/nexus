---
type: explanation
status: stable
audience: contributor
---

# 05. Problem-to-principle map (历史问题 -> 长期判定标准)

> 主题 owner: 历史回归、用户反馈、待解决问题到 EPR 的可审计映射;每一行 = 一个曾经出现的问题 + 引用原则 + 长期判定标准。
> 完整目录: [engineering/README.md](../engineering/README.md)

| 历史现象 | 应用原则 | 长期判定标准 |
| --- | --- | --- |
| 音量/速度/静音全部失效 | EPR-002、EPR-006、EPR-012 | 由唯一 writer 执行,事件/getter ACK 后才更新 Snapshot |
| reset 失效 | EPR-017 | `100%`/`1x` 是字面控制值,restore 是另一种显式操作 |
| Toast 刷新网页时出现 | EPR-016 | 只有明确 intent 触发,初始化/刷新/同步不产生 Toast |
| 长按快捷键松手后仍有惯性 | EPR-016 | keyup 取消 repeat、timer、toast 和 pending action |
| 新网页必须先打开 Popup 才能用快捷键 | EPR-004、EPR-016 | 首次快捷键自动完成 identity-bound Runtime ensure |
| 动态频谱不显示 | EPR-018 | active processor + visible subscriber lease + bounded batch |
| 劫持网站全屏失败 | EPR-007、EPR-015 | 标准 fullscreen + trusted activation + baseline handoff |
| 网站 PiP 后无法恢复原视频 | EPR-013、EPR-015 | `activeVideo`、PiP owner、native enter/leave/getter 同一事务 |
| 抖音倍速 UI 不同步 | EPR-007、EPR-002、EPR-028 | 只允许已声明的 one-shot official adapter,成功须有官方 getter/readback |
| `_favicon` unknown、图标获取失败 | EPR-017、EPR-021 | 使用支持的 favicon URL/service,未知权限在构建/契约阶段拦截 |
| current document has no controllable origin | EPR-010、EPR-020 | 作为 terminal structured error,不能假装成功或无限重试 |
| READY handshake timeout | EPR-004、EPR-005、EPR-019 | 失效 cache、status probe、按 identity 重新注入;不产生 unhandled rejection |
| QR image URL invalid | EPR-021、EPR-022 | 生成前验证完整 URL/协议/fragment,渲染失败可观察且不泄露 secret |
| 安全/劫持列表冲突 | EPR-001、EPR-009 | 一个网站一个 route;视频实例不是第二种能力列表 |

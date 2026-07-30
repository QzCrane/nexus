---
type: explanation
status: stable
audience: contributor
last_reviewed: 2026-07-30
---

# 03. Runtime & quality (EPR-019..025)

> 主题 owner: 热更新与导航恢复、错误结构化、外部边界校验、远程控制最小披露、隐私承诺、性能边界、模块依赖。
> 完整目录: [engineering/README.md](../engineering/README.md)

## EPR-019: 热更新、SPA 导航与 SW 重启可恢复
同文档导航经 `webNavigation` 与 Content 去重推进 generation；完整导航/更新/suspend/pagehide/tab close 均使旧 identity/ACK/lease 失效。Offscreen audio/remote lease 由 Background 唯一管理，HELLO 恢复实际会话。

## EPR-020: 错误结构化、可观察、可归因
错误至少含 `code + message + retryable + phase` 及关键上下文标识（`tabId/documentId/generation/revision` 等）。retryable 不得越过 activation/permission/CORS/DRM/stale identity 边界。禁止空 catch、吞掉 Promise 或统一成无上下文的 `timeout`/`control_failed`。

## EPR-021: 边界先校验再执行
`runtime.onMessage` listener 仅响应精确 request-type 集合；请求/响应/sender/tab/HTTP(S) URL/QR URL 均在边界校验。远程二维码使用本地可验证 SVG/data URL，禁止泄露 secret 或依赖未声明网络生成器。

## EPR-022: 远程控制默认关闭与最小披露
远程会话使用独立随机 secret/capability，URL fragment 立即转入 `sessionStorage`；HMAC challenge 成功前不发状态、不收命令。命令绑定 session/tab/generation/sequence 拒绝重放。仅传输选中标签页标题/域名/媒体控制状态，不传内容或音视频。

## EPR-023: 隐私承诺匹配物理流量
"本地优先/零遥测"不等于"零网络流量"。可选远程使用静态站点/PeerJS signaling/STUN/TURN 并暴露连接元数据；发布页、`PRIVACY.md`、权限理由、CSP 与构建包必须一致。HALO 云备份须保持显式 opt-in。

## EPR-024: 性能优化不替代正确性
允许懒加载/coalescing/批量采样/trailing write/空闲释放；禁止用默认值代替读取、用缓存代替 identity、跳过初始化或伪造 Snapshot。每次优化需记录可测指标（FCP/ensure/首 ACK/IPC 次数/storage write/恢复耗时）。

## EPR-025: 高内聚与单向模块依赖
- Contracts 仅定义形状/guards；Kernel 统一 RPC/storage；Audio-engine 负责 WebAudio 图；应用通过 facade 访问。
- 禁止深层 cross-domain import 与循环依赖。
- HALO 工具按 `manifest/index/types/core/panel` 原子化，system/tool/script 物理隔离。

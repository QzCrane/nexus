---
type: explanation
status: stable
audience: contributor
---

# 03. Runtime & quality (EPR-019..025)

> 主题 owner: 热更新与导航恢复、错误结构化、外部边界校验、远程控制最小披露、隐私承诺、性能边界、模块依赖。
> 完整目录: [engineering/README.md](../engineering/README.md)

## EPR-019: 热更新、SPA 导航和 service-worker 重启必须可恢复

同文档导航由 `webNavigation` 事件和 Content 去重推进 generation;完整导航、扩展更新、worker suspend/restart、pagehide 和 tab close 都要使旧 identity/ACK/lease 失效。Offscreen 的 audio/remote lease 由 Background 唯一管理,HELLO 能恢复实际会话,不依赖悬挂 timer 或失效缓存。

## EPR-020: 错误必须结构化、可观察、可归因

错误至少包含 `code + message + retryable + phase`,关键链路附带 `transactionId/requestId/tabId/documentId/generation/revision/runtimeRevision/mediaId/sourceRevision`。retryable 只描述当前策略是否能重试,不能授权越过 activation、permission、CORS、DRM 或 stale identity 边界。禁止空 catch、吞掉 Promise、统一成无上下文的 `timeout` 或 `control_failed`。

## EPR-021: 消息、URL、QR 和外部边界先校验再执行

每个 `runtime.onMessage` listener 只拥有精确 request-type 集合,未知消息先返回 `false`。请求、响应、sender、tab/document、HTTP(S) URL 和 QR image URL 在边界校验;无 controllable origin、无权限、无有效 URL 都产生结构化错误。远程二维码使用本地可验证 SVG/data URL,不能把 pairing secret 放入可公开元数据或依赖未声明的网络生成器。

## EPR-022: 远程控制默认关闭,认证后最小披露

远程会话使用独立随机 session/peer/secret/capability,URL fragment 立即转入 tab-scoped `sessionStorage`,HMAC challenge 成功前不发送状态、不接受命令。命令绑定 session、tab、generation、sequence 且拒绝重放、第二控制器和未认证数据。只传用户选择标签页的标题、域名和媒体控制状态,不传 favicon、页面内容、音频或视频。

## EPR-023: 隐私承诺必须匹配物理流量

"本地优先/零遥测"不等于"绝不发生网络流量"。可选远程会使用静态远程站点、PeerJS signaling、STUN/TURN,并可能暴露 IP/连接元数据;发布页、`PRIVACY.md`、权限理由、远程站点 CSP 和实际构建包必须一致。HALO 的可选云备份也必须保持显式 opt-in,并与本地默认路径隔离。

## EPR-024: 性能优化不能替换正确性

允许懒加载、latest-value coalescing、批量采样、trailing storage write、空闲释放和共享纯依赖;禁止用默认值代替实际读取、用缓存代替 identity、为快速 READY 跳过初始化、为少写 storage 伪造 Snapshot、用轮询掩盖缺失事件。每次优化同时记录可测指标:首次可交互、Runtime ensure、首个 ACK、IPC 次数、storage write、空闲资源数和重启恢复耗时。

## EPR-025: 代码和模块保持高内聚、单向依赖

- Contracts 只描述形状和 guards,不下沉业务逻辑;Kernel 统一 RPC/storage;Audio-engine 负责 WebAudio 图;应用通过 facade 访问共享模块。
- 不跨域深层 import,不循环依赖,不用第二套私有 wire shape。
- HALO 工具按 `manifest/index/types/core/panel` 原子化;system、tool、script 物理隔离;内置 Settings 不污染 Registry。
- 目录和文件大小是可维护性信号,拆分以职责边界为准,不能为了行数制造碎片。

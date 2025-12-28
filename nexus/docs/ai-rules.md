# AI Rules

## §0 压缩原则 (第一优先)

**目标**: 极限省 token 无损压缩

核心: 完整性>行数 | 压缩表述不压缩信息 | 模块仅含必需信息

格式: 2 列用`A: B` | 流程用`→`链 | ≥3 列用表格 | 约束用`-`

禁词: 请注意/建议/的时候/进行/执行/相关的/可以/能够/应该 → 直接陈述

技巧: 代码单行`{a,b}` | 表格删对齐 | 列表用`/`合并 | 重复用`→见[文件]`

---

## §1 架构

依赖链: Contracts ← Kernel ← Audio-Engine ← Spectra

导入: 允许包入口+上引下 | 禁止深层/循环/下引上

职责: Contracts(纯类型) | Kernel(RPC+存储) | Audio-Engine(WebAudio) | Spectra(UI+Chrome)

策略: 禁硬编码 URL/规则表 | 仅 WebAudio 行为判断

---

## §2 代码

硬限: 源码 ≤200 行 | index.ts≤50 行 | 函数>50 行预警 | 文件>150 行预警

结构: `module/{index.ts, types.ts, core.ts, [feature].ts}`

红线: >200 行禁新增 | 单文件单职责 | 目录深度 ≤3

---

## §3 安全

零硬编码 Key/Token(用 env) | 日志脱敏 | 权限仅 storage/scripting/offscreen | 禁 history/bookmarks/eval

---

## §4 环境

pnpm workspace | `pnpm install/build/--filter [name] build` | 内部包: `"@nexus/x": "workspace:*"`

依赖规则: 同类禁重复 | 安装登记清单 | 删除同步更新

### 依赖清单

运行时: qrcode^1.5(QR) peerjs^1.5(WebRTC) @2025-12-26
开发时: @types/qrcode^1.5 @2025-12-26

---

## §5 开源

双仓库: nexus(私有) → spectra(公开) | `pnpm sync-public`

排除: scripts/ docs/ .agent/ store-listings/ test/ \*.ai-context.md plan.md

---

## §6 语言

新代码**强制英文** | 旧代码逐步迁移 | commit 英文 | `pnpm verify`检测

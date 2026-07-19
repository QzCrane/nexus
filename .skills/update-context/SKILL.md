---
name: update-context
description: 更新全上下文工程文档的标准流程(6 层文档同步)。触发短语:"update context", "sync docs", "更新文档"。
license: Proprietary. See LICENSE.txt
compatibility: Requires Read/Write access to .ai-context.md, plan.md, ai-rules.md, README.AI.md
metadata:
  category: maintenance
  app: all
  phase: execute
  user-invocable: true
allowed-tools: Read Edit Grep
---

# Update Context Docs

保持 6 层上下文文档与代码同步。**快、压缩、不冗余。**

## Trigger

当用户说 "update context" / "sync docs" / "更新文档" / "同步 ai context" 时自动加载。**也**在以下情况自动触发:

- 完成重大功能开发后
- 架构变更后
- 新增/删除模块后
- 新增红线/规则后

## Process

### 1. 识别变更范围

确认本次开发涉及的层级:

| 层级 | 位置 | 何时更新 |
|---|---|---|
| **入口层** | `~/.agent/rules/nexus.md`, `~/nexus/README.AI.md` | 新增工作流、架构大改 |
| **规划层** | `plan.md`, `apps/*/plan.md` | 任何功能完成 |
| **规则层** | `docs/ai-rules.md`, `docs/business-model.md` | 新增红线/规则 |
| **架构层** | `docs/*.md`, `apps/*/docs/*.md` | 模块接口/依赖变化 |
| **模块层** | `.ai-context.md` | 任何模块内部变化 |
| **工作流** | `~/.agent/workflows/*.md` | 新增/修改流程 |

### 2. 更新模块层(`.ai-context.md`)

每个被修改的模块/应用:

- [ ] 更新工具数量/功能列表
- [ ] 添加新红线/通信协议
- [ ] 更新依赖变化
- [ ] 保持压缩格式(无冗余描述)

### 3. 更新规划层(`plan.md`)

- [ ] 标记完成的功能 ✅
- [ ] 添加新章节记录重大变更(含日期)
- [ ] 更新版本号

### 4. 更新规则层(`ai-rules.md`)

如有新规则/红线/标准:

- [ ] 在对应章节添加
- [ ] 保持压缩格式(禁表格,用 `|` 分隔)

### 5. 更新入口层(`README.AI.md`)

- [ ] 同步规则层变更
- [ ] 更新工作流列表
- [ ] 更新功能摘要

### 6. 更新规则文件(`nexus.md`)[需用户手动]

⚠️ **AI 无权修改** `~/.agent/rules/nexus.md`,需告知用户:

- 更新上下文工程层级计数
- 添加新工作流
- 更新架构图

## Anti-Rationalization

- "我改的只是小功能,不用更新文档" → **错**。小功能累积就是大改动,文档漂移从今天开始。
- "我可以自己改 nexus.md" → **错**。AI 无权直接改用户级文件,必须告知用户。
- "表格比 | 分隔可读性强" → **错**。项目约定 `|` 分隔,统一优先于可读性。
- "更新 README.AI.md 等下次" → **错**。README.AI.md 是 AI 入口,过期会导致后续 AI 决策错误。

## Verification

- [ ] `.ai-context.md` 已更新
- [ ] `plan.md` 变更章节已添加(含日期)
- [ ] `ai-rules.md` 新规则已添加
- [ ] `README.AI.md` 已同步
- [ ] 已告知用户更新 `nexus.md`(如需要)
- [ ] 所有变更已 `git add && git commit`

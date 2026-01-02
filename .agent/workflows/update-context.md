---
description: 更新全上下文工程文档的标准流程
---

# 更新上下文工程 (/update-context)

## 触发时机

- 完成重大功能开发后
- 架构变更后
- 新增/删除模块后
- 新增红线/规则后

---

## 流程

### 1. 识别变更范围

确认本次开发涉及的层级:

- 入口层: `~/.agent/rules/nexus.md`, `~/nexus/README.AI.md`
- 规划层: `plan.md`, `apps/*/plan.md`
- 规则层: `docs/ai-rules.md`, `docs/business-model.md`
- 架构层: `docs/*.md`, `apps/*/docs/*.md`
- 模块层: `.ai-context.md`
- 工作流: `~/.agent/workflows/*.md`

### 2. 更新模块层 (.ai-context.md)

每个被修改的模块/应用:

- 更新工具数量/功能列表
- 添加新红线/通信协议
- 更新依赖变化

### 3. 更新规划层 (plan.md)

- 标记完成的功能 ✅
- 添加新章节记录重大变更 (含日期)
- 更新版本号

### 4. 更新规则层 (ai-rules.md)

如有新规则/红线/标准:

- 在对应章节添加
- 保持压缩格式 (禁表格, 用 `|` 分隔)

### 5. 更新入口层 (README.AI.md)

- 同步规则层变更
- 更新工作流列表
- 更新功能摘要

### 6. 更新规则文件 (nexus.md) [需用户手动]

⚠️ AI 无权修改 `~/.agent/rules/nexus.md`, 需告知用户:

- 更新上下文工程层级计数
- 添加新工作流
- 更新架构图

---

## 验证清单

- [ ] .ai-context.md 已更新
- [ ] plan.md 变更章节已添加 (含日期)
- [ ] ai-rules.md 新规则已添加
- [ ] README.AI.md 已同步
- [ ] 已告知用户更新 nexus.md (如需要)
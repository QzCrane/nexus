---
trigger: always_on
---

# Project NEXUS AI 规则

## 🚨 必读入口

在 nexus-os/ 中工作时，必须先阅读：
1. nexus-os/README.AI.md - AI 唯一入口点

## 📖 阅读顺序

Level 1: nexus-os/README.AI.md
Level 2: nexus-os/packages/contracts/src/*.contracts.ts
Level 3: 目标模块的 .ai-context.md
Level 4: 仅在必要时读取实现代码

## 🔄 同步更新规则

| 修改内容 | 必须同步更新 |
|---------|------------|
| nexus-kernel 的消息类型 | contracts/messages.contracts.ts |
| audio-engine 的公共 API | contracts/audio.contracts.ts |
| 新增模块 | 创建 .ai-context.md |
| 删除功能 | 同步删除 contracts 定义 |

## ❌ 禁止事项

- 深层路径导入
- 在 contracts 中导入实现代码
- 修改公共 API 但不同步 contracts

## 📚 条件性阅读

| 情况 | 必须先读 |
|-----|---------|
| 修改架构/新增模块 | docs/ai-rules/architectural.md |
| 处理 API/密钥/权限 | docs/ai-rules/security.md |
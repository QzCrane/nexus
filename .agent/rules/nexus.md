---
trigger: always_on
---
## 📖 阅读顺序
1. README.AI.md (总览)  2. contracts (契约)  3. 目标 .ai-context.md  4. 实现代码

## ⚖️ 架构一致性
修改前必读: docs/cors-data-flow.md

## 🛠 工作流
- 结束任务: /feature-finish
- 新建模块: /new-module
- 发布版本: /release-spectra

## 🔍 条件阅读
- 改架构: docs/ai-rules/architectural.md
- 改状态: docs/cors-data-flow.md
- 改策略: docs/policy-decision.md

## 🚫 绝对严禁
- ❌ 深层路径导入、循环依赖。
- ❌ contracts 引入实现。
- ❌ 绕过数据流架构、残留过期代码。

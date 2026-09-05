---
name: new-module
description: 创建新模块前证明真实 owner 边界、依赖方向、生命周期与验证入口。触发短语:"new module", "create app", "scaffold", "建模块", "新应用"。
---

# New module

- Read [`rules.md`](../../../rules.md), [`nexus/docs/README.md`](../../../nexus/docs/README.md), and neighboring owners.
- Create a module only when an existing owner cannot coherently own the responsibility.
- Define public API, dependency direction, state/lifecycle/failure owner, tests, build connection, and documentation reachability.
- Derive package and toolchain details from current workspace owners; never copy pinned versions or inventories into this skill.

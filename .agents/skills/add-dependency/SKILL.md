---
name: add-dependency
description: 引入、替换或升级依赖时，核实必要性、唯一 owner、当前版本、安全与真实验证。触发短语:"add dependency", "install package", "upgrade package", "加依赖"。
---

# Add dependency

Use this skill as a decision prompt, not a second dependency policy.

- Read [`rules.md`](../../../rules.md), the live manifests, lockfile, owning code, and current package/release scripts.
- Prove the dependency has a real consumer and no platform or existing dependency already owns the capability.
- Verify current official version, license, advisories, compatibility, transitive cost, and production impact.
- Keep one owner and one resolved version unless an unavoidable upstream constraint is evidenced.
- Validate through the repository's current focused and applicable gates; never copy version numbers or command matrices into this skill.

---
name: test
description: 按真实机制选择最小测试，并补足跨上下文、浏览器、生命周期或产物证据。触发短语:"test", "run tests", "跑测试", "e2e"。
---

# Test

- Read live package scripts and select tests by invariant, consumer boundary, failure mode, and execution context.
- Keep tests that protect distinct behavior; merge or remove tests strictly subsumed by a stronger canonical owner.
- Do not weaken assertions, hide retries/skips, or substitute unit/type evidence for browser and production behavior.
- Escalate from focused to applicable closure only after the focused mechanism is understood.

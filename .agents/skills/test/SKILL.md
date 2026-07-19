---
name: test
description: 跑单元测试 + Chrome 端到端测试(Spectra 优先)。触发短语:"test", "run tests", "跑测试"。
license: Proprietary. See LICENSE.txt
compatibility: Requires bun 1.3.14, Chrome 120+ (for e2e)
metadata:
  category: develop
  app: spectra
  phase: execute
  user-invocable: true
allowed-tools: Bash
---

# Run Tests

跑 Spectra 的单元测试 + Chrome e2e。**改完业务逻辑必跑。**

## Trigger

当用户说 "test" / "run tests" / "跑测试" / "跑一下测试" 时自动加载。

## Process

### 1. 单元测试(快速)

```bash
bun run --cwd apps/extension-spectra test:unit
```

> 通常 5-15 秒。**改完单文件用这个**。

### 2. Chrome e2e(慢,真实环境)

```bash
bun run --cwd apps/extension-spectra test:e2e
```

> 跑 Chrome 实例 + Puppeteer,通常 30-60 秒。**改完 audio pipeline / content script 用**。

### 3. Smoke test(发布前)

```bash
bun run --cwd apps/extension-spectra test:smoke
```

> 最快 smoke,验证构建产物可加载。**发布前用**。

## Anti-Rationalization

- "我只改了样式,不用跑测试" → **错**。样式变更可能影响 e2e 选择器。
- "单元测试太慢" → **错**。5-15 秒而已,比手动验证快。
- "e2e 太慢,跳过" → **错**。Spectra 涉及音视频管道,单元测试覆盖不到真实 Chrome 行为。

## Verification

- [ ] test:unit 退出码 0
- [ ] test:e2e 退出码 0(发布前)
- [ ] 无 flaky test 失败(连续跑 2 次都过)

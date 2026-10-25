---
type: explanation
status: stable
audience: developer
last_reviewed: 2026-07-30
---

# AI 编写代码卫生原则

> 主题 owner: AI 与人类协作者在 NEXUS 仓库中编写代码时必须遵守的 14 条卫生规则。
> 完整目录: [engineering/README.md](../engineering/README.md)

本文档汇总 NEXUS 历史上已修复 bug 所沉淀的具体规则，描述代码编写卫生陷阱。

## 1. 异步生命周期 (Async Lifecycle)

- **1.1 `chrome.runtime.onMessage` 必须 `return true`**:
  - *原因*: MV3 SW 异步 `sendResponse` 需保持通道打开。
  - *反例*: `chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => { sendResponse(await work()); });`
  - *正例*: `chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => { work().then(sendResponse); return true; });`
  - *守门*: `ai-pitfall-detector.ts` (`onmessage-async-no-return`)

- **1.2 `init()` 必须返回 cleanup 函数**:
  - *原因*: SW 重启可能多次 init，缺少 cleanup 会导致监听器堆积。
  - *正例*: `export function initService(): () => void { const id = setInterval(tick, 1000); return () => clearInterval(id); }`
  - *守门*: `ai-pitfall-detector.ts` (`listener-leak`)

- **1.3 `setInterval` 必须有上限**:
  - *原因*: 无界轮询浪费 SW 资源与电池。
  - *正例*: `let tryCount = 0; const id = setInterval(() => { if (ready() || ++tryCount >= 30) clearInterval(id); }, 100);`

## 2. 安全 (Security)

- **2.1 外部 URL 必须校验 `isPrivateHost`**:
  - *原因*: 防范 SSRF (`localhost`, `169.254.169.254`, 内网 IP)。
  - *正例*: `import { isPrivateHost } from '../kernel/utils/ssrf-guard.js'; if (isPrivateHost(url.hostname)) throw new Error('SSRF blocked');`
  - *守门*: `ai-pitfall-detector.ts` (`ssrf-fetch`)

- **2.2 用户 HTML 必须经过 `sanitizeHtml`**:
  - *原因*: 防范 XSS（剥离 `<script>`, `on*=`, `javascript:`）。

- **2.3 禁止写入受保护路径**:
  - *守门*: `ai-pre-write-guard.ts` (写时阻断 `docs/_archive/`, `AGENTS.md` 等)

## 3. 契约卫生 (Contract Hygiene)

- **3.1 不得使用 Branded Types**:
  - *原因*: 跨包导入复杂且无运行时含义；使用 `number`/`string` 基础类型。
  - *守门*: `ai-pitfall-detector.ts` (`branded-type-reuse`) / `verify-architecture.ts`

- **3.2 相对路径 TS 导入必须含 `.js` 扩展名**:
  - *正例*: `import { foo } from './foo.js';`
  - *守门*: `verify-architecture.ts` (`checkRelativeImportsHaveJsExtension`)

- **3.3 禁止深路径导入 `@nexus` 包内部**:
  - *原因*: 绕过 `exports` 字段，破坏模块封装；只能使用根/子路径导出。
  - *守门*: `ai-pitfall-detector.ts` (`deep-path-import`) / `verify-architecture.ts`

- **3.4 `messages.contracts.ts` 与 `messages/` 目录已删除**:
  - *原因*: 消息契约必须由唯一 owner 持有；不存在第二个 `messages` 兼容层。
  - *正例*: HALO 的 action map 引用 `packages/contracts/src/actions.ts`；SPECTRA RPC 引用 `packages/contracts/src/spectra.protocol.ts`。
  - *守门*: `check-ai-hygiene.ts` (`deletedRefRe`)。

## 4. 存储安全 (Storage Safety)

- **4.1 存储写入必须 try/catch**:
  - *原因*: 配额超限或 SW 中断会导致 unhandled rejection。
  - *正例*: `await chrome.storage.local.set({ key }).catch((e) => console.warn(e));`
  - *守门*: `ai-pitfall-detector.ts` (`storage-write-uncaught`)

- **4.2 `SerializedQueue` 必须恢复错误**:
  - *原因*: Promise 链拒绝会导致后续任务被无声跳过。
  - *正例*: `opQueue = opQueue.then(fn).catch(() => undefined);`
  - *守门*: `ai-pitfall-detector.ts` (`serialized-queue-broken-chain`)

## 5. 资源生命周期 (Resource Lifecycle)

- **5.1 `addEventListener` 必须有成对 `removeEventListener`**:
  - *守门*: `ai-pitfall-detector.ts` (`listener-leak`)

- **5.2 `Promise.race` 必须配超时**:
  - *正例*: `await Promise.race([promise, timeoutPromise(5000)]);`

## 6. 注册表强制传播 (Registry Force Propagation)

- **6.1 `force` 选项必须贯穿全链路**:
  - *原因*: `actualMode === 'capture'` 时，`force` 必须沿 协议层 → repo → handler → cache → storage 传递。
  - *守门*: `force-propagation.contract.spec.ts`

## 守门汇总

| 规则 | 守门机制 | 级别 |
| --- | --- | --- |
| onmessage-async-no-return | ai-pitfall-detector (写时) | error |
| listener-leak | ai-pitfall-detector (写时) | warn |
| ssrf-fetch | ai-pitfall-detector (写时) | error |
| storage-write-uncaught | ai-pitfall-detector (写时) | error |
| serialized-queue-broken-chain | ai-pitfall-detector (写时) | error |
| branded-type-reuse | ai-pitfall-detector (写时) + verify | error |
| deep-path-import | ai-pitfall-detector (写时) + verify | error |
| missing-js-extension | verify (pre-push) | warn |
| messages.contracts reference | verify (pre-push) | error |
| force propagation | contract test | error |
| init() returns cleanup | code review | info |

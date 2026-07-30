---
type: explanation
status: stable
audience: developer
last_reviewed: 2026-07-30
---

# AI 编写代码卫生原则

> 主题 owner: AI 与人类协作者在 NEXUS 仓库中编写代码时必须遵守的卫生规则。
> 完整目录: [engineering/README.md](../engineering/README.md)
>
> **TL;DR**: 共 14 条代码卫生规则，分 6 组（异步生命周期/安全/契约/存储/资源/注册表强制传播）；每条配反例+正例+守门，守门汇总见文末表格。

本文档汇总 NEXUS 历史上已修复的 bug 所沉淀的具体规则,目标是让 AI agent 在生成代码时主动避开这些陷阱,而不是依赖 review 兜底。与 EPR-001..029 的工程原则互补: EPR 描述架构意图,本文档描述具体的代码卫生。

## 1. 异步生命周期 (Async Lifecycle)

### 1.1 chrome.runtime.onMessage 异步监听必须 return true

- **原则**: 当 `addListener` 回调是 `async` 函数或返回 Promise 时,必须 `return true` 让 Chrome 保持消息通道打开,否则 `sendResponse` 会失败。
- **原因**: MV3 service worker 在监听器返回后立即休眠;不 return true 会导致异步 `sendResponse` 静默丢失。
- **反例**:

```ts
chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  const result = await asyncWork();
  sendResponse(result); // 不会到达
});
```

- **正例**:

```ts
chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  const result = await asyncWork();
  sendResponse(result);
  return true; // 保持通道打开
});
```

- **守门**: `ai-pitfall-detector.ts` 规则 `onmessage-async-no-return`

### 1.2 init() 必须返回 cleanup 函数

- **原则**: 任何 `initXxx()` 函数必须返回一个 cleanup 函数, cleanup 必须移除所有监听器、清空定时器、释放资源。
- **原因**: MV3 service worker 重启后 init 可能被多次调用;不返回 cleanup 会导致监听器堆积。
- **反例**:

```ts
export function initService() {
  chrome.alarms.onAlarm.addListener(handler);
  setInterval(tick, 1000);
  // 没有返回 cleanup
}
```

- **正例**:

```ts
export function initService(): () => void {
  chrome.alarms.onAlarm.addListener(handler);
  const interval = setInterval(tick, 1000);
  return () => {
    chrome.alarms.onAlarm.removeListener(handler);
    clearInterval(interval);
  };
}
```

- **守门**: code review; `ai-pitfall-detector.ts` 规则 `listener-leak`

### 1.3 setInterval 必须有上限

- **原则**: 任何 `setInterval` 必须有最大尝试次数或超时清理。
- **原因**: 永不停止的 setInterval 会持续占用 service worker、消耗电池、掩盖真实失败。
- **反例**:

```ts
const id = setInterval(() => {
  if (document.querySelector('.ready')) clearInterval(id);
}, 100);
```

- **正例**:

```ts
let attempts = 0;
const id = setInterval(() => {
  if (document.querySelector('.ready') || ++attempts >= 30) clearInterval(id);
}, 100);
```

- **守门**: code review

## 2. 安全 (Security)

### 2.1 用户提供的 URL 必须经过 isPrivateHost

- **原则**: 任何 `fetch()`、`XMLHttpRequest`、`new URL()` 接收外部输入 URL 时,必须先调用 `isPrivateHost(hostname)` 拒绝私网地址。
- **原因**: SSRF — 攻击者可通过用户输入访问 `http://localhost`、`http://169.254.169.254`(云元数据)、`http://10.0.0.1` 等内网资源。
- **反例**:

```ts
const resp = await fetch(userUrl);
```

- **正例**:

```ts
import { isPrivateHost } from '../kernel/utils/ssrf-guard';
const url = new URL(userUrl);
if (isPrivateHost(url.hostname)) throw new Error('blocked by SSRF guard');
const resp = await fetch(url);
```

- **守门**: `ai-pitfall-detector.ts` 规则 `ssrf-fetch`

### 2.2 用户 HTML 必须经过 sanitizeHtml

- **原则**: 渲染用户/markdown 输出的 HTML 前,必须经过 `sanitizeHtml()`(剥离 `<script>`、`on*=`、`javascript:`)。
- **原因**: XSS — LLM 返回内容、reader-mode 抓取的网页内容、用户脚本输出都可能注入恶意脚本。
- **守门**: code review

### 2.3 不得写入禁止路径

- **原则**: 不得写入 `docs/_archive/`、`AGENTS.md`、`principles/0[1-5]-*.md` 等等。
- **守门**: `ai-pre-write-guard.ts`(写时阻断)

## 3. 契约卫生 (Contract Hygiene)

### 3.1 不得使用 branded types

- **原则**: 不得重新引入 `TabId`、`VolumeLevel`、`DomainName` 等 branded 类型。使用 `number`/`string` 直接类型。
- **原因**: branded types 在运行时无意义,且导致跨包导入复杂化;已在 Batch G 中删除。
- **守门**: `ai-pitfall-detector.ts` 规则 `branded-type-reuse`; `verify-architecture` 规则 `checkNoBrandedTypes`

### 3.2 相对路径 TS 导入必须有 .js 扩展名

- **原则**: 在 .ts/.tsx 文件中 `import` 相对路径必须以 `.js` 结尾(不是 `.ts`)。
- **原因**: ESM 规范要求显式扩展名;TypeScript 编译到 JS 后运行时找不到模块。
- **反例**:

```ts
import { foo } from './foo';      // ❌
import { bar } from '../utils';   // ❌
```

- **正例**:

```ts
import { foo } from './foo.js';      // ✅
import { bar } from '../utils.js';   // ✅
```

- **守门**: `verify-architecture` 规则 `checkRelativeImportsHaveJsExtension`

### 3.3 不得深路径导入 @nexus 包内部

- **原则**: 不得 `from '@nexus/contracts/src/...'`;只能使用包根导出或子路径导出(如 `@nexus/kernel/storage`)。
- **原因**: 深路径绕过包的 `exports` 字段,破坏封装;重构内部路径会无声破坏调用方。
- **守门**: `ai-pitfall-detector.ts` 规则 `deep-path-import`; `verify-architecture` 规则 `checkNoDeepPathImports`

### 3.4 messages.contracts.ts 已删除

- **原则**: 消息契约现在位于 `packages/contracts/src/messages/index.ts`;不得引用旧路径。
- **守门**: `verify-architecture` 规则 `checkNoDeletedContractsReferences`

## 4. 存储安全 (Storage Safety)

### 4.1 存储写入必须 try/catch

- **原则**: `chrome.storage.*.set()`、`safeStorageSet()` 必须包裹 try/catch 或 `.catch()`。
- **原因**: 存储配额超限、序列化失败、service worker 中断都会让 Promise reject;不捕获会导致 unhandled rejection。
- **反例**:

```ts
chrome.storage.local.set({ key: value });
```

- **正例**:

```ts
try { await chrome.storage.local.set({ key: value }); }
catch (e) { console.warn('storage write failed', e); }
// 或
await chrome.storage.local.set({ key: value }).catch(() => undefined);
```

- **守门**: `ai-pitfall-detector.ts` 规则 `storage-write-uncaught`

### 4.2 SerializedQueue 必须恢复错误

- **原则**: 任何 `queue.then(fn)` 模式的 serialized queue 必须在链尾 `.catch(() => undefined)`,否则一次失败会永久卡住队列。
- **原因**: Promise 链中任意一个 reject 会让后续所有 `.then` 跳过。
- **反例**:

```ts
const result = opQueue.then(() => fn());
opQueue = result; // ❌ 一旦 fn 失败,opQueue 变成 rejected,后续全部跳过
```

- **正例**:

```ts
const result = opQueue.then(() => fn());
opQueue = result.catch(() => undefined); // ✅ 错误被吞掉,链继续
return result;
```

- **守门**: `ai-pitfall-detector.ts` 规则 `serialized-queue-broken-chain`
- **现成实现**: `@nexus/kernel` 的 `createSerializedQueue` / `createKeyedSerializedQueue`

## 5. 资源生命周期 (Resource Lifecycle)

### 5.1 addEventListener 必须有对应 removeEventListener

- **原则**: 每个文件内的 `addEventListener(type, fn)` 必须有对应的 `removeEventListener(type, fn)`。
- **原因**: 监听器泄漏导致内存增长、重复触发、跨页面状态污染。
- **守门**: `ai-pitfall-detector.ts` 规则 `listener-leak`

### 5.2 Promise.race 必须有超时

- **原则**: 任何 `Promise.race([promise, ...])` 中如果 promise 可能永不 resolve,必须包含一个超时 promise。
- **原因**: 等待 invalidation、等待锁释放等场景可能因 bug 永久卡住;超时让系统能恢复。
- **反例**:

```ts
await Promise.race([promise, invalidationPromise]);
```

- **正例**:

```ts
await Promise.race([
  promise,
  invalidationPromise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
]);
```

## 6. 注册表强制传播 (Registry Force Propagation)

### 6.1 force 选项必须贯穿全链路

- **原则**: 当 `actualMode === 'capture'` 时,强制覆盖用户 pinned `direct` 路由的 `force` 选项必须从协议层 → repository → handler → cache → storage 全链路传递。
- **原因**: 任何一层忽略 `force` 都会让用户 pinned `direct` 路由保持不变,导致 capture 模式无法生效。
- **守门**: `force-propagation.contract.spec.ts` 契约测试

## 守门汇总

| 规则 | 守门 | 严重性 |
| --- | --- | --- |
| onmessage-async-no-return | ai-pitfall-detector (写时) | error |
| listener-leak | ai-pitfall-detector (写时) | warn |
| ssrf-fetch | ai-pitfall-detector (写时) | error |
| storage-write-uncaught | ai-pitfall-detector (写时) | error |
| serialized-queue-broken-chain | ai-pitfall-detector (写时) | error |
| branded-type-reuse | ai-pitfall-detector (写时) + verify (pre-push) | error |
| deep-path-import | ai-pitfall-detector (写时) + verify (pre-push) | error |
| missing-js-extension | verify (pre-push) | warn |
| messages.contracts reference | verify (pre-push) | error |
| HALO lint script | verify (pre-push) | error |
| force propagation | contract test | error |
| init() returns cleanup | code review | — |

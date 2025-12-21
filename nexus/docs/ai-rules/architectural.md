# 架构约束

## 依赖方向

```
@nexus/contracts (底层，零依赖)
       ↑
@nexus/kernel ← @nexus/audio-engine
       ↑
extension-spectra (顶层)
```

✅ 允许：上层 → 下层
❌ 禁止：下层 → 上层，循环依赖

## 导入规则

```typescript
// ✅ 正确
import type { AudioConfig } from "@nexus/contracts";
import { createMessenger } from "@nexus/kernel";

// ❌ 禁止
import { x } from "@nexus/kernel/src/internal/...";
```

## 包职责

| 包           | 允许         | 禁止           |
| ------------ | ------------ | -------------- |
| contracts    | 接口、类型   | 实现代码       |
| kernel       | 消息、存储   | 业务逻辑       |
| audio-engine | 音频逻辑     | UI、Chrome API |
| extension    | UI、粘合代码 | 可复用逻辑     |

## 命名规则

- 契约：`*.contracts.ts`
- 类型：`*.types.ts`
- 内部：`internal/` 目录

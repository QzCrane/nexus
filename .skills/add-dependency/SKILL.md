---
name: add-dependency
description: 引入新依赖库的标准流程(查重 + 安装 + 记录 + typecheck)。触发短语:"add dependency", "install package", "加依赖"。
license: Proprietary. See LICENSE.txt
compatibility: Requires bun 1.3.14, PowerShell 7+, git 2.30+
metadata:
  category: develop
  app: all
  phase: execute
  user-invocable: true
allowed-tools: Bash Read Edit Grep WebSearch
---

# Add Dependency

防止 Monorepo 依赖滥用。**先查重,再安装,后记录。**

## Trigger

当用户说 "add dependency" / "install package" / "加依赖" / "装个包" 时自动加载。

## Process

### 1. 查重(强制)

- [ ] 读 [nexus/docs/ai-rules.md](file:///D:/Project/Nexus/nexus/docs/ai-rules.md) 依赖清单。
- [ ] 严禁引入已存在同类库(例: 已有 `lodash` 严禁加 `underscore`)。
- [ ] 搜索 `package.json` 看是否已有等价包(grep workspace)。
- [ ] 检查 transitive dep 列表,看新包是否能由现有包满足。

### 2. 安装(自动执行)

```bash
# Root
bun add <pkg>

# Workspace(如 packages/audio-engine)
bun add <pkg> --cwd [packages|apps]/<ws>

# 验证 workspace 链接
bun install
```

> 在 `nexus/` 根目录执行(根 `package.json` 在那里)。

### 3. 记录(强制,不可跳过)

- [ ] 更新 [nexus/docs/ai-rules.md](file:///D:/Project/Nexus/nexus/docs/ai-rules.md) 依赖清单表格。
- [ ] 日志格式: `| 库名 | 版本 | 精炼用途 | 日期 |`
- [ ] 必要时在 README.AI.md 架构图标注新依赖。

### 4. 类型与检查

- [ ] 必要时安装 `@types/<pkg>`。
- [ ] 运行 typecheck 确认无回归。

```bash
bun run typecheck
```

## Anti-Rationalization

- "这个包很小众,懒得查重" → **错**。Monorepo 同类库重复是最常见的腐烂源。
- "装了再说,记录以后补" → **错**。遗漏的依赖清单会在 3 个月后导致新人装错版本。
- "typecheck 太慢,跳过" → **错**。新包可能引入类型不兼容,5 秒的 typecheck 比 5 小时的 debug 划算。
- "放 workspace 还是 root?" → 优先放具体使用方所在 workspace;只有所有 workspace 都用才放 root。

## Verification

- [ ] `bun install` 成功,无 peer dep 警告
- [ ] `bun run typecheck` 通过
- [ ] `ai-rules.md` 表格已更新
- [ ] git diff 包含 `package.json` + `bun.lock` + `ai-rules.md`

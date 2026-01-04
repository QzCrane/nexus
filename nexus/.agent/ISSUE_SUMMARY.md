# 🛠️ 任务: 恢复后台助手功能

**状态**: 稳定版 @ `481fe0d` (v2.6.2) | 🚫 避免使用 `90d342d`
**目标**: 在"后台助手"分组中显示 4 个全局后台工具 (clipboard, smooth-scroll, userscripts, bilibili-plus) 并显示正确状态。

## 📋 执行计划

### 步骤 1: 修复 `smooth-scroll` 配置

**文件**: `apps/extension-halo/src/tools/smooth-scroll/manifest.json`
**操作**: 将 `activeOnly` 设置为 `false` (约第 11 行)。

```json
"activeOnly": false
```

**命令**: `node scripts/generate-tool-registry.mjs`

### 步骤 2: 修复 `userscripts` 显示逻辑

**文件**: `apps/extension-halo/src/components/sidepanel/hooks/use-categorized-tools.ts`
**操作**: 更新 `system` 工具过滤逻辑，以包含全局后台工具。
**引入**: `import { BACKGROUND_PROFILES_MAP } from "../../../kernel/registry/_generated";`
**逻辑** (在 `if (tool.system)` 块内):

```typescript
if (tool.system) {
  if (settings?.showSystemTools) cats.system.push(tool);

  // 修复: 检查是否为全局后台工具（如 userscripts）并未被标记为仅活跃时运行，是则加入 active 分类
  if (
    backgroundToolIds.includes(tool.id) &&
    !BACKGROUND_PROFILES_MAP[tool.id]?.activeOnly
  ) {
    cats.active.push(tool);
  }
  return;
}
```

### 步骤 3: 验证

**命令**: `pnpm --filter extension-halo build`
**检查清单**:

- [ ] "后台助手" 分组可见。
- [ ] 包含: clipboard, smooth-scroll, userscripts, bilibili-plus。
- [ ] 状态指示灯 (绿/灰) 工作正常。
- [ ] 设置 -> "显示系统工具" 不会破坏逻辑。

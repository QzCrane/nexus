# 依赖库

## chrome-types

Chrome Extension API 类型，直接使用 `chrome.*` 命名空间。

常用：`chrome.tabs`, `chrome.runtime`, `chrome.storage`, `chrome.action`

## pnpm workspace

```bash
pnpm install          # 安装
pnpm build            # 构建全部
pnpm --filter @nexus/kernel build  # 单包构建
```

包引用：`"@nexus/contracts": "workspace:*"`

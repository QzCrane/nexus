# 安全红线

## 密钥处理

```typescript
// ❌ 禁止
const API_KEY = 'sk-1234...';

// ✅ 正确
const API_KEY = import.meta.env.VITE_API_KEY;
```

## 数据脱敏

| 数据 | 处理 |
|-----|-----|
| URL | 移除查询参数 |
| 用户ID | 仅保留前4位 |
| 音频配置 | 可完整记录 |

## Chrome 权限

```json
{
  "permissions": ["storage", "activeTab", "scripting", "offscreen"]
}
```

禁止请求：tabs, history, bookmarks, webRequest

## CSP

❌ 禁止：eval, new Function, 内联脚本

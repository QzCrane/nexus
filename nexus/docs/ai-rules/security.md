# 安全红线

**核心**: 零硬编码，最小权限。

1. **凭证**: 严禁硬编码 Key/Token，必须使用环境变量或 `import.meta.env`。
2. **脱敏**: 日志脱敏敏感 URL 查询参数与用户信息。
3. **权限**: 仅限 `storage`, `scripting`, `offscreen`。
4. **禁止**: 请求 `history`, `bookmarks` 等高危 API 或使用 `eval`/内联脚本。

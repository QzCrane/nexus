# 安全红线

**核心**: 零硬编码，最小权限。

- 凭证: 禁止硬编码 Key/Token，用 import.meta.env
- 脱敏: 日志脱敏 URL 参数与用户信息
- 权限: 仅 storage / scripting / offscreen
- 禁止: history / bookmarks / eval / 内联脚本

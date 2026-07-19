---
type: explanation
status: draft
audience: developer
---

# HALO 功能差距分析 (竞品对标)

> 目标: 秒杀全网竞品

## JSON Formatter

✅ 已有: 格式化/压缩 | 语法验证 | 缩进 2/4 | 键排序 | 统计
❌ 缺失: Tree View(可折叠) | JSONPath 查询 | JSON→CSV/YAML/XML | URL/文件导入 | Diff 对比 | 错误行高亮

## Hash Generator

✅ 已有: MD5/SHA-1/256/512 | 文本/文件哈希 | 大小写 | 同时显示全部
❌ 缺失: HMAC(带密钥) | SHA-3 系列 | 哈希验证比对 | CRC32 | 批量文件

## Base64

✅ 已有: 编解码 | URL-safe | 文件转换 | 自动检测方向
❌ 缺失: 图片预览 | Data URI 解析 | 解码 → 文件下载

## QR Code

✅ 已有: 生成/扫描 | 剪贴板 | 历史 | 下载 PNG | 纠错级别
❌ 缺失: Logo 嵌入 | 颜色自定义 | 批量生成 | SVG 导出 | vCard/WiFi 模板

## Timestamp

✅ 已有: 实时时钟 | Unix 秒/毫秒 | ISO8601 | UTC/本地 | 相对时间
❌ 缺失: 时区列表 | 日期计算器 | 自定义 strftime | 工作日计算

## URL Encoder

✅ 已有: 编解码 | URL 解析 | 同时显示
❌ 缺失: Query String Builder | URL 验证

## 待检查

UUID: v1/v4/v5 | 批量 | GUID 格式 | Nil | 命名空间 v5
Regex: 实时高亮 | 捕获组 | 替换预览 | 多语言风格 | 快速插入 | 正则解释
Color: HEX/RGB/HSL/CMYK | 调色板 | WCAG 对比度 | 渐变生成器 | 历史 | 页面取色
Password: 长度滑块 | 字符类型 | 排除相似 | 强度指示 | 批量 | 可读密码

## 优先级

P0(必须): JSON Tree+JSONPath | Hash HMAC+验证 | QR 颜色+Logo | Color WCAG
P1(应该): Base64 图片预览 | Password 强度 | Regex 解释 | Timestamp 时区
P2(可选): JSON Diff | UUID v5 命名空间 | 批量处理

# 统一规则索引

`2026-01-09` | `unified-rules-index.txt` | **归一化域**: ~1192

## 格式

`Domain:HZ:PS_LineNums:IM_LineNums`

- **HZ**: 计数/#
- **PS/IM**: 行号列表/# (逗号分隔)

## 统计 (100% 覆盖)

- **HZ**: 396 (`.js`) @ `reference/hoverzoom-plus/plugins/`
- **PS**: 168 (正则) @ `reference/photoshow/source/background.js`
- **IM**: 823 (Sieve) @ `reference/imagus-reborn/src/data/sieve.json`

> **注**: 因单行含多规则，规则总数 > 文件行数。

## 工具

- **提取**: `extract-{hz,imagus}.js` (源码 -> list.txt)
- **生成**: `node reference/process_rules_final.js` (归一化+合并)
- **验证**: `node reference/verify_deep_v3.js` (逆向检查+统计)

## 文档

- `hover-zoom-integration-plan.md`: 架构设计与竞品分析
- `RULE_INDEX.md`: 本索引

## 用法

1. 打开 `unified-rules-index.txt`。
2. 搜索域名。
3. 通过行号定位源 (HZ:文件名, PS/IM:源文件行号)。

---
description: 功能开发完成后的标准交付流程（测试 + 文档 + 双仓库提交）
---

# Feature Finish Workflow

// turbo-all

## 1. 验证构建

```bash
pnpm build
```

## 2. 提交私有仓库

```bash
git add -A
git commit -m "<type>(<scope>): <description>"
git push origin main
```

## 3. 同步公开仓库

```bash
pnpm sync-public
```

## 4. 推送公开仓库

```bash
cd ../nexus-public
git push -f origin main
cd ../nexus
```

---

**Commit 类型**: feat | fix | refactor | docs | chore | test
**语言要求**: commit 消息必须英文

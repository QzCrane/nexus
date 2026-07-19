// lint-staged — NEXUS staged 文件质量门
// Docs: https://github.com/lint-staged/lint-staged
//
// 只对即将提交的文件跑 lint,改一行触发一行检查,秒级反馈。
// 与 lefthook.yml 的 pre-commit 命令保持职责分明:
//   - lefthook: 全局 pre-commit 守门(单一源)
//   - lint-staged: 不直接配在这里,改由 lefthook 调度,避免重复

module.exports = {
	// lint-staged 在 lefthook 内显式调度,这里只保留配置样例以备工具直接调用
	"*.md": ["bun scripts/lint-docs.mjs"],
	"*.{ts,tsx,js,jsx,mjs,cjs,json}": [
		"biome check --no-errors-on-unmatched --max-diagnostics=50",
	],
};

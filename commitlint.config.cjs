// commitlint — NEXUS 提交信息规范
// Docs: https://commitlint.js.org
//
// 强制 Conventional Commits:
//   <type>(<scope>): <subject>
//   <body>
//   <footer>
//
// 允许的 type: feat, fix, refactor, perf, docs, test, build, ci, chore, style, revert

module.exports = {
	extends: ["@commitlint/config-conventional"],
	rules: {
		"type-enum": [
			2,
			"always",
			[
				"feat",
				"fix",
				"refactor",
				"perf",
				"docs",
				"test",
				"build",
				"ci",
				"chore",
				"style",
				"revert",
			],
		],
		"scope-enum": [
			2,
			"always",
			[
				"spectra",
				"halo",
				"contracts",
				"kernel",
				"audio-engine",
				"ui-kit",
				"tools",
				"scripts",
				"ci",
				"docs",
				"deps",
				"monorepo",
			],
		],
		"subject-case": [2, "always", "lower-case"],
		"subject-max-length": [2, "always", 72],
		"body-max-line-length": [2, "always", 100],
		"footer-max-line-length": [2, "always", 100],
	},
};

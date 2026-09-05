# NEXUS project skills

`.agents/skills/` is a lightweight task-routing layer. Skills provide prompts for judgment; they do not duplicate repository policy, tool versions, command matrices, architecture, or release procedures.

- [`../../rules.md`](../../rules.md) owns repository policy and toolchain constraints.
- [`../../nexus/docs/README.md`](../../nexus/docs/README.md) owns documentation routing.
- Live manifests and maintained scripts own versions and executable workflows.
- Each skill identifies when it applies, which current owner to read, and which failure boundaries deserve attention.

Edit a skill only when its trigger or judgment boundary changes. Then run the live `sync:skills` owner and inspect the generated table in [`../../AGENTS.md`](../../AGENTS.md). Do not create another skill index or copy dynamic facts into skill prose.

#!/usr/bin/env node
/**
 * sync-skills.mjs — NEXUS skill sync engine
 *
 * Single source of truth: `<repo>/.agents/skills/<name>/SKILL.md`
 *
 * Why `.agents/skills/`:
 *   `.agents/skills/` is the cross-tool loader path adopted in 2026 by
 *   Cursor, OpenAI Codex, GitHub Copilot, Gemini CLI, Cline, OpenCode,
 *   and Pi (per https://agentskills.io/ and the OpenAI Skills catalog at
 *   https://github.com/openai/skills). Reading the source from this very
 *   path means those 6+ tools discover skills with zero sync work.
 *
 * Outputs (idempotent; safe to re-run any time):
 *   - `<repo>/.claude/skills/<name>/SKILL.md`     (Claude Code only — has
 *                                                  its own loader path; not
 *                                                  shared with the .agents
 *                                                  ecosystem)
 *   - `<repo>/.agent/workflows/<name>.md`         (Antigravity / TRAE;
 *                                                  body rewritten to inject
 *                                                  `// turbo` before each
 *                                                  bash code block, since
 *                                                  only Antigravity honours
 *                                                  that directive)
 *   - `<repo>/AGENTS.md` § Project Skills         (table injected between
 *                                                  `<!-- nexus:skills-start -->`
 *                                                  and `<!-- nexus:skills-end -->`;
 *                                                  CLAUDE.md is a hardlink to
 *                                                  AGENTS.md, so both stay in
 *                                                  sync automatically)
 *
 * Why only two output formats (vs the previous three):
 *   - .agents/skills/  — already the source, so Cursor / Codex / Copilot /
 *                          Gemini / Cline / OpenCode see it natively
 *   - .claude/skills/   — Claude Code's unique loader (not shared)
 *   - .agent/workflows/ — Antigravity / TRAE's `// turbo` workflow system
 *
 * History: previously the source lived at `.skills/` and the script
 * mirrored to `.codex/skills/` as well. After OpenAI moved Codex to
 * `.agents/skills/` (mid-2026), that mirror became dead weight.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');   // nexus/scripts/ → nexus/ → repo
const skillsSrc = join(repoRoot, '.agents', 'skills');  // ← source = the cross-tool standard path
const claudeOut = join(repoRoot, '.claude', 'skills');
const agentOut = join(repoRoot, '.agent', 'workflows');
const agentsMd = join(repoRoot, 'AGENTS.md');

// --- Frontmatter parsing (no external deps) --------------------------------

/**
 * Split a SKILL.md into its raw frontmatter text + a flat scalar dict + body.
 *
 * We preserve the raw frontmatter string verbatim (do NOT parse-and-rebuild)
 * because nested keys like `metadata:\n  category: ...` would be flattened
 * by a naive map. The flat dict only holds top-level scalar values, used
 * by the index row / Antigravity frontmatter where we only need `name` and
 * `description`.
 *
 * @param {string} raw
 * @returns {{ rawFrontmatter: string, frontmatter: Record<string,string>, body: string }}
 */
function splitFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error('Missing YAML frontmatter (must start with ---)');
  const rawFrontmatter = m[1];
  const fm = {};
  for (const line of rawFrontmatter.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    // Only top-level (non-indented) `key: value` lines become flat entries.
    if (!/^[A-Za-z0-9_-]+:\s/.test(line)) continue;
    const idx = line.indexOf(':');
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    fm[key] = val;
  }
  return { rawFrontmatter, frontmatter: fm, body: m[2] };
}

// --- Output builders --------------------------------------------------------

/**
 * Build Antigravity/TRAE workflow file: injects `// turbo` before every bash
 * code block so the IDE auto-runs them. Only Antigravity honours this; the
 * raw body goes to Claude untouched.
 */
function buildAntigravityWorkflow(name, fm, body) {
  const desc = (fm.description || '').split('\n')[0].trim().slice(0, 240);
  const withTurbo = injectTurbo(body);
  return `---\ndescription: ${desc}\n---\n\n${withTurbo.trim()}\n`;
}

/**
 * Insert `// turbo` (or `// turbo-all` for the first block in the body)
 * immediately before every ```bash fenced code block. Preserves
 * indentation, leaves other code-block languages alone.
 */
function injectTurbo(body) {
  let firstSeen = false;
  return body.replace(/^```bash\s*$/gm, () => {
    const tag = firstSeen ? '// turbo' : '// turbo-all';
    firstSeen = true;
    return `${tag}\n\n\`\`\`bash`;
  });
}

/**
 * Build a table row for the § Project Skills index injected into AGENTS.md.
 */
function buildIndexRow(name, fm) {
  const desc = (fm.description || '').split('触发短语')[0].trim().slice(0, 80);
  const triggers = (fm.description || '').match(/触发短语[:：]?\s*([^。\n]+)/);
  const triggerText = triggers ? triggers[1].trim().replace(/[""「」]/g, '') : '';
  return `| \`${name}\` | ${desc} | ${triggerText} |`;
}

// --- File writers -----------------------------------------------------------

/** Mirror `<repo>/.agents/skills/<name>/SKILL.md` into `<out>/<name>/SKILL.md`. */
function writeSkillMirror(name, body) {
  const dir = join(claudeOut, name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), body);
}

/** Write Antigravity workflow file (transforms to .md with // turbo injected). */
function writeAntigravityWorkflow(name, content) {
  const path = join(agentOut, `${name}.md`);
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/**
 * Inject (or replace) the § Project Skills table in AGENTS.md between the
 * `<!-- nexus:skills-start -->` and `<!-- nexus:skills-end -->` markers.
 * Idempotent: re-running updates the table in place.
 */
function injectSkillsIndex(rows) {
  if (!existsSync(agentsMd)) {
    console.warn(`[sync-skills] ${agentsMd} not found — skipping AGENTS.md injection`);
    return;
  }
  const raw = readFileSync(agentsMd, 'utf-8');
  const start = '<!-- nexus:skills-start -->';
  const end = '<!-- nexus:skills-end -->';
  const startIdx = raw.indexOf(start);
  const endIdx = raw.indexOf(end);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    console.warn(`[sync-skills] AGENTS.md missing nexus:skills markers — skipping injection`);
    return;
  }
  const table = [
    '| Skill | Description | Triggers |',
    '|---|---|---|',
    ...rows,
  ].join('\n');
  const before = raw.slice(0, startIdx + start.length);
  const after = raw.slice(endIdx);
  const next = `${before}\n${table}\n${after}`;
  writeFileSync(agentsMd, next);
}

// --- Cleanup: remove stale outputs whose source no longer exists -------------

function pruneStaleOutputs(presentNames) {
  if (existsSync(claudeOut)) {
    for (const name of readdirSync(claudeOut)) {
      if (name === 'gitnexus') continue;  // GitNexus-managed; do not touch
      if (!presentNames.includes(name)) {
        rmSync(join(claudeOut, name), { recursive: true, force: true });
        console.log(`[sync-skills] Pruned stale skill dir: ${claudeOut}/${name}`);
      }
    }
  }
  if (existsSync(agentOut)) {
    for (const f of readdirSync(agentOut)) {
      if (!f.endsWith('.md')) continue;
      const name = f.replace(/\.md$/, '');
      if (!presentNames.includes(name)) {
        rmSync(join(agentOut, f), { force: true });
        console.log(`[sync-skills] Pruned stale workflow: ${agentOut}/${f}`);
      }
    }
  }
}

// --- Main -------------------------------------------------------------------

function listSkillNames() {
  if (!existsSync(skillsSrc)) {
    throw new Error(`Skills source dir missing: ${skillsSrc}`);
  }
  return readdirSync(skillsSrc).filter((d) => {
    const full = join(skillsSrc, d);
    return statSync(full).isDirectory() && existsSync(join(full, 'SKILL.md'));
  });
}

function main() {
  const names = listSkillNames();
  if (names.length === 0) {
    console.warn(`[sync-skills] No skills found in ${skillsSrc}`);
    return;
  }
  console.log(`[sync-skills] Found ${names.length} skill(s) from ${skillsSrc}:`);
  for (const n of names) console.log(`  - ${n}`);

  const indexRows = [];
  for (const name of names) {
    const raw = readFileSync(join(skillsSrc, name, 'SKILL.md'), 'utf-8');
    const { rawFrontmatter, frontmatter, body } = splitFrontmatter(raw);

    // 1. Mirror verbatim to .claude/skills/ (Claude Code only).
    //    Use the raw frontmatter string so nested blocks (`metadata:`, etc.)
    //    are preserved exactly as authored.
    const full = `---\n${rawFrontmatter}\n---\n\n${body.trim()}\n`;
    writeSkillMirror(name, full);

    // 2. Generate .agent/workflows/<name>.md with // turbo injected
    writeAntigravityWorkflow(name, buildAntigravityWorkflow(name, frontmatter, body));

    // 3. Collect index row
    indexRows.push(buildIndexRow(name, frontmatter));
  }

  // 4. Inject index into AGENTS.md
  injectSkillsIndex(indexRows);

  // 5. Prune stale outputs
  pruneStaleOutputs(names);

  console.log(`[sync-skills] Done. ${names.length} skill(s) synced.`);
  console.log(`  source:  ${skillsSrc}  (native loader for Cursor / Codex / Copilot / Gemini / Cline / OpenCode)`);
  console.log(`  mirror:  ${claudeOut}  (Claude Code only)`);
  console.log(`  output:  ${agentOut}  (TRAE / Antigravity workflows with // turbo)`);
  console.log(`  inject:  ${agentsMd} (§ Project Skills table)`);
}

main();

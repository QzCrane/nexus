#!/usr/bin/env node
/**
 * sync-skills.mjs — NEXUS skill index injector
 *
 * Single source of truth: `<repo>/.agents/skills/<name>/SKILL.md`
 *
 * Why `.agents/skills/`:
 *   `.agents/skills/` is the cross-tool loader path adopted in 2026 by
 *   Cursor, OpenAI Codex, GitHub Copilot, Gemini CLI, Cline, OpenCode,
 *   Amp, Kimi, Replit (per https://agentskills.io/ and the OpenAI Skills
 *   catalog at https://github.com/openai/skills). Reading the source
 *   from this very path means those 6+ tools discover skills with zero
 *   sync work.
 *
 * Outputs (idempotent; safe to re-run any time):
 *   - `<repo>/AGENTS.md` § Project Skills index
 *     (table injected between `<!-- nexus:skills-start -->` and
 *      `<!-- nexus:skills-end -->`; CLAUDE.md is a hardlink to
 *      AGENTS.md, so both stay in sync automatically)
 *
 * History:
 *   - 2026-05: original mirror to `.skills/` source.
 *   - 2026-06: source moved to `.agents/skills/`; mirrored to
 *              `.claude/skills/`, `.codex/skills/`, `.agent/workflows/`.
 *   - 2026-07: dropped all three mirrors. `.agents/skills/` is the
 *              native loader for 6+ modern tools; Claude Code /
 *              Antigravity / TRAE users maintain their own global
 *              skills in `~/.claude/skills/` and `~/.agent/skills/`
 *              respectively. The script now only refreshes the
 *              AGENTS.md index table.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');   // nexus/scripts/ → nexus/ → repo
const skillsSrc = join(repoRoot, '.agents', 'skills');
const agentsMd = join(repoRoot, 'AGENTS.md');

// --- Frontmatter parsing (no external deps) --------------------------------

/**
 * Split a SKILL.md into its raw frontmatter text + a flat scalar dict + body.
 *
 * We preserve the raw frontmatter string verbatim (do NOT parse-and-rebuild)
 * because nested keys like `metadata:\n  category: ...` would be flattened
 * by a naive map. The flat dict only holds top-level scalar values, used
 * by the index row where we only need `name` and `description`.
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

// --- AGENTS.md index injection ---------------------------------------------

/**
 * Build a table row for the § Project Skills index injected into AGENTS.md.
 * Pulls description (everything before the 触发短语 marker) and trigger
 * phrases (the part after 触发短语) from the SKILL.md frontmatter.
 */
function buildIndexRow(name, fm) {
  const desc = (fm.description || '').split('触发短语')[0].trim().slice(0, 80);
  const triggers = (fm.description || '').match(/触发短语[:：]?\s*([^。\n]+)/);
  const triggerText = triggers ? triggers[1].trim().replace(/[""「」]/g, '') : '';
  return `| \`${name}\` | ${desc} | ${triggerText} |`;
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

// --- Main ------------------------------------------------------------------

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
    const { frontmatter } = splitFrontmatter(raw);
    indexRows.push(buildIndexRow(name, frontmatter));
  }

  injectSkillsIndex(indexRows);

  console.log(`[sync-skills] Done. ${names.length} skill(s) indexed into AGENTS.md.`);
  console.log(`  source: ${skillsSrc}  (native loader for Cursor / Codex / Copilot / Gemini / Cline / OpenCode / Amp / Kimi / Replit)`);
  console.log(`  inject: ${agentsMd} (§ Project Skills table)`);
}

main();

#!/usr/bin/env node
/**
 * sync-skills.ts — NEXUS skill index injector
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
 *      `<!-- nexus:skills-end -->`)
 *
 * History:
 *   - 2026-05: original mirror to `.skills/` source.
 *   - 2026-06: source moved to `.agents/skills/`; mirrored to
 *              `.codex/skills/`, `.agent/workflows/`.
 *   - 2026-07: dropped all mirrors. `.agents/skills/` is the
 *              native loader for 6+ modern tools; Antigravity / TRAE
 *              users maintain their own global skills in
 *              `~/.agent/skills/` respectively. The script now only
 *              refreshes the AGENTS.md index table.
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
  const desc = (fm.description || '').split('触发短语')[0].trim();
  const triggers = (fm.description || '').match(/触发短语[:：]?\s*([^。\n]+)/);
  const triggerText = triggers ? triggers[1].trim().replace(/[""「」]/g, '') : '';
  return `| \`${name}\` | ${desc} | ${triggerText} |`;
}

/**
 * Render the § Project Skills table in AGENTS.md between the
 * `<!-- nexus:skills-start -->` and `<!-- nexus:skills-end -->` markers.
 */
function renderSkillsIndex(raw, rows) {
  const start = '<!-- nexus:skills-start -->';
  const end = '<!-- nexus:skills-end -->';
  const startIdx = raw.indexOf(start);
  const endIdx = raw.indexOf(end);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    throw new Error('AGENTS.md is missing ordered nexus:skills markers');
  }
  const table = [
    '| Skill | Description | Triggers |',
    '|---|---|---|',
    ...rows,
  ].join('\n');
  const before = raw.slice(0, startIdx + start.length);
  const after = raw.slice(endIdx);
  return `${before}\n${table}\n${after}`;
}

/**
 * Update one generated index or, in check mode, fail without writing when it
 * has drifted. The file path is injectable so the no-write behavior can be
 * covered without touching the repository copy.
 */
function syncIndexFile(filePath, rows, checkOnly = false) {
  if (!existsSync(filePath)) {
    throw new Error(`AGENTS.md not found: ${filePath}`);
  }

  const raw = readFileSync(filePath, 'utf-8');
  const next = renderSkillsIndex(raw, rows);
  if (next === raw) return 'current';
  if (checkOnly) {
    throw new Error('Project Skills index drifted; run `bun run sync:skills` and commit the result');
  }

  writeFileSync(filePath, next);
  return 'updated';
}

// --- Main ------------------------------------------------------------------

function parseArguments(args) {
  const unknown = args.filter((argument) => argument !== '--check');
  if (unknown.length > 0 || args.filter((argument) => argument === '--check').length > 1) {
    throw new Error('Usage: bun scripts/sync-skills.ts [--check]');
  }
  return { checkOnly: args.includes('--check') };
}

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
  const { checkOnly } = parseArguments(process.argv.slice(2));
  const names = listSkillNames();
  if (names.length === 0) {
    throw new Error(`No skills found in ${skillsSrc}`);
  }

  const indexRows = [];
  for (const name of names) {
    const raw = readFileSync(join(skillsSrc, name, 'SKILL.md'), 'utf-8');
    const { frontmatter } = splitFrontmatter(raw);
    indexRows.push(buildIndexRow(name, frontmatter));
  }

  const state = syncIndexFile(agentsMd, indexRows, checkOnly);
  console.log(`[sync-skills] ${names.length} skill(s); AGENTS.md index ${state}`);
}

if (import.meta.main) main();

export {
  buildIndexRow,
  parseArguments,
  renderSkillsIndex,
  splitFrontmatter,
  syncIndexFile,
};

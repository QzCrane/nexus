#!/usr/bin/env node
/**
 * lint-docs.mjs — NEXUS Diátaxis documentation linter
 *
 * Enforces that every NEXUS project documentation file (and every
 * application-level document) carries a Diátaxis frontmatter block at
 * the top. Diátaxis (https://diataxis.fr/) is the 4-quadrant writing
 * protocol adopted by the NEXUS engineering rules:
 *
 *   type: tutorial     | user is LEARNING (acquisition + action)
 *   type: how-to       | user is DOING a task (application + action)
 *   type: reference    | user is LOOKING UP facts (application + cognition)
 *   type: explanation  | user is UNDERSTANDING (acquisition + cognition)
 *
 * The rule: a document MUST belong to exactly one type. Mixing two
 * types in one file is the #1 cause of confusing documentation.
 *
 * Usage:
 *   bun scripts/lint-docs.mjs                       # lint all known doc dirs
 *   bun scripts/lint-docs.mjs --path apps/extension-spectra/docs
 *   bun scripts/lint-docs.mjs --strict              # treat warnings as errors
 *
 * Exit code 0 on clean; 1 on any error.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

const VALID_TYPES = new Set(['tutorial', 'how-to', 'reference', 'explanation']);
const VALID_STATUS = new Set(['stable', 'draft', 'deprecated', 'archived']);

/** Default roots to scan, relative to repoRoot. */
const DEFAULT_DOC_ROOTS = [
  'nexus/docs',
  'nexus/apps/extension-spectra/docs',
  'nexus/apps/extension-halo/docs',
];

/** Paths that exist but should be ignored (history / archive). */
const IGNORE_PATTERNS = [
  /development-sync-/i,
  /optimization-review-/i,
  /regression-recovery-/i,
  /market-research-/i,
];

/** Files inside these directories are always ignored. */
const ALWAYS_IGNORE_DIRS = new Set([
  '_archive',
  'store-listings',
  'public',
  'node_modules',
  '.turbo',
  'dist',
  'build',
]);

/**
 * Parse YAML frontmatter (very small subset — only the keys we use).
 * Same raw-preservation philosophy as sync-skills.mjs: we never rebuild
 * the frontmatter, we just extract scalar values for validation.
 *
 * @param {string} raw
 * @returns {{ fm: Record<string,string>, body: string, present: boolean }}
 */
function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: raw, present: false };
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    fm[key] = val;
  }
  return { fm, body: m[2], present: true };
}

/**
 * Recursively list *.md files under `root`, skipping ALWAYS_IGNORE_DIRS
 * and any path matching IGNORE_PATTERNS.
 *
 * @param {string} root
 * @returns {string[]}
 */
function listMarkdown(root) {
  if (!existsSync(root)) return [];
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (ALWAYS_IGNORE_DIRS.has(name)) continue;
      const full = join(dir, name);
      const s = statSync(full);
      if (s.isDirectory()) walk(full);
      else if (s.isFile() && name.endsWith('.md')) out.push(full);
    }
  };
  walk(root);
  return out.filter((f) => !IGNORE_PATTERNS.some((re) => re.test(f)));
}

/**
 * Lint a single file. Returns a list of issue strings (empty = clean).
 * @param {string} file
 */
function lintFile(file) {
  const issues = [];
  const raw = readFileSync(file, 'utf-8');
  const { fm, present } = parseFrontmatter(raw);

  if (!present) {
    issues.push('missing frontmatter (must start with `---`)');
    return issues;
  }

  // Required: type
  if (!fm.type) {
    issues.push("missing required `type` (tutorial|how-to|reference|explanation)");
  } else if (!VALID_TYPES.has(fm.type)) {
    issues.push(`invalid type "${fm.type}" (must be one of: ${[...VALID_TYPES].join(', ')})`);
  }

  // Recommended: status
  if (!fm.status) {
    issues.push("missing recommended `status` (stable|draft|deprecated|archived)");
  } else if (!VALID_STATUS.has(fm.status)) {
    issues.push(`invalid status "${fm.status}" (must be one of: ${[...VALID_STATUS].join(', ')})`);
  }

  // Optional but warn if present and invalid
  if (fm.audience) {
    const validAudience = ['all', 'developer', 'reviewer', 'contributor', 'user'];
    if (!validAudience.includes(fm.audience)) {
      issues.push(`invalid audience "${fm.audience}" (one of: ${validAudience.join(', ')})`);
    }
  }

  return issues;
}

// --- CLI --------------------------------------------------------------------

function parseArgs(argv) {
  const args = { paths: [], strict: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--path') args.paths.push(argv[++i]);
    else if (a === '--strict') args.strict = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: bun scripts/lint-docs.mjs [--path <dir> ...] [--strict]');
      process.exit(0);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const roots = args.paths.length > 0
    ? args.paths.map((p) => resolve(p))
    : DEFAULT_DOC_ROOTS.map((p) => join(repoRoot, p));

  let files = [];
  for (const r of roots) {
    files = files.concat(listMarkdown(r));
  }
  files = [...new Set(files)].sort();

  if (files.length === 0) {
    console.log('[lint-docs] No markdown files found in:');
    for (const r of roots) console.log(`  - ${relative(repoRoot, r)}`);
    return;
  }

  console.log(`[lint-docs] Scanning ${files.length} file(s):`);
  let errorCount = 0;
  let warnCount = 0;
  const byType = {};

  for (const f of files) {
    const issues = lintFile(f);
    if (issues.length === 0) {
      const { fm } = parseFrontmatter(readFileSync(f, 'utf-8'));
      byType[fm.type] = (byType[fm.type] || 0) + 1;
      continue;
    }
    const isMissingFrontmatter = issues[0].startsWith('missing frontmatter');
    const isError = isMissingFrontmatter || args.strict;
    if (isError) errorCount++; else warnCount++;
    const tag = isError ? 'ERROR' : 'WARN ';
    console.log(`  ${tag} ${relative(repoRoot, f)}`);
    for (const i of issues) console.log(`         - ${i}`);
  }

  console.log(`\n[lint-docs] Summary:`);
  console.log(`  scanned: ${files.length}`);
  console.log(`  by type:`);
  for (const t of [...VALID_TYPES].sort()) {
    if (byType[t]) console.log(`    ${t.padEnd(12)} ${byType[t]}`);
  }
  console.log(`  errors:  ${errorCount}`);
  console.log(`  warnings:${warnCount}${args.strict ? ' (strict mode → warnings as errors)' : ''}`);

  process.exit(errorCount > 0 ? 1 : 0);
}

main();

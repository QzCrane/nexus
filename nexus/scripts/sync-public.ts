#!/usr/bin/env node

/**
 * Generate an application-specific public repository from the private NEXUS
 * workspace while preserving the destination repository's own Git history.
 *
 * Usage: bun scripts/sync-public.ts <spectra|halo> [--amend]
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Keep in sync with scripts/toolchain-versions.ts.
const BUN_VERSION = '1.3.14';
const PACKAGE_MANAGER = `bun@${BUN_VERSION}`;
const SUPPORTED_APPS = new Set(['spectra', 'halo']);
const PUBLIC_TURBO_CACHE_DIR = 'node_modules/.cache/turbo-public-sync';
const PUBLIC_VALIDATION_SCRIPTS = ['lint', 'typecheck', 'build'];

function parseArguments(args) {
  const [target, ...options] = args;
  const unknownOptions = options.filter((option) => option !== '--amend');
  if (!SUPPORTED_APPS.has(target) || unknownOptions.length > 0) {
    throw new Error('Usage: bun scripts/sync-public.ts <spectra|halo> [--amend]');
  }
  return {
    targetApp: target,
    amend: options.includes('--amend'),
  };
}

const invocation = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
  ? parseArguments(process.argv.slice(2))
  : { targetApp: undefined, amend: false };
const { targetApp, amend } = invocation;

const sourceRoot = path.resolve(__dirname, '..');
const destinationRoot = process.env.SYNC_PUBLIC_DEST
  ? path.resolve(process.env.SYNC_PUBLIC_DEST)
  : path.resolve(__dirname, `../../${targetApp}-public`);

const BASE_EXCLUDES = [
  '.agent',
  '.agents',
  '.changeset',
  '.codex',
  '.git',
  '.github',
  '.gitnexus',
  '.graph-it',
  '.idea',
  '.turbo',
  '.vscode',
  'AGENTS.md',
  'docs',
  '/scripts',
  'store-assets',
  'store-listings',
  'test',
  'plan.md',
  'node_modules',
  'dist',
  'build',
  '*.log',
  '*.tsbuildinfo',
  '*.zip',
];

const APP_CONFIGS = {
  spectra: {
    applicationPath: 'apps/extension-spectra',
    excludes: [
      'apps/extension-halo',
      'apps/extension-cortex',
      'apps/extension-spectra/assets',
      'apps/extension-spectra/assets-backup',
      'apps/extension-spectra/plan.md',
      'apps/extension-spectra/release',
      'packages/features/ai-engine',
      'packages/ui-kit',
    ],
    publicName: 'spectra',
    publicRootFiles: [
      'scripts/check-workspace-lint.ts',
      'scripts/run-lint-parallel.ts',
      'scripts/run-strict-biome.ts',
    ],
    publicRootScripts: ['dev', 'build', 'typecheck'],
    publicRootScriptOverrides: {
      lint: 'bun scripts/run-lint-parallel.ts --public',
    },
    publicApplicationScripts: [
      'dev',
      'build',
      'build:prod',
      'build:dev',
      'build:sourcemap',
      'build:analyze',
      'integrity',
      'typecheck',
    ],
    publicApplicationScriptOverrides: {
      lint: 'bun ../../scripts/run-strict-biome.ts .',
    },
    publicApplicationScriptFiles: [
      'apps/extension-spectra/scripts/check-production-artifacts.ts',
      'apps/extension-spectra/scripts/chrome120-webrtc-adapter.ts',
      'apps/extension-spectra/scripts/i18n-assets.ts',
      'apps/extension-spectra/scripts/minification-policy.ts',
    ],
    publicApplicationDevDependencies: [
      'chrome-types',
      'esbuild',
      'sharp',
      'terser',
      'typescript',
    ],
    readme: 'apps/extension-spectra/README.md',
    privacy: 'apps/extension-spectra/PRIVACY.md',
    artifacts: [
      'packages/contracts/dist',
      'packages/contracts/.turbo',
      'packages/nexus-kernel/dist',
      'packages/nexus-kernel/.turbo',
      'packages/features/audio-engine/dist',
      'packages/features/audio-engine/.turbo',
      'apps/extension-spectra/dist',
      'apps/extension-spectra/.turbo',
      '.turbo',
    ],
  },
  halo: {
    applicationPath: 'apps/extension-halo',
    excludes: [
      'apps/extension-spectra',
      'apps/extension-cortex',
      'packages/features/ai-engine',
      'packages/features/audio-engine',
    ],
    publicName: 'halo',
    publicRootFiles: [
      'scripts/check-workspace-lint.ts',
      'scripts/run-lint-parallel.ts',
      'scripts/run-strict-biome.ts',
    ],
    publicRootScripts: ['dev', 'build', 'typecheck'],
    publicRootScriptOverrides: {
      lint: 'bun scripts/run-lint-parallel.ts --public',
    },
    publicApplicationScripts: ['dev', 'build', 'build:prod', 'lint', 'typecheck'],
    publicApplicationScriptOverrides: {
      lint: 'bun ../../scripts/run-strict-biome.ts .',
    },
    publicApplicationScriptFiles: [],
    publicApplicationDevDependencies: [
      '@playwright/test',
      '@types/file-saver',
      '@types/node',
      '@types/react',
      '@types/react-dom',
      'chrome-types',
      'esbuild',
      'playwright',
      'tsx',
      'typescript',
    ],
    readme: 'apps/extension-halo/README.md',
    privacy: 'apps/extension-halo/PRIVACY.md',
    artifacts: [
      'packages/contracts/dist',
      'packages/contracts/.turbo',
      'packages/nexus-kernel/dist',
      'packages/nexus-kernel/.turbo',
      'packages/ui-kit/dist',
      'packages/ui-kit/.turbo',
      'apps/extension-halo/dist',
      'apps/extension-halo/.turbo',
      '.turbo',
    ],
  },
};
const APP_CONFIG = APP_CONFIGS[targetApp] ?? {
  applicationPath: '',
  excludes: [],
  publicName: '',
  publicRootFiles: [],
  publicRootScripts: [],
  publicRootScriptOverrides: {},
  publicApplicationScripts: [],
  publicApplicationScriptOverrides: {},
  publicApplicationScriptFiles: [],
  publicApplicationDevDependencies: [],
  readme: '',
  privacy: '',
  artifacts: [],
};

const excludes = [...BASE_EXCLUDES, ...APP_CONFIG.excludes];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd,
    encoding: Object.hasOwn(options, 'encoding') ? options.encoding : 'utf8',
    env: options.env,
    input: options.input,
    stdio: options.stdio ?? 'inherit',
    maxBuffer: options.maxBuffer,
  });
}

function runOptional(command, args, options = {}) {
  try {
    return run(command, args, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[sync-public] optional command failed: ${command} ${args.join(' ')} | ${message}`);
    return null;
  }
}

function matchesPattern(relativePath, pattern) {
  const normalized = relativePath.replaceAll('\\', '/');
  const fileName = path.posix.basename(normalized);

  if (pattern.startsWith('/')) {
    const rootPath = pattern.slice(1);
    return normalized === rootPath || normalized.startsWith(`${rootPath}/`);
  }
  if (pattern.startsWith('*.')) return fileName.endsWith(pattern.slice(1));
  if (pattern.includes('*')) {
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replaceAll('*', '.*');
    const expression = new RegExp(`^${escaped}$`);
    return expression.test(normalized) || expression.test(fileName);
  }

  return (
    normalized === pattern ||
    normalized.startsWith(`${pattern}/`) ||
    normalized.endsWith(`/${pattern}`) ||
    normalized.includes(`/${pattern}/`) ||
    fileName === pattern
  );
}

function shouldExcludeWithPatterns(relativePath, patterns) {
  return patterns.some((pattern) => matchesPattern(relativePath, pattern));
}

function shouldExcludeForConfig(relativePath, patterns, config) {
  const normalized = relativePath.replaceAll('\\', '/');
  if (config.publicRootFiles.includes(normalized)) return false;
  const applicationScriptsPrefix = config.applicationPath
    ? `${config.applicationPath}/scripts/`
    : '';
  if (
    applicationScriptsPrefix &&
    normalized.startsWith(applicationScriptsPrefix) &&
    !config.publicApplicationScriptFiles.includes(normalized)
  ) {
    return true;
  }
  return shouldExcludeWithPatterns(normalized, patterns);
}

function shouldExclude(relativePath) {
  return shouldExcludeForConfig(relativePath, excludes, APP_CONFIG);
}

function applicationScriptDependencies(importerPath, source, config) {
  const loader = importerPath.endsWith('.ts') ? 'ts' : 'js';
  const scriptsRoot = `${config.applicationPath}/scripts`;
  const imports = new Bun.Transpiler({ loader }).scan(source).imports;
  return [...new Set(imports
    .map(({ path: specifier }) => specifier)
    .filter((specifier) => specifier.startsWith('.'))
    .map((specifier) => path.posix.normalize(
      path.posix.join(path.posix.dirname(importerPath), specifier),
    ))
    .filter((relativePath) => (
      relativePath === scriptsRoot || relativePath.startsWith(`${scriptsRoot}/`)
    )))]
    .sort();
}

function assertApplicationScriptDependencies(importerPath, source, config) {
  const allowed = new Set(config.publicApplicationScriptFiles);
  const missing = applicationScriptDependencies(importerPath, source, config)
    .filter((relativePath) => !allowed.has(relativePath));
  if (missing.length > 0) {
    throw new Error(
      `${importerPath} imports public build script(s) outside the audited allowlist: ` +
      missing.join(', '),
    );
  }
}

function readCommittedTextFile(relativePath) {
  try {
    return run('git', ['show', `HEAD:./${relativePath}`], {
      cwd: sourceRoot,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  } catch (error) {
    throw new Error(`Committed public build module is missing: ${relativePath}`, {
      cause: error,
    });
  }
}

function verifyPublicApplicationScriptClosure() {
  const queue = [
    `${APP_CONFIG.applicationPath}/build.ts`,
    ...APP_CONFIG.publicApplicationScriptFiles,
  ];
  const visited = new Set();

  while (queue.length > 0) {
    const importerPath = queue.shift();
    if (visited.has(importerPath)) continue;
    visited.add(importerPath);

    const source = readCommittedTextFile(importerPath);
    assertApplicationScriptDependencies(importerPath, source, APP_CONFIG);
    for (const dependency of applicationScriptDependencies(
      importerPath,
      source,
      APP_CONFIG,
    )) {
      if (!visited.has(dependency)) queue.push(dependency);
    }
  }
}

function parseCommittedTree(output) {
  return output
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const firstTab = record.indexOf('\t');
      const secondTab = record.indexOf('\t', firstTab + 1);
      if (firstTab === -1 || secondTab === -1) {
        throw new Error(`Unable to parse committed tree record: ${record}`);
      }
      return {
        objectId: record.slice(0, firstTab),
        objectType: record.slice(firstTab + 1, secondTab),
        relativePath: record.slice(secondTab + 1),
      };
    });
}

function parseBatchBlobOutput(output, expectedObjectIds) {
  const blobs = [];
  let offset = 0;

  for (const expectedObjectId of expectedObjectIds) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd === -1) {
      throw new Error(`Missing git cat-file header for ${expectedObjectId}`);
    }

    const header = output.subarray(offset, headerEnd).toString('utf8');
    const match = /^([0-9a-f]+) ([a-z]+) ([0-9]+)$/u.exec(header);
    if (!match) throw new Error(`Unable to parse git cat-file header: ${header}`);

    const [, objectId, objectType, sizeText] = match;
    if (objectId !== expectedObjectId || objectType !== 'blob') {
      throw new Error(
        `Unexpected git object for ${expectedObjectId}: ${objectId} ${objectType}`,
      );
    }

    const size = Number.parseInt(sizeText, 10);
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    if (contentEnd >= output.length || output[contentEnd] !== 0x0a) {
      throw new Error(`Truncated git blob output for ${expectedObjectId}`);
    }

    blobs.push(output.subarray(contentStart, contentEnd));
    offset = contentEnd + 1;
  }

  if (offset !== output.length) {
    throw new Error(`Unexpected trailing git cat-file output (${output.length - offset} byte(s))`);
  }
  return blobs;
}

function readCommittedFiles(entries) {
  if (entries.length === 0) return [];
  const objectIds = entries.map(({ objectId }) => objectId);
  const output = run('git', ['cat-file', '--batch'], {
    cwd: sourceRoot,
    encoding: null,
    input: `${objectIds.join('\n')}\n`,
    stdio: ['pipe', 'pipe', 'inherit'],
    maxBuffer: 512 * 1024 * 1024,
  });
  return parseBatchBlobOutput(output, objectIds);
}

function copyCommittedFiles() {
  const tree = parseCommittedTree(run(
    'git',
    ['ls-tree', '-r', '-z', '--format=%(objectname)%x09%(objecttype)%x09%(path)', 'HEAD', '--', '.'],
    {
      cwd: sourceRoot,
      encoding: null,
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  ));
  const entries = tree.filter(({ relativePath }) => !shouldExclude(relativePath));
  const unsupported = entries.find(({ objectType }) => objectType !== 'blob');
  if (unsupported) {
    throw new Error(
      `Public projection does not support committed ${unsupported.objectType}: ${unsupported.relativePath}`,
    );
  }

  const blobs = readCommittedFiles(entries);
  const filesByPath = new Map();
  let totalBytes = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const { relativePath } = entries[index];
    const contents = blobs[index];
    const destinationPath = path.join(destinationRoot, relativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.writeFileSync(destinationPath, contents);
    filesByPath.set(relativePath, contents);
    totalBytes += contents.length;
  }
  return { count: entries.length, filesByPath, totalBytes };
}

function sleep(milliseconds) {
  const shared = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(shared), 0, 0, milliseconds);
}

function cleanDestination() {
  if (!fs.existsSync(destinationRoot)) return;

  runOptional(process.execPath, ['x', '--bun', 'turbo', 'daemon', 'stop'], {
    cwd: destinationRoot,
    stdio: 'ignore',
  });

  for (const entry of fs.readdirSync(destinationRoot, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;

    const target = path.join(destinationRoot, entry.name);
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        fs.rmSync(target, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 3) sleep(250 * attempt);
      }
    }

    if (lastError) {
      const message = lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(`Failed to remove ${target}: ${message}`, { cause: lastError });
    }
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, '\t')}\n`);
}

function verifySourceToolchain() {
  const sourcePackage = readJson(path.join(sourceRoot, 'package.json'));
  if (sourcePackage.packageManager !== PACKAGE_MANAGER) {
    throw new Error(
      `Source workspace must declare packageManager=${PACKAGE_MANAGER}; found ${sourcePackage.packageManager ?? 'missing'}`,
    );
  }
}

function copyCommittedEntrypoint(filesByPath, relativePath, destinationName, label) {
  const contents = filesByPath.get(relativePath);
  if (!contents) {
    throw new Error(`Public ${label} source is missing or excluded: ${relativePath}`);
  }
  fs.writeFileSync(path.join(destinationRoot, destinationName), contents);
}

function copyPublicEntrypoints(filesByPath) {
  copyCommittedEntrypoint(filesByPath, APP_CONFIG.readme, 'README.md', 'README');
  copyCommittedEntrypoint(filesByPath, 'LICENSE', 'LICENSE', 'license');

  if (APP_CONFIG.privacy) {
    copyCommittedEntrypoint(
      filesByPath,
      APP_CONFIG.privacy,
      'PRIVACY.md',
      'privacy policy',
    );
  }
}

function selectObjectKeys(source, allowedKeys, overrides = {}) {
  const selected = {};
  for (const key of allowedKeys) {
    if (Object.hasOwn(source, key)) selected[key] = source[key];
  }
  return { ...selected, ...overrides };
}

function patchPublicPackage() {
  const packagePath = path.join(destinationRoot, 'package.json');
  if (!fs.existsSync(packagePath)) {
    throw new Error(`Generated public repository has no package.json: ${packagePath}`);
  }

  const packageJson = readJson(packagePath);
  const applicationPackagePath = path.join(destinationRoot, APP_CONFIG.applicationPath, 'package.json');
  if (!fs.existsSync(applicationPackagePath)) {
    throw new Error(`Generated public application has no package.json: ${applicationPackagePath}`);
  }
  const applicationPackageJson = readJson(applicationPackagePath);

  packageJson.name = APP_CONFIG.publicName;
  packageJson.version = applicationPackageJson.version;
  packageJson.description = applicationPackageJson.description;
  packageJson.scripts = selectObjectKeys(
    packageJson.scripts ?? {},
    APP_CONFIG.publicRootScripts,
    APP_CONFIG.publicRootScriptOverrides,
  );
  packageJson.packageManager = PACKAGE_MANAGER;

  applicationPackageJson.scripts = selectObjectKeys(
    applicationPackageJson.scripts ?? {},
    APP_CONFIG.publicApplicationScripts,
    APP_CONFIG.publicApplicationScriptOverrides,
  );
  applicationPackageJson.devDependencies = selectObjectKeys(
    applicationPackageJson.devDependencies ?? {},
    APP_CONFIG.publicApplicationDevDependencies,
  );

  writeJson(packagePath, packageJson);
  writeJson(applicationPackagePath, applicationPackageJson);
}

function isIncrementalBuildState(filePath) {
  return path.basename(filePath).endsWith('.tsbuildinfo');
}

function cleanIncrementalBuildState(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      cleanIncrementalBuildState(target);
    } else if (entry.isFile() && isIncrementalBuildState(target)) {
      fs.rmSync(target, { force: true });
    }
  }
}

function cleanGeneratedArtifacts() {
  runOptional(process.execPath, ['x', '--bun', 'turbo', 'daemon', 'stop'], {
    cwd: destinationRoot,
    stdio: 'ignore',
  });

  for (const relativePath of APP_CONFIG.artifacts) {
    const target = path.join(destinationRoot, relativePath);
    if (fs.existsSync(target)) {
      fs.rmSync(target, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  }
  cleanIncrementalBuildState(destinationRoot);
}

function runPublicValidationScript(script) {
  run(process.execPath, ['run', script, `--cache-dir=${PUBLIC_TURBO_CACHE_DIR}`], {
    cwd: destinationRoot,
  });
}

function formatDuration(milliseconds) {
  return `${(milliseconds / 1000).toFixed(2)}s`;
}

function runStage(label, action) {
  const startedAt = performance.now();
  console.log(`[sync-public] ${label}...`);
  try {
    const result = action();
    console.log(`[sync-public] ${label}: ${formatDuration(performance.now() - startedAt)}`);
    return result;
  } catch (error) {
    console.error(
      `[sync-public] ${label} failed after ${formatDuration(performance.now() - startedAt)}`,
    );
    throw error;
  }
}

function parseDivergence(output) {
  const [behindText, aheadText] = output.trim().split(/\s+/);
  const behind = Number.parseInt(behindText, 10);
  const ahead = Number.parseInt(aheadText, 10);
  if (!Number.isInteger(behind) || !Number.isInteger(ahead)) {
    throw new Error(`Unable to parse Git divergence: ${output.trim()}`);
  }
  return { behind, ahead };
}

function validateDestinationDivergence(divergence, shouldAmend) {
  const expectedAhead = shouldAmend ? 1 : 0;
  if (divergence.behind !== 0 || divergence.ahead !== expectedAhead) {
    const mode = shouldAmend ? '--amend requires' : 'normal sync requires';
    throw new Error(
      `${mode} destination divergence 0 behind / ${expectedAhead} ahead; ` +
      `found ${divergence.behind} behind / ${divergence.ahead} ahead`,
    );
  }
}

function verifyDestinationState() {
  if (!fs.existsSync(path.join(destinationRoot, '.git'))) {
    if (amend) throw new Error('--amend requires an existing destination Git repository');
    return;
  }

  const status = run('git', ['status', '--porcelain'], {
    cwd: destinationRoot,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (status.trim()) {
    throw new Error('Destination working tree must be clean before public synchronization');
  }

  const upstream = runOptional(
    'git',
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    { cwd: destinationRoot, stdio: ['ignore', 'pipe', 'ignore'] },
  )?.trim();
  if (!upstream) {
    if (amend) throw new Error('--amend requires a configured destination upstream');
    return;
  }

  const divergence = parseDivergence(run(
    'git',
    ['rev-list', '--left-right', '--count', `${upstream}...HEAD`],
    { cwd: destinationRoot, stdio: ['ignore', 'pipe', 'inherit'] },
  ));
  validateDestinationDivergence(divergence, amend);
}

function createGeneratedCommit() {
  run('git', ['add', '-A'], { cwd: destinationRoot, stdio: 'ignore' });
  const status = run('git', ['status', '--porcelain'], {
    cwd: destinationRoot,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (!status.trim()) {
    console.log('[sync-public] no generated changes');
    return;
  }

  if (amend) {
    run('git', ['commit', '--amend', '--no-edit'], { cwd: destinationRoot });
    return;
  }

  const sourceMessage = runOptional('git', ['log', '-1', '--format=%s'], {
    cwd: sourceRoot,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const commitMessage = sourceMessage?.trim() || `chore(${targetApp}): sync from nexus`;
  run('git', ['commit', '-m', commitMessage], { cwd: destinationRoot });
}

function main() {
  const startedAt = performance.now();
  console.log(`NEXUS → ${targetApp.toUpperCase()} public repository`);
  console.log(`Toolchain: ${PACKAGE_MANAGER}`);

  runStage('verify source and destination', () => {
    verifySourceToolchain();
    verifyPublicApplicationScriptClosure();
    verifyDestinationState();
  });

  if (!fs.existsSync(destinationRoot)) {
    fs.mkdirSync(destinationRoot, { recursive: true });
    run('git', ['init'], { cwd: destinationRoot });
  }

  runStage('clean destination', cleanDestination);
  const projection = runStage('read and project committed source', copyCommittedFiles);
  console.log(
    `[sync-public] projected ${projection.count} file(s), ${projection.totalBytes} byte(s)`,
  );
  runStage('project public metadata', () => {
    copyPublicEntrypoints(projection.filesByPath);
    patchPublicPackage();
  });

  runStage('install dependencies', () => run(process.execPath, ['install'], { cwd: destinationRoot }));
  for (const script of PUBLIC_VALIDATION_SCRIPTS) {
    runStage(`validate public ${script}`, () => runPublicValidationScript(script));
  }
  runStage('remove generated artifacts', cleanGeneratedArtifacts);

  const generatedPackage = readJson(path.join(destinationRoot, 'package.json'));
  if (generatedPackage.packageManager !== PACKAGE_MANAGER) {
    throw new Error(`Generated packageManager drifted from ${PACKAGE_MANAGER}`);
  }

  runStage('create generated candidate', createGeneratedCommit);

  console.log(`[sync-public] complete: ${destinationRoot}`);
  console.log(`[sync-public] total: ${formatDuration(performance.now() - startedAt)}`);
  console.log('[sync-public] inspect the generated diff before any push');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();

export {
  APP_CONFIGS,
  BASE_EXCLUDES,
  PUBLIC_TURBO_CACHE_DIR,
  PUBLIC_VALIDATION_SCRIPTS,
  applicationScriptDependencies,
  assertApplicationScriptDependencies,
  matchesPattern,
  isIncrementalBuildState,
  parseBatchBlobOutput,
  parseArguments,
  parseCommittedTree,
  parseDivergence,
  readCommittedTextFile,
  selectObjectKeys,
  shouldExcludeForConfig,
  shouldExcludeWithPatterns,
  validateDestinationDivergence,
};

#!/usr/bin/env node

/**
 * Generate an application-specific public repository from the private NEXUS
 * workspace while preserving the destination repository's own Git history.
 *
 * Usage: bun scripts/sync-public.cjs <spectra|halo> [--amend]
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Keep in sync with scripts/toolchain-versions.mjs (CJS cannot import ESM statically).
const BUN_VERSION = '1.3.14';
const PACKAGE_MANAGER = `bun@${BUN_VERSION}`;
const SUPPORTED_APPS = new Set(['spectra', 'halo']);

function parseArguments(args) {
  const [target, ...options] = args;
  const unknownOptions = options.filter((option) => option !== '--amend');
  if (!SUPPORTED_APPS.has(target) || unknownOptions.length > 0) {
    throw new Error('Usage: bun scripts/sync-public.cjs <spectra|halo> [--amend]');
  }
  return {
    targetApp: target,
    amend: options.includes('--amend'),
  };
}

const invocation = require.main === module
  ? parseArguments(process.argv.slice(2))
  : { targetApp: undefined, amend: false };
const { targetApp, amend } = invocation;

const sourceRoot = path.resolve(__dirname, '..');
const destinationRoot = path.resolve(__dirname, `../../${targetApp}-public`);

const BASE_EXCLUDES = [
  '.agent',
  '.agents',
  '.claude',
  '.codex',
  '.git',
  '.github',
  '.gitnexus',
  '.graph-it',
  '.idea',
  '.turbo',
  '.vscode',
  'AGENTS.md',
  'CLAUDE.md',
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
      'apps/extension-spectra/debug_run.mjs',
      'apps/extension-spectra/plan.md',
      'apps/extension-spectra/release',
      'packages/features/ai-engine',
      'packages/ui-kit',
    ],
    publicName: 'spectra',
    publicRootScripts: ['dev', 'build', 'typecheck'],
    publicRootScriptOverrides: {
      lint: 'turbo run lint',
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
      lint: 'biome check src public build.mjs scripts --max-diagnostics=100',
    },
    publicApplicationScriptFiles: [
      'apps/extension-spectra/scripts/check-production-artifacts.mjs',
      'apps/extension-spectra/scripts/chrome120-webrtc-adapter.mjs',
      'apps/extension-spectra/scripts/external-boundary-properties.mjs',
      'apps/extension-spectra/scripts/i18n-assets.ts',
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
    publicRootScripts: ['dev', 'build', 'typecheck'],
    publicRootScriptOverrides: {
      lint: 'turbo run lint',
    },
    publicApplicationScripts: ['dev', 'build', 'build:prod', 'lint', 'typecheck'],
    publicApplicationScriptOverrides: {},
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
      'puppeteer',
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

let sourceRepositoryPrefix;

function readCommittedFile(relativePath) {
  sourceRepositoryPrefix ??= run('git', ['rev-parse', '--show-prefix'], {
    cwd: sourceRoot,
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
  return run('git', ['show', `HEAD:${sourceRepositoryPrefix}${relativePath}`], {
    cwd: sourceRoot,
    encoding: null,
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function copyCommittedFiles() {
  const output = run('git', ['ls-tree', '-r', '-z', '--name-only', 'HEAD', '--', '.'], {
    cwd: sourceRoot,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  for (const relativePath of output.split('\0').filter(Boolean)) {
    if (shouldExclude(relativePath)) continue;
    const destinationPath = path.join(destinationRoot, relativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.writeFileSync(destinationPath, readCommittedFile(relativePath));
    console.log(`  [copy] ${relativePath}`);
  }
}

function sleep(milliseconds) {
  const shared = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(shared), 0, 0, milliseconds);
}

function cleanDestination() {
  if (!fs.existsSync(destinationRoot)) return;

  runOptional('bunx', ['turbo', 'daemon', 'stop'], {
    cwd: destinationRoot,
    stdio: 'ignore',
  });

  for (const entry of fs.readdirSync(destinationRoot, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;

    const target = path.join(destinationRoot, entry.name);
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        fs.rmSync(target, { recursive: true, force: true });
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

function copyCommittedEntrypoint(relativePath, destinationName, label) {
  try {
    fs.writeFileSync(path.join(destinationRoot, destinationName), readCommittedFile(relativePath));
  } catch (error) {
    throw new Error(`Public ${label} source is missing or unreadable: ${relativePath}`, {
      cause: error,
    });
  }
}

function copyPublicEntrypoints() {
  copyCommittedEntrypoint(APP_CONFIG.readme, 'README.md', 'README');
  copyCommittedEntrypoint('LICENSE', 'LICENSE', 'license');

  if (APP_CONFIG.privacy) {
    copyCommittedEntrypoint(APP_CONFIG.privacy, 'PRIVACY.md', 'privacy policy');
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

function cleanGeneratedArtifacts() {
  runOptional('bunx', ['turbo', 'daemon', 'stop'], {
    cwd: destinationRoot,
    stdio: 'ignore',
  });

  for (const relativePath of APP_CONFIG.artifacts) {
    const target = path.join(destinationRoot, relativePath);
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
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
  console.log(`NEXUS → ${targetApp.toUpperCase()} public repository`);
  console.log(`Toolchain: ${PACKAGE_MANAGER}`);

  verifySourceToolchain();
  verifyDestinationState();

  if (!fs.existsSync(destinationRoot)) {
    fs.mkdirSync(destinationRoot, { recursive: true });
    run('git', ['init'], { cwd: destinationRoot });
  }

  cleanDestination();
  copyCommittedFiles();
  copyPublicEntrypoints();
  patchPublicPackage();

  run('bun', ['install'], { cwd: destinationRoot });
  run('bun', ['run', 'build'], { cwd: destinationRoot });

  cleanGeneratedArtifacts();
  createGeneratedCommit();

  const generatedPackage = readJson(path.join(destinationRoot, 'package.json'));
  if (generatedPackage.packageManager !== PACKAGE_MANAGER) {
    throw new Error(`Generated packageManager drifted from ${PACKAGE_MANAGER}`);
  }

  console.log(`[sync-public] complete: ${destinationRoot}`);
  console.log('[sync-public] inspect the generated diff before any push');
}

if (require.main === module) main();

module.exports = {
  APP_CONFIGS,
  BASE_EXCLUDES,
  matchesPattern,
  parseArguments,
  parseDivergence,
  selectObjectKeys,
  shouldExcludeForConfig,
  shouldExcludeWithPatterns,
  validateDestinationDivergence,
};

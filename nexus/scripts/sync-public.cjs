#!/usr/bin/env node

/**
 * Generate an application-specific public repository from the private NEXUS
 * workspace while preserving the destination repository's own Git history.
 *
 * Usage: bun scripts/sync-public.cjs <spectra|halo>
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Keep in sync with scripts/toolchain-versions.mjs (CJS cannot import ESM statically).
const BUN_VERSION = '1.3.14';
const PACKAGE_MANAGER = `bun@${BUN_VERSION}`;
const SUPPORTED_APPS = new Set(['spectra', 'halo']);
const targetApp = process.argv[2];

if (!SUPPORTED_APPS.has(targetApp)) {
  console.error('Usage: bun scripts/sync-public.cjs <spectra|halo>');
  process.exit(1);
}

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
  '.idea',
  '.turbo',
  '.vscode',
  'AGENTS.md',
  'CLAUDE.md',
  'docs',
  'scripts',
  'store-assets',
  'store-listings',
  'test',
  'node_modules',
  'dist',
  'build',
  '*.log',
  '*.tsbuildinfo',
  '*.zip',
];

const APP_CONFIG = {
  spectra: {
    excludes: [
      'apps/extension-halo',
      'apps/extension-cortex',
      'packages/features/ai-engine',
      'packages/ui-kit',
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
    excludes: [
      'apps/extension-spectra',
      'apps/extension-cortex',
      'packages/features/ai-engine',
      'packages/features/audio-engine',
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
}[targetApp];

const excludes = [...BASE_EXCLUDES, ...APP_CONFIG.excludes];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd,
    encoding: options.encoding ?? 'utf8',
    stdio: options.stdio ?? 'inherit',
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

function shouldExclude(relativePath) {
  return excludes.some((pattern) => matchesPattern(relativePath, pattern));
}

function copyDirectory(source, destination, basePath = '') {
  fs.mkdirSync(destination, { recursive: true });

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (shouldExclude(relativePath)) continue;

    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath, relativePath);
      continue;
    }

    if (entry.isFile()) {
      fs.copyFileSync(sourcePath, destinationPath);
      console.log(`  [copy] ${relativePath}`);
    }
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

function copyPublicEntrypoints() {
  const readmePath = path.join(sourceRoot, APP_CONFIG.readme);
  if (!fs.existsSync(readmePath)) {
    throw new Error(`Public README source is missing: ${APP_CONFIG.readme}`);
  }
  fs.copyFileSync(readmePath, path.join(destinationRoot, 'README.md'));

  const licensePath = path.join(sourceRoot, 'LICENSE');
  if (fs.existsSync(licensePath)) {
    fs.copyFileSync(licensePath, path.join(destinationRoot, 'LICENSE'));
  }

  if (APP_CONFIG.privacy) {
    const privacyPath = path.join(sourceRoot, APP_CONFIG.privacy);
    if (fs.existsSync(privacyPath)) {
      fs.copyFileSync(privacyPath, path.join(destinationRoot, 'PRIVACY.md'));
    }
  }
}

function patchPublicPackage() {
  const packagePath = path.join(destinationRoot, 'package.json');
  if (!fs.existsSync(packagePath)) {
    throw new Error(`Generated public repository has no package.json: ${packagePath}`);
  }

  const packageJson = readJson(packagePath);
  for (const script of ['verify', 'verify:q', 'verify:v', 'prebuild', 'sync:skills', 'sync-halo', 'sync-spectra']) {
    if (packageJson.scripts) delete packageJson.scripts[script];
  }
  packageJson.packageManager = PACKAGE_MANAGER;
  writeJson(packagePath, packageJson);
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

  if (!fs.existsSync(destinationRoot)) {
    fs.mkdirSync(destinationRoot, { recursive: true });
    run('git', ['init'], { cwd: destinationRoot });
  }

  cleanDestination();
  copyDirectory(sourceRoot, destinationRoot);
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

main();

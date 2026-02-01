/**
 * Sync to Public Repository (Morphic Version)
 * Usage: node scripts/sync-public.cjs <spectra|halo>
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const targetApp = process.argv[2];
if (!['spectra', 'halo'].includes(targetApp)) {
  console.error('Usage: node scripts/sync-public.cjs <spectra|halo>');
  process.exit(1);
}

// ====== Configuration ======
const CONFIG = {
  srcDir: path.resolve(__dirname, '..'),
  destDir: path.resolve(__dirname, `../../${targetApp}-public`),

  // Base exclusions for all public repos
  baseExcludes: [
    '.agent', '.ai-context.md', 'plan.md', 'README.AI.md', 'scripts',
    'docs', 'store-listings', 'store-assets', 'assets',
    'privacy-justifications.md', 'policy-decision.md', 'cors-data-flow.md', 'context-index.md',
    'node_modules', '.turbo', 'dist', '*.tsbuildinfo', '*.zip', 'assets-backup',
    '.git', '.vscode', '.idea', 'test', '*.log'
  ],

  appSpecific: {
    spectra: {
      excludes: ['apps/extension-halo', 'apps/extension-cortex', 'packages/features/ai-engine', 'packages/ui-kit'],
      readmeSrc: 'apps/extension-spectra/README.md',
      privacySrc: 'apps/extension-spectra/PRIVACY.md',
      artifactDirs: [
        'packages/contracts/dist',
        'packages/contracts/.turbo',
        'packages/nexus-kernel/dist',
        'packages/nexus-kernel/.turbo',
        'packages/features/audio-engine/dist',
        'packages/features/audio-engine/.turbo',
        'apps/extension-spectra/dist',
        'apps/extension-spectra/.turbo',
        '.turbo'
      ]
    },
    halo: {
      excludes: ['apps/extension-spectra', 'apps/extension-cortex', 'packages/features/ai-engine', 'packages/features/audio-engine'],
      readmeSrc: 'apps/extension-halo/README.md',
      privacySrc: 'apps/extension-halo/PRIVACY.md', // Add if exists
      artifactDirs: [
        'packages/contracts/dist',
        'packages/contracts/.turbo',
        'packages/nexus-kernel/dist',
        'packages/nexus-kernel/.turbo',
        'packages/ui-kit/dist',
        'packages/ui-kit/.turbo',
        'apps/extension-halo/dist',
        'apps/extension-halo/.turbo',
        '.turbo'
      ]
    }
  }
};

const APP_CONFIG = CONFIG.appSpecific[targetApp];
const ALL_EXCLUDES = [...CONFIG.baseExcludes, ...APP_CONFIG.excludes];

// ====== Helpers ======

function shouldExclude(relativePath) {
  const fileName = path.basename(relativePath);
  return ALL_EXCLUDES.some(pattern => {
    if (pattern.startsWith('*.')) return fileName.endsWith(pattern.slice(1));
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(relativePath) || regex.test(fileName);
    }
    return relativePath === pattern ||
      relativePath.startsWith(pattern + '/') ||
      relativePath.endsWith('/' + pattern) ||
      relativePath.includes('/' + pattern + '/') ||
      fileName === pattern;
  });
}

function copyDir(src, dest, basePath = '') {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (shouldExclude(relativePath)) continue;
    if (entry.isDirectory()) copyDir(srcPath, destPath, relativePath);
    else {
      fs.copyFileSync(srcPath, destPath);
      console.log(`  [COPY] ${relativePath}`);
    }
  }
}

function cleanDest(dest) {
  if (!fs.existsSync(dest)) return;

  // Try to stop turbo before cleanup if it exists
  try {
    execSync('bun x turbo daemon stop', { cwd: dest, stdio: 'ignore' });
  } catch (e) { }

  const entries = fs.readdirSync(dest, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const fullPath = path.join(dest, entry.name);

    // Windows retry logic
    let retries = 3;
    while (retries > 0) {
      try {
        fs.rmSync(fullPath, { recursive: true, force: true });
        break;
      } catch (err) {
        retries--;
        if (retries === 0) console.warn(`  [WARN] Failed to remove ${entry.name}: ${err.message}`);
        else execSync('timeout /t 1 /nobreak', { stdio: 'ignore', shell: true });
      }
    }
  }
}

// ====== Main ======

function main() {
  console.log(`========================================`);
  console.log(`  NEXUS → ${targetApp.toUpperCase()} Public Repo Sync`);
  console.log(`========================================\n`);

  if (!fs.existsSync(CONFIG.destDir)) {
    console.log(`Creating destination ${CONFIG.destDir}...`);
    fs.mkdirSync(CONFIG.destDir, { recursive: true });
    execSync('git init', { cwd: CONFIG.destDir });
  }

  console.log('Cleaning destination...\n');
  cleanDest(CONFIG.destDir);

  console.log('Copying files...\n');
  copyDir(CONFIG.srcDir, CONFIG.destDir);

  // Post-process: Copy special files
  console.log('\n  [POST] Copying README and LICENSE...');
  const readmeSrc = path.join(CONFIG.srcDir, APP_CONFIG.readmeSrc);
  if (fs.existsSync(readmeSrc)) {
    fs.copyFileSync(readmeSrc, path.join(CONFIG.destDir, 'README.md'));
    console.log(`  [COPY] ${APP_CONFIG.readmeSrc} -> README.md`);
  }

  const licensePath = path.join(CONFIG.srcDir, 'LICENSE');
  if (fs.existsSync(licensePath)) {
    fs.copyFileSync(licensePath, path.join(CONFIG.destDir, 'LICENSE'));
    console.log('  [COPY] LICENSE');
  }

  // Copy PRIVACY.md to root (required for Chrome Web Store)
  if (APP_CONFIG.privacySrc) {
    const privacySrc = path.join(CONFIG.srcDir, APP_CONFIG.privacySrc);
    if (fs.existsSync(privacySrc)) {
      fs.copyFileSync(privacySrc, path.join(CONFIG.destDir, 'PRIVACY.md'));
      console.log(`  [COPY] ${APP_CONFIG.privacySrc} -> PRIVACY.md`);
    }
  }

  // Patch package.json
  console.log('  [POST] Patching package.json...');
  const pkgPath = path.join(CONFIG.destDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const scriptsToRemove = ['verify', 'prebuild', 'sync-public', 'sync-halo', 'sync-spectra'];
    scriptsToRemove.forEach(s => delete pkg.scripts?.[s]);
    pkg.packageManager = "bun@1.3.5";
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, '\t') + '\n');
  }

  // Git operations
  try {
    execSync('git add -A', { cwd: CONFIG.destDir });
    const status = execSync('git status --porcelain', { cwd: CONFIG.destDir }).toString();
    if (status.trim()) {
      let commitMsg = 'chore: sync from nexus';
      try { commitMsg = execSync('git log -1 --format=%s', { cwd: CONFIG.srcDir }).toString().trim(); } catch (e) { }
      execSync(`git commit -m "${commitMsg}"`, { cwd: CONFIG.destDir });
      console.log('\n✅ Commit created!');
    }
  } catch (e) { console.error('Git error:', e.message); }

  // Build Verification
  console.log('\n========================================');
  console.log('  Build Verification');
  console.log('========================================\n');

  try {
    execSync('bun install', { cwd: CONFIG.destDir, stdio: 'inherit' });
    execSync('bun run build', { cwd: CONFIG.destDir, stdio: 'inherit' });
    console.log('\n✅ Build verification passed!');

    // Stop turbo daemon before cleanup to prevent file locks
    console.log('\nStopping turbo daemon...');
    try {
      execSync('bun x turbo daemon stop', { cwd: CONFIG.destDir, stdio: 'ignore' });
    } catch (e) { }

    // Cleanup build artifacts
    console.log('Cleaning build artifacts...');
    APP_CONFIG.artifactDirs.forEach(dir => {
      // Protect critical files
      if (dir === 'package.json' || dir === 'bun.lockb' || dir === 'bun.lock') return;
      const fullPath = path.join(CONFIG.destDir, dir);
      if (fs.existsSync(fullPath)) fs.rmSync(fullPath, { recursive: true, force: true });
    });

    // Commit bun.lock if changed
    try {
      const lockStatus = execSync('git status --porcelain bun.lock bun.lockb', { cwd: CONFIG.destDir }).toString();
      if (lockStatus.trim()) {
        execSync('git add bun.lock bun.lockb', { cwd: CONFIG.destDir });
        execSync('git commit -m "chore: update bun lockfile"', { cwd: CONFIG.destDir });
        console.log('✅ bun lockfile committed');
      }
    } catch (e) { }
  } catch (e) {
    console.error('\n❌ Build verification failed!');
    process.exit(1);
  }

  console.log('\n✅ Sync Complete!\n');
}

main();

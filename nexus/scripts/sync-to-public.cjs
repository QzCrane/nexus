/**
 * Sync to Public Repository
 * Copies code to public repo directory, excluding AI context engineering files
 * 
 * Usage: node scripts/sync-to-public.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ====== Configuration ======
const CONFIG = {
  // Source directory (current nexus root)
  srcDir: path.resolve(__dirname, '..'),
  // Target directory (public repo)
  destDir: path.resolve(__dirname, '../../nexus-public'),
  // Files/directories to exclude from public repo
  excludePatterns: [
    // === AI Context Engineering ===
    '.agent',
    '.ai-context.md',
    'plan.md',
    'README.AI.md',
    'scripts',                        // All scripts (AI engineering related)
    
    // === Internal Docs ===
    'docs',                           // All docs
    'store-listings',                 // Chrome store listings
    'store-assets',                   // Store promotional assets
    'assets',                          // Development assets (screenshots, scripts)
    'privacy-justifications.md',
    'policy-decision.md',
    'cors-data-flow.md',
    'context-index.md',
    
    // === Build/Release Artifacts ===
    'node_modules',
    '.turbo',
    'dist',
    '*.tsbuildinfo',
    '*.zip',
    'assets-backup',
    
    // === Git/IDE ===
    '.git',
    '.vscode',
    '.idea',
    
    // === Test/Dev Only ===
    'test',
    '*.log',
    
    // === Unused/Empty Packages ===
    'packages/ui-kit',
    'packages/features/ai-engine',
    'packages/features/zen-engine',
  ],
  // Commit message prefix
  commitPrefix: 'sync:',
};

// ====== Helpers ======

/**
 * Check if path matches any exclude pattern
 */
function shouldExclude(relativePath) {
  const fileName = path.basename(relativePath);
  
  return CONFIG.excludePatterns.some(pattern => {
    if (pattern.startsWith('*.')) {
      // Extension pattern: *.log should only match files ending with .log
      const ext = pattern.slice(1); // ".log"
      return fileName.endsWith(ext);
    }
    if (pattern.includes('*')) {
      // Other glob patterns
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(relativePath) || regex.test(fileName);
    }
    // Exact match or path component match
    return relativePath === pattern || 
           relativePath.startsWith(pattern + '/') ||
           relativePath.endsWith('/' + pattern) ||
           relativePath.includes('/' + pattern + '/') ||
           fileName === pattern;
  });
}

/**
 * Copy directory recursively with exclusions
 */
function copyDir(src, dest, basePath = '') {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (shouldExclude(relativePath)) {
      console.log(`  [SKIP] ${relativePath}`);
      continue;
    }

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, relativePath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      console.log(`  [COPY] ${relativePath}`);
    }
  }
}

/**
 * Clean destination directory (except .git)
 */
function cleanDest(dest) {
  if (!fs.existsSync(dest)) return;

  const entries = fs.readdirSync(dest, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const fullPath = path.join(dest, entry.name);
    fs.rmSync(fullPath, { recursive: true, force: true });
  }
}

// ====== Main ======

function main() {
  console.log('========================================');
  console.log('  NEXUS → Public Repo Sync');
  console.log('========================================\n');

  console.log(`Source:      ${CONFIG.srcDir}`);
  console.log(`Destination: ${CONFIG.destDir}\n`);

  // Check if dest exists
  if (!fs.existsSync(CONFIG.destDir)) {
    console.log('Creating destination directory...');
    fs.mkdirSync(CONFIG.destDir, { recursive: true });
    
    // Initialize git repo
    console.log('Initializing git repository...');
    execSync('git init', { cwd: CONFIG.destDir });
  }

  // Clean destination
  console.log('Cleaning destination...\n');
  cleanDest(CONFIG.destDir);

  // Copy files
  console.log('Copying files...\n');
  copyDir(CONFIG.srcDir, CONFIG.destDir);

  // Post-process: Copy special files
  console.log('\n  [POST] Copying README and LICENSE...');
  const readmePublicPath = path.join(CONFIG.srcDir, 'docs/README-PUBLIC.md');
  const readmeDestPath = path.join(CONFIG.destDir, 'README.md');
  if (fs.existsSync(readmePublicPath)) {
    fs.copyFileSync(readmePublicPath, readmeDestPath);
    console.log('  [COPY] docs/README-PUBLIC.md -> README.md');
  }
  
  const licensePath = path.join(CONFIG.srcDir, 'LICENSE');
  const licenseDestPath = path.join(CONFIG.destDir, 'LICENSE');
  if (fs.existsSync(licensePath)) {
    fs.copyFileSync(licensePath, licenseDestPath);
    console.log('  [COPY] LICENSE');
  }

  // Post-process: Patch package.json to remove internal script references
  console.log('  [POST] Patching package.json for public repo...');
  const pkgPath = path.join(CONFIG.destDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    // Remove scripts that reference excluded directories
    const scriptsToRemove = ['verify', 'prebuild', 'sync-public'];
    scriptsToRemove.forEach(s => delete pkg.scripts?.[s]);
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, '\t') + '\n');
    console.log('  [PATCH] package.json (removed internal scripts)');
  }

  // Post-process: Patch tsconfig.base.json to remove references to excluded packages
  console.log('  [POST] Patching tsconfig.base.json for public repo...');
  const tsconfigPath = path.join(CONFIG.destDir, 'tsconfig.base.json');
  if (fs.existsSync(tsconfigPath)) {
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
    // Remove paths for excluded packages
    const pathsToRemove = ['@nexus/ui-kit', '@nexus/ai-engine', '@nexus/zen-engine'];
    pathsToRemove.forEach(p => delete tsconfig.compilerOptions?.paths?.[p]);
    fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, '  ') + '\n');
    console.log('  [PATCH] tsconfig.base.json (removed unused package paths)');
  }

  // Git operations
  console.log('\n========================================');
  console.log('  Git Operations');
  console.log('========================================\n');

  try {
    const date = new Date().toISOString().split('T')[0];
    const commitMsg = `${CONFIG.commitPrefix} ${date}`;

    execSync('git add -A', { cwd: CONFIG.destDir, stdio: 'inherit' });
    
    // Check if there are changes
    const status = execSync('git status --porcelain', { cwd: CONFIG.destDir }).toString();
    if (status.trim()) {
      execSync(`git commit -m "${commitMsg}"`, { cwd: CONFIG.destDir, stdio: 'inherit' });
      console.log('\n✅ Changes committed!');
      console.log('\nTo push to remote:');
      console.log(`  cd ${CONFIG.destDir}`);
      console.log('  git remote add origin <your-public-repo-url>');
      console.log('  git push -u origin main');
    } else {
      console.log('\n⚠️ No changes to commit.');
    }
  } catch (e) {
    console.log('\n⚠️ Git commit skipped (no changes or error).');
  }

  console.log('\n========================================');
  console.log('  Build Verification');
  console.log('========================================\n');

  try {
    console.log('Installing dependencies...');
    execSync('pnpm install', { cwd: CONFIG.destDir, stdio: 'inherit' });
    
    console.log('\nBuilding project...');
    execSync('pnpm build', { cwd: CONFIG.destDir, stdio: 'inherit' });
    
    console.log('\n✅ Build verification passed!');
    
    // Clean build artifacts
    console.log('\nCleaning build artifacts...');
    const artifactDirs = [
      'node_modules',
      'packages/contracts/dist',
      'packages/contracts/.turbo',
      'packages/nexus-kernel/dist',
      'packages/nexus-kernel/.turbo',
      'packages/features/audio-engine/dist',
      'packages/features/audio-engine/.turbo',
      'apps/extension-spectra/dist',
      'apps/extension-spectra/.turbo',
      '.turbo',
      'pnpm-lock.yaml',  // Keep in repo, but generated during install
    ];
    
    for (const dir of artifactDirs) {
      const fullPath = path.join(CONFIG.destDir, dir);
      if (fs.existsSync(fullPath)) {
        fs.rmSync(fullPath, { recursive: true, force: true });
        console.log(`  [CLEAN] ${dir}`);
      }
    }
    
    // Remove *.tsbuildinfo files
    const findTsBuildInfo = (dir) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
          findTsBuildInfo(fullPath);
        } else if (entry.name.endsWith('.tsbuildinfo')) {
          fs.rmSync(fullPath, { force: true });
          console.log(`  [CLEAN] ${path.relative(CONFIG.destDir, fullPath)}`);
        }
      }
    };
    findTsBuildInfo(CONFIG.destDir);
    
    console.log('\n✅ Build artifacts cleaned!');
  } catch (e) {
    console.error('\n❌ Build verification failed!');
    console.error(e.message);
    process.exit(1);
  }

  console.log('\n========================================');
  console.log('  Sync Complete!');
  console.log('========================================\n');
}

main();

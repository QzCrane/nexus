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
  ],
  // Commit message prefix
  commitPrefix: 'sync:',
};

// ====== Helpers ======

/**
 * Check if path matches any exclude pattern
 */
function shouldExclude(relativePath) {
  return CONFIG.excludePatterns.some(pattern => {
    if (pattern.includes('*')) {
      // Glob pattern
      const regex = new RegExp(pattern.replace('*', '.*'));
      return regex.test(relativePath);
    }
    // Exact match or starts with
    return relativePath === pattern || 
           relativePath.startsWith(pattern + '/') ||
           relativePath.endsWith('/' + pattern) ||
           relativePath.includes('/' + pattern + '/');
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
  console.log('  Sync Complete!');
  console.log('========================================\n');
}

main();

/**
 * Permission Usage Verification
 * 
 * Checks that all permissions declared in manifest.json are actually used in source code.
 * This prevents Chrome Web Store rejection due to unused permissions.
 */

import fs from 'fs';
import path from 'path';
import { counters, error, ok } from './utils.js';

// Maps manifest permissions to their corresponding chrome API patterns
const PERMISSION_API_MAP = {
  'tabs': ['chrome.tabs'],
  'storage': ['chrome.storage'],
  'tabCapture': ['chrome.tabCapture'],
  'offscreen': ['chrome.offscreen'],
  'scripting': ['chrome.scripting'],
  'alarms': ['chrome.alarms'],
  'notifications': ['chrome.notifications'],
  'contextMenus': ['chrome.contextMenus'],
  'bookmarks': ['chrome.bookmarks'],
  'history': ['chrome.history'],
  'downloads': ['chrome.downloads'],
  'webNavigation': ['chrome.webNavigation'],
  'webRequest': ['chrome.webRequest'],
  'cookies': ['chrome.cookies'],
  'identity': ['chrome.identity'],
  'management': ['chrome.management'],
  'declarativeNetRequest': ['chrome.declarativeNetRequest'],
};

// Permissions that don't have direct API calls but are still required
const IMPLICIT_PERMISSIONS = [
  'activeTab',  // Implicit via user action
  '<all_urls>', // Host permission
];

export function checkPermissionUsage(root) {
  console.log('\n📋 检查 manifest 权限使用情况...\n');

  const apps = ['extension-spectra', 'extension-halo'];
  
  for (const app of apps) {
    const manifestPath = path.join(root, 'apps', app, 'public', 'manifest.json');
    const srcDir = path.join(root, 'apps', app, 'src');
    
    if (!fs.existsSync(manifestPath)) continue;
    
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const permissions = manifest.permissions || [];
    
    // Read all source files
    const sourceCode = readAllSourceFiles(srcDir);
    
    const unusedPermissions = [];
    
    for (const perm of permissions) {
      if (IMPLICIT_PERMISSIONS.includes(perm)) continue;
      
      const apiPatterns = PERMISSION_API_MAP[perm];
      if (!apiPatterns) {
        // Unknown permission, skip
        continue;
      }
      
      const isUsed = apiPatterns.some(pattern => sourceCode.includes(pattern));
      if (!isUsed) {
        unusedPermissions.push(perm);
      }
    }
    
    if (unusedPermissions.length > 0) {
      error(`${app}: 声明但未使用的权限: ${unusedPermissions.join(', ')}`);
      console.log(`   Chrome Web Store 会拒绝未使用的权限，请从 manifest.json 中移除`);
    } else {
      ok(`${app}: 所有权限均有使用`);
    }
  }
}

function readAllSourceFiles(dir) {
  let content = '';
  
  if (!fs.existsSync(dir)) return content;
  
  const walk = (d) => {
    const items = fs.readdirSync(d, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(d, item.name);
      if (item.isDirectory()) {
        walk(fullPath);
      } else if (item.name.endsWith('.ts') || item.name.endsWith('.js') || item.name.endsWith('.tsx')) {
        content += fs.readFileSync(fullPath, 'utf8');
      }
    }
  };
  
  walk(dir);
  return content;
}

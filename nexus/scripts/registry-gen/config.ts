// goal: Registry generator configuration
// eff: Centralized paths and constants

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const HALO_ROOT = path.resolve(__dirname, '../../apps/extension-halo/src');
export const HALO_APP_ROOT = path.dirname(HALO_ROOT);
export const TOOLS_DIR = path.join(HALO_ROOT, 'tools');
export const SCRIPTS_DIR = path.join(HALO_ROOT, 'scripts');
export const SYSTEM_DIR = path.join(HALO_ROOT, 'system');

export const OUTPUT_REGISTRY = path.join(HALO_ROOT, 'kernel/registry/_generated.ts');
export const OUTPUT_STARTUP_REGISTRY = path.join(HALO_ROOT, 'kernel/registry/_generated-startup.ts');
export const OUTPUT_BACKGROUND_ACTIVE = path.join(HALO_ROOT, 'kernel/registry/_generated-background-active.ts');
export const OUTPUT_LOADER = path.join(HALO_ROOT, 'components/_generated-tool-loader.ts');
export const OUTPUT_I18N_EN = path.join(HALO_ROOT, 'i18n/locales/_generated-tools-en.ts');
export const OUTPUT_I18N_ZH = path.join(HALO_ROOT, 'i18n/locales/_generated-tools-zh.ts');
export const OUTPUT_SCRIPT_RUNTIME = path.join(HALO_APP_ROOT, 'public/script-plugin-runtime.json');

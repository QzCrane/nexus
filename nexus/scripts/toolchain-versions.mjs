/**
 * Canonical toolchain versions for the NEXUS workspace.
 *
 * Single source of truth consumed by:
 *   - scripts/check-toolchain.mjs
 *   - scripts/check-workspace-lint.mjs
 *   - scripts/release-spectra.mjs
 *
 * NOTE: scripts/sync-public.cjs keeps a CJS copy of BUN_VERSION because it
 * cannot use static ESM imports. Update both files when bumping versions.
 */

export const BUN_VERSION = '1.3.14';
export const BIOME_VERSION = '2.5.3';
export const TURBO_VERSION = '2.10.5';

// goal: canonical ownership vocabulary for registry-managed script runtimes
// inv: kernel services and system UserScripts share one direction-safe type contract

export type ScriptRuntimeOwner = 'packaged-script' | 'saat-tool';

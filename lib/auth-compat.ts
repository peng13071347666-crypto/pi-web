/**
 * Auth compatibility layer for pi-coding-agent 0.81+
 *
 * In 0.81+, AuthStorage is no longer publicly exported, and ModelRegistry
 * no longer has a static create() method. This module provides helper
 * functions that recreate the old patterns using the new internal APIs.
 */
import { join, dirname } from "path";

// Use eval("require") to bypass webpack's static analysis of the exports field.
// serverExternalPackages ensures this package is loaded by Node.js at runtime.
const _require = eval("require") as NodeRequire;

type AuthStorageLike = {
  create(authPath?: string): any;
  get(provider: string): any;
  set(provider: string, credential: any): void;
  remove(provider: string): void;
  has(provider: string): boolean;
  getOAuthProviders(): any[];
};

type ModelRegistryLike = {
  new (runtime: any): any;
};

let _authStorageClass: AuthStorageLike | null = null;
let _modelRegistryClass: ModelRegistryLike | null = null;
let _modelRuntimeCreate: ((options?: any) => Promise<any>) | null = null;

function getPackageDir(): string {
  const mainPath = _require.resolve("@earendil-works/pi-coding-agent");
  return dirname(dirname(mainPath));
}

function loadAuthStorageClass(): AuthStorageLike {
  if (_authStorageClass) return _authStorageClass;
  const pkgDir = getPackageDir();
  const mod = _require(join(pkgDir, "dist", "core", "auth-storage.js"));
  _authStorageClass = mod.AuthStorage;
  return _authStorageClass!;
}

function loadModelRegistryClass(): ModelRegistryLike {
  if (_modelRegistryClass) return _modelRegistryClass;
  const pkgDir = getPackageDir();
  const mod = _require(join(pkgDir, "dist", "core", "model-registry.js"));
  _modelRegistryClass = mod.ModelRegistry;
  return _modelRegistryClass!;
}

function loadModelRuntimeCreate(): (options?: any) => Promise<any> {
  if (_modelRuntimeCreate) return _modelRuntimeCreate;
  const pkgDir = getPackageDir();
  const mod = _require(join(pkgDir, "dist", "core", "model-runtime.js"));
  _modelRuntimeCreate = mod.ModelRuntime.create;
  return _modelRuntimeCreate!;
}

/** Create an AuthStorage instance (same as old AuthStorage.create()) */
export function createAuthStorage(authPath?: string): any {
  const Cls = loadAuthStorageClass();
  return Cls.create(authPath);
}

/** Create a ModelRegistry with an AuthStorage (replaces old ModelRegistry.create(authStorage)) */
export async function createModelRegistry(authStorage: any, modelsJsonPath?: string): Promise<any> {
  const ModelRuntimeCreate = loadModelRuntimeCreate();
  const ModelRegistryClass = loadModelRegistryClass();
  const options: any = { authStorage };
  if (modelsJsonPath) options.modelsJsonPath = modelsJsonPath;
  const runtime = await ModelRuntimeCreate(options);
  return new ModelRegistryClass(runtime);
}

// Re-export the AuthStorage class for direct use (e.g., static methods)
export function getAuthStorageClass(): AuthStorageLike {
  return loadAuthStorageClass();
}

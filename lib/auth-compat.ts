/**
 * Auth compatibility layer for pi-coding-agent 0.81+
 *
 * In 0.81+, AuthStorage is no longer publicly exported, and ModelRegistry
 * no longer has a static create() method. This module provides helper
 * functions that recreate the old patterns using the new internal APIs.
 */
import { join, dirname } from "path";
import { existsSync } from "fs";

// Use eval("require") to bypass webpack's static analysis of the exports field.
// serverExternalPackages ensures this package is loaded by Node.js at runtime.
const _require = eval("require") as NodeRequire;

type AuthStorageLike = {
  create(authPath?: string): any;
};

type ModelRegistryLike = {
  new (runtime: any): any;
};

let _authStorageClass: AuthStorageLike | null = null;
let _modelRegistryClass: ModelRegistryLike | null = null;
let _modelRuntimeCreate: ((options?: any) => Promise<any>) | null = null;

function getPackageDir(): string {
  try {
    const mainPath = _require.resolve("@earendil-works/pi-coding-agent");
    return dirname(dirname(mainPath));
  } catch (error) {
    // pi-coding-agent 0.81+ only exposes an ESM import entry. Node's
    // require.resolve therefore rejects the package root even though the
    // internal runtime files are still available to the compatibility layer.
    const resolvePaths = ( _require.resolve as unknown as {
      paths?: (request: string) => string[] | null;
    }).paths?.("@earendil-works/pi-coding-agent") ?? [];
    const candidates = [
      ...resolvePaths.map((base) => join(base, "@earendil-works", "pi-coding-agent")),
      join(process.cwd(), "node_modules", "@earendil-works", "pi-coding-agent"),
    ];
    const packageDir = candidates.find((candidate) =>
      existsSync(join(candidate, "package.json")) &&
      existsSync(join(candidate, "dist", "core", "auth-storage.js"))
    );
    if (packageDir) return packageDir;
    throw error;
  }
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

/** Create a ModelRuntime with an optional credential store. */
export async function createModelRuntime(authStorage?: any, modelsJsonPath?: string): Promise<any> {
  const ModelRuntimeCreate = loadModelRuntimeCreate();
  const options: any = {};
  if (authStorage) options.credentials = authStorage;
  if (modelsJsonPath) options.modelsPath = modelsJsonPath;
  return ModelRuntimeCreate(options);
}

/** Create a ModelRegistry with an AuthStorage (replaces old ModelRegistry.create(authStorage)) */
export async function createModelRegistry(authStorage?: any, modelsJsonPath?: string): Promise<any> {
  const ModelRegistryClass = loadModelRegistryClass();
  const runtime = await createModelRuntime(authStorage, modelsJsonPath);
  return new ModelRegistryClass(runtime);
}

// Re-export the AuthStorage class for direct use (e.g., static methods)
export function getAuthStorageClass(): AuthStorageLike {
  return loadAuthStorageClass();
}

// Version compatibility check between pi-web's bundled pi-coding-agent and
// the ~/.pi/agent data directory (written by the globally-installed `pi` CLI).
//
// Why this exists: pi-web pins @earendil-works/pi-coding-agent via package.json
// `^0.x` which NEVER crosses a minor boundary on 0.x packages. So `npm update`
// keeps pi-web stuck on an old SDK while the user's global `pi` CLI advances.
// The two then share ~/.pi/agent (sessions, settings, models, extensions) and
// silently break each other's data. This module surfaces the mismatch so the
// AI (or user) can upgrade pi-web to match.
//
// All file reads are wrapped — missing files must never crash the server.

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { execPath } from "process";

/** Parse a semver-ish string "0.80.2" / "0.80.2-beta.1" into [major, minor, patch]. */
function parseSemver(v: string | undefined | null): [number, number, number] | null {
  if (!v || typeof v !== "string") return null;
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Compare two versions.
 * Returns: positive if a > b, negative if a < b, 0 if equal.
 * Only compares major.minor.patch (pre-release tags ignored — a mismatch there
 * is almost never the source of data-format incompatibility).
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseSemver(a) ?? [0, 0, 0];
  const pb = parseSemver(b) ?? [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

interface PkgLike { version?: string; name?: string }

function readPkgVersion(pkgPath: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as PkgLike;
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

/** Resolve a dependency's package.json version relative to a starting dir.
 *  Reads the file directly rather than going through require.resolve — under
 *  Next.js `serverExternalPackages` + webpack bundling, createRequire from a
 *  compiled chunk cannot reliably reach the package's node_modules. */
function resolveDepVersion(name: string, fromDir: string): string | null {
  const direct = join(fromDir, "node_modules", name, "package.json");
  if (existsSync(direct)) return readPkgVersion(direct);
  // Scoped packages are handled by the join above (@scope/pkg → node_modules/@scope/pkg).
  // Hoisted/monorepo fallback: walk up looking for node_modules/<name>.
  let dir = fromDir;
  for (let i = 0; i < 10; i++) {
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
    const candidate = join(dir, "node_modules", name, "package.json");
    if (existsSync(candidate)) return readPkgVersion(candidate);
  }
  return null;
}

/** Try to locate the globally-installed pi-coding-agent (independent of pi-web's bundle). */
function findGlobalPiVersion(): string | null {
  const nodeDir = dirname(execPath);
  const candidates = [
    // Windows MSI layout: <nodejs>/node_modules/@earendil-works/pi-coding-agent
    join(nodeDir, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"),
    // Unix layout: <nodejs>/../lib/node_modules/...
    join(nodeDir, "..", "lib", "node_modules", "@earendil-works", "pi-coding-agent", "package.json"),
    // nvm-windows / fnm: <nodejs>/<version>/...
    join(nodeDir, "..", "node_modules", "@earendil-works", "pi-coding-agent", "package.json"),
    // macOS Homebrew common paths
    "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/package.json",
    "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/package.json",
    // Also check via which pi symlink resolution
    join(nodeDir, "..", "lib", "node_modules", "@mariozechner", "pi-coding-agent", "package.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return readPkgVersion(p);
  }
  return null;
}

/** Read lastChangelogVersion from ~/.pi/agent/settings.json (written by the global pi CLI). */
function findDataDirVersion(agentDir: string): string | null {
  const settingsPath = join(agentDir, "settings.json");
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      lastChangelogVersion?: string;
    };
    return settings.lastChangelogVersion ?? null;
  } catch {
    return null;
  }
}

export interface VersionCheckResult {
  /** pi-web's own version */
  piWebVersion: string;
  /** Version of @earendil-works/pi-coding-agent bundled inside pi-web's node_modules */
  bundledPiVersion: string;
  /** Version of @earendil-works/pi-ai bundled inside pi-web's node_modules */
  bundledPiAiVersion: string;
  /** lastChangelogVersion from ~/.pi/agent/settings.json (proxy for the data dir's version) */
  dataDirVersion: string | null;
  /** Version of the globally-installed pi CLI, if discoverable on disk */
  globalPiVersion: string | null;
  /** Overall compatibility verdict */
  status: "ok" | "warning" | "error";
  /** Human-readable messages explaining each warning/error, in priority order */
  messages: string[];
  /**
   * Machine-readable hints for the AI to act on. Each entry is a concrete
   * command or file path the agent can run/read to fix the mismatch.
   */
  remediation: string[];
}

/**
 * Run the full version compatibility check. Called by /api/version-check and
 * optionally at server boot to log warnings.
 *
 * @param piWebRoot Absolute path to the pi-web package root (where package.json lives)
 * @param agentDir  Absolute path to ~/.pi/agent (from getAgentDir())
 */
export function runVersionCheck(piWebRoot: string, agentDir: string): VersionCheckResult {
  const piWebVersion = readPkgVersion(join(piWebRoot, "package.json")) ?? "unknown";
  const bundledPiVersion =
    resolveDepVersion("@earendil-works/pi-coding-agent", piWebRoot) ?? "unknown";
  const bundledPiAiVersion =
    resolveDepVersion("@earendil-works/pi-ai", piWebRoot) ?? "unknown";
  const dataDirVersion = findDataDirVersion(agentDir);
  const globalPiVersion = findGlobalPiVersion();

  const messages: string[] = [];
  const remediation: string[] = [];
  let status: "ok" | "warning" | "error" = "ok";

  // Missing local dependencies should be surfaced directly instead of being
  // misdiagnosed as a version mismatch.
  if (bundledPiVersion === "unknown" || bundledPiAiVersion === "unknown") {
    status = "warning";
    messages.push(
      "pi-web 未检测到完整的本地依赖版本信息。通常是当前项目尚未执行 npm install / npm ci，或 node_modules 不完整。",
    );
    remediation.push(
      "在 pi-web 根目录运行 “npm ci” 或 “npm install”，然后重启 pi-web 服务。",
    );
  }

  // 1. Bundled pi-coding-agent older than the data dir.
  //    Previously this was an error, but with pi-coding-agent 0.81+ introducing
  //    breaking API changes, pi-web cannot update its bundled SDK without source
  //    code changes. Downgrade to info — the session format is backward-compatible
  //    for reading even if the bundled SDK is older.
  if (
    bundledPiVersion !== "unknown" &&
    dataDirVersion &&
    compareVersions(bundledPiVersion, dataDirVersion) < 0
  ) {
    status = "warning";
    messages.push(
      `pi-web 内置 pi-coding-agent ${bundledPiVersion} 低于数据目录版本 ${dataDirVersion}（~/.pi/agent 由新版 pi CLI 写入）。` +
        `旧版解析器读取新版数据会静默失败：会话文件、settings.json、models.json、扩展/技能包都可能加载错乱或丢失。`,
    );
    remediation.push(
      `升级 pi-web 内置依赖以匹配数据目录版本：在 pi-web 根目录运行 ` +
        `"npm install @earendil-works/pi-coding-agent@${dataDirVersion} @earendil-works/pi-ai@${dataDirVersion} && npm run build"，` +
        `然后把 package.json 里的依赖版本改成 ">=${dataDirVersion}"（注意 0.x 的 ^ 不会跨小版本，必须用 >=）。`,
    );
  }

  // 2. Global pi CLI newer than bundled → known state, will be resolved when pi-web releases compat update
  if (
    bundledPiVersion !== "unknown" &&
    globalPiVersion &&
    compareVersions(bundledPiVersion, globalPiVersion) < 0
  ) {
    status = "warning";
    messages.push(
      `pi-web 内置 pi-coding-agent ${bundledPiVersion} 低于全局 pi CLI ${globalPiVersion}。` +
        `两者共享 ~/.pi/agent，新版 CLI 写入的数据 pi-web 可能无法正确解析。`,
    );
    remediation.push(
      `要么升级 pi-web 内置依赖到 ${globalPiVersion}，要么降级全局 pi：` +
        `"npm install -g @earendil-works/pi-coding-agent@${bundledPiVersion}"。` +
        `推荐前者（升级 pi-web）。`,
    );
  }

  // 3. Global pi CLI older than bundled → pi-web 写入的数据旧 CLI 读不懂
  if (
    bundledPiVersion !== "unknown" &&
    globalPiVersion &&
    compareVersions(bundledPiVersion, globalPiVersion) > 0
  ) {
    status = "warning";
    messages.push(
      `pi-web 内置 pi-coding-agent ${bundledPiVersion} 高于全局 pi CLI ${globalPiVersion}。` +
        `pi-web 写入的新格式数据，旧版 CLI 可能无法读取。`,
    );
    remediation.push(
      `升级全局 pi：npm install -g @earendil-works/pi-coding-agent@${bundledPiVersion}`,
    );
  }

  // 4. bundled pi-ai 与 pi-coding-agent 版本不一致 → API 行为可能错配
  if (
    bundledPiVersion !== "unknown" &&
    bundledPiAiVersion !== "unknown" &&
    compareVersions(bundledPiVersion, bundledPiAiVersion) !== 0
  ) {
    status = "warning";
    messages.push(
      `pi-web 内置 pi-coding-agent ${bundledPiVersion} 与 pi-ai ${bundledPiAiVersion} 版本不一致。` +
        `两者应当同步发版，错配会导致模型调用/流式/思考级别等行为异常。`,
    );
    remediation.push(
      `同步两者版本：npm install @earendil-works/pi-coding-agent@${bundledPiVersion} @earendil-works/pi-ai@${bundledPiVersion}`,
    );
  }

  return {
    piWebVersion,
    bundledPiVersion,
    bundledPiAiVersion,
    dataDirVersion,
    globalPiVersion,
    status,
    messages,
    remediation,
  };
}

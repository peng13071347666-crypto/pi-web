import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

// GET /api/version-check/update?target=<version>
// One-click update: updates BOTH global Pi Agent CLI AND pi-web's bundled SDK.
// For bundled SDK: uses git pull to get compatible source code, then npm install + build.
// If build fails (breaking API changes), rolls back bundled SDK but keeps global CLI updated.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const target = searchParams.get("target") ?? "latest";

  if (target !== "latest" && !/^\d+\.\d+\.\d+/.test(target)) {
    return NextResponse.json({ error: "invalid version format" }, { status: 400 });
  }

  const cwd = process.cwd();
  const env = {
    ...process.env,
    PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin"}`,
  };
  const execOpts = { cwd, timeout: 300_000, stdio: "pipe" as const, env };
  const results: string[] = [];
  let hasError = false;

  // ── Step 1: Update global Pi Agent CLI ──
  try {
    const versionSpec = target === "latest" ? "@latest" : `@${target}`;
    execSync(`npm install -g --force @earendil-works/pi-coding-agent${versionSpec}`, execOpts);
    results.push("✓ 全局 Pi Agent CLI 已更新");
  } catch (e) {
    const err = e as { stderr?: Buffer };
    results.push(`✗ 全局 CLI 更新失败: ${err.stderr?.toString().slice(-100) ?? "unknown"}`);
    hasError = true;
  }

  // ── Step 2: Update pi-web bundled SDK ──
  // Read current bundled version for potential rollback
  let prevBundledVersion = "0.80.2";
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    prevBundledVersion = (pkg.dependencies?.["@earendil-works/pi-coding-agent"] ?? "0.80.2").replace(/^[\^~>=<]*/, "");
  } catch { /* use default */ }

  const isGitRepo = existsSync(join(cwd, ".git"));

  if (isGitRepo) {
    // Git-based: pull latest source (should include SDK compat fixes) + install + build
    try {
      try { execSync("git stash --include-untracked", execOpts); } catch { /* ignore */ }
      execSync("git pull --ff-only", execOpts);
      execSync("npm install", execOpts);

      try {
        execSync("npm run build", execOpts);
        results.push("✓ pi-web 内置 SDK 已更新并构建成功");
      } catch (buildErr) {
        const err = buildErr as { stderr?: Buffer; stdout?: Buffer };
        const output = (err.stderr?.toString() ?? "") + (err.stdout?.toString() ?? "");

        // Build failed — rollback bundled SDK
        try { execSync("git stash pop", execOpts); } catch { /* ignore */ }
        execSync("npm install", execOpts);
        execSync("npm run build", execOpts);

        results.push(`⚠ pi-web 内置 SDK 无法更新到 v${target}（源码不兼容），已保持 v${prevBundledVersion}`);
      }
    } catch (e) {
      const err = e as { stderr?: Buffer };
      results.push(`✗ pi-web 源码更新失败: ${err.stderr?.toString().slice(-100) ?? "unknown"}`);
      // Try to rollback
      try { execSync("git stash pop", execOpts); } catch { /* ignore */ }
      try { execSync("npm install", execOpts); } catch { /* ignore */ }
      try { execSync("npm run build", execOpts); } catch { /* ignore */ }
    }
  } else {
    // Non-git: just try updating bundled deps with rollback
    try {
      const targetVersion = target === "latest" ? "latest" : target;
      execSync(
        `npm install @earendil-works/pi-coding-agent@${targetVersion} @earendil-works/pi-ai@${targetVersion} --save-exact`,
        execOpts,
      );
      execSync("npm install", execOpts);

      try {
        execSync("npm run build", execOpts);
        results.push("✓ pi-web 内置 SDK 已更新并构建成功");
      } catch {
        // Rollback
        execSync(
          `npm install @earendil-works/pi-coding-agent@${prevBundledVersion} @earendil-works/pi-ai@${prevBundledVersion} --save-exact`,
          execOpts,
        );
        execSync("npm install", execOpts);
        execSync("npm run build", execOpts);
        results.push(`⚠ pi-web 内置 SDK 无法更新（源码不兼容），已保持 v${prevBundledVersion}`);
      }
    } catch (e) {
      const err = e as { stderr?: Buffer };
      results.push(`✗ 内置 SDK 更新失败: ${err.stderr?.toString().slice(-100) ?? "unknown"}`);
    }
  }

  // ── Step 3: Update data directory version marker ──
  // The data dir version (lastChangelogVersion in settings.json) is written by pi CLI itself
  // on startup. It will auto-update next time pi runs. No action needed here.

  const needsRestart = results.some((r) => r.includes("构建成功"));
  const message = results.join("\n");

  return NextResponse.json({
    success: !hasError,
    message,
    restart: needsRestart,
  });
}

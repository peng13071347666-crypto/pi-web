import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { execPath, platform } from "process";

const execFileAsync = promisify(execFile);

/**
 * Locate `npx-cli.js` shipped with the running Node.js installation.
 *
 * On Windows the `npx` on PATH is actually `npx.cmd`, which Node.js (since
 * 20.12 due to CVE-2024-27980) refuses to spawn from `execFile`/`spawn`
 * without `shell: true`. Going through a shell reintroduces quoting bugs for
 * user-supplied args. Instead we find the real `npx-cli.js` and invoke it
 * directly via the current `node` binary, which works identically on every
 * platform and needs no shell.
 */
function findNpxCli(): string | null {
  const nodeDir = dirname(execPath);
  const candidates = [
    // Windows MSI installer layout: node.exe and node_modules share a dir
    join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js"),
    // Unix layout: .../bin/node + .../lib/node_modules/npm/bin/npx-cli.js
    join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js"),
    // nvm-windows / fnm layout: .../nodejs/<version>/node.exe
    join(nodeDir, "..", "node_modules", "npm", "bin", "npx-cli.js"),
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

function spawnWithShell(command: string, args: string[], opts: { timeout?: number; cwd?: string; env?: NodeJS.ProcessEnv }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: opts.timeout,
      cwd: opts.cwd,
      env: opts.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error(`npx exited with code ${code}`), { stdout, stderr, code }));
    });
  });
}

export interface RunNpxOptions {
  timeout?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface RunNpxResult {
  stdout: string;
  stderr: string;
}

/**
 * Cross-platform wrapper for invoking `npx <args>`.
 *
 * Prefers finding the real `npx-cli.js` and running it directly via node
 * (no shell, clean args). Falls back to shell-based spawn on Windows when
 * the JS entry point cannot be located (e.g. unusual Node.js layouts).
 */
export async function runNpx(args: string[], opts: RunNpxOptions = {}): Promise<RunNpxResult> {
  const npxCli = findNpxCli();
  if (npxCli) {
    return execFileAsync(execPath, [npxCli, ...args], {
      timeout: opts.timeout,
      cwd: opts.cwd,
      env: opts.env,
    });
  }

  // Last resort: shell-based spawn (only safe when args are controlled, not
  // user-supplied). Required on Windows because .cmd files cannot be executed
  // by execFile/spawn without shell:true.
  if (platform === "win32") {
    return spawnWithShell("npx", args, opts);
  }

  return execFileAsync("npx", args, {
    timeout: opts.timeout,
    cwd: opts.cwd,
    env: opts.env,
  });
}

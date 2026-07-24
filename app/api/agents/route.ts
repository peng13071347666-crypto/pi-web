import { NextResponse } from "next/server";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  rmSync,
  mkdirSync,
} from "fs";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { basename, extname, join, resolve as pathResolve, sep as pathSep, } from "path";

function mkdirSyncRecursive(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function isUnder(filePath: string, base: string): boolean {
  try {
    const r = pathResolve(filePath);
    const b = pathResolve(base);
    return r === b || r.startsWith(b + pathSep);
  } catch {
    return false;
  }
}

export const dynamic = "force-dynamic";

// ---------- types ----------

type SourceType = "npm" | "git" | "user" | "project";

interface AgentInfo {
  name: string;
  description: string;
  filePath: string;
  tools?: string;
  model?: string;
  thinking?: string;
  /** origin package tag for customized forks, e.g. "npm:pi-subagents" */
  customizedFrom?: string;
  /** this file's own frontmatter enable state */
  ownEnabled: boolean;
  /** effective state after override precedence (what the extension will use) */
  effectiveEnabled: boolean;
  /** a higher-priority file with the same name exists */
  overridden: boolean;
  /** true when this file is a skinny override stub (no real system prompt body) */
  skinnyOverride: boolean;
  /** group this file belongs to */
  groupId: string;
  groupType: SourceType;
}

interface Group {
  type: SourceType;
  id: string; // "npm:<pkg>", "git:<pkg>", "user", "project"
  label: string; // display name
  basePath: string;
  editable: boolean; // user/project = true (can create/delete); npm/git = false
  agents: AgentInfo[];
}

// ---------- helpers ----------

function readFileSafe(p: string): string | null {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function findMdFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  let stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(cur);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const fullPath = join(cur, entry);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(fullPath);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(fullPath);
      } else if (st.isFile() && entry.endsWith(".md")) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

function isDisabledFrontmatter(fm: Record<string, unknown>): boolean {
  if (fm["disabled"] === true) return true;
  if (fm["enabled"] === false) return true;
  return false;
}

/** Detect a "skinny override" stub: empty body + only benign frontmatter keys. */
function isSkinnyOverride(content: string, fm: Record<string, unknown>): boolean {
  const { body } = parseFrontmatter(content);
  if (body.trim().length > 0) return false;
  const allowed = new Set(["name", "description", "disabled", "enabled"]);
  for (const k of Object.keys(fm)) {
    if (!allowed.has(k)) return false;
  }
  return true;
}

function parseAgentFile(
  filePath: string,
  groupId: string,
  groupType: SourceType
): AgentInfo | null {
  const content = readFileSafe(filePath);
  if (content === null) return null;
  try {
    const { frontmatter, body } = parseFrontmatter<{
      name?: string;
      description?: string;
      tools?: string;
      model?: string;
      thinking?: string;
      customizedFrom?: string;
      disabled?: boolean;
      enabled?: boolean;
    }>(content);
    const name = frontmatter.name ?? basename(filePath, extname(filePath));
    const ownEnabled = !isDisabledFrontmatter(frontmatter as Record<string, unknown>);
    let skinny = false;
    if (body.trim().length === 0) {
      const allowed = new Set(["name", "description", "disabled", "enabled"]);
      skinny = Object.keys(frontmatter).every((k) => allowed.has(k));
    }
    return {
      name,
      description: frontmatter.description ?? "",
      filePath,
      tools: frontmatter.tools,
      model: frontmatter.model,
      thinking: frontmatter.thinking,
      customizedFrom: frontmatter.customizedFrom
        ? String(frontmatter.customizedFrom).replace(/^"|"$/g, "")
        : undefined,
      ownEnabled,
      effectiveEnabled: ownEnabled, // patched later
      overridden: false, // patched later
      skinnyOverride: skinny,
      groupId,
      groupType,
    };
  } catch {
    return null;
  }
}

// ---------- group scanners ----------

function scanDirGroup(
  dir: string,
  type: SourceType,
  id: string,
  label: string,
  editable: boolean
): Group | null {
  const files = findMdFiles(dir);
  if (files.length === 0) return null;
  const agents: AgentInfo[] = [];
  for (const filePath of files) {
    const a = parseAgentFile(filePath, id, type);
    if (a) agents.push(a);
  }
  if (agents.length === 0) return null;
  agents.sort((a, b) => a.name.localeCompare(b.name));
  return { type, id, label, basePath: dir, editable, agents };
}

function scanNpmGroups(agentDir: string): Group[] {
  const nm = join(agentDir, "npm", "node_modules");
  const groups: Group[] = [];
  if (!existsSync(nm)) return groups;

  const tryPkg = (pkgDir: string, pkgName: string) => {
    const agentsDir = join(pkgDir, "agents");
    if (!existsSync(agentsDir)) return;
    const g = scanDirGroup(
      agentsDir,
      "npm",
      `npm:${pkgName}`,
      pkgName,
      false
    );
    if (g) groups.push(g);
  };

  let entries: string[];
  try {
    entries = readdirSync(nm);
  } catch {
    return groups;
  }
  for (const entry of entries) {
    if (entry.startsWith(".") || entry.startsWith("@")) continue;
    const pkgDir = join(nm, entry);
    if (!statSyncSafeDir(pkgDir)) continue;
    tryPkg(pkgDir, entry);
  }
  // scoped packages: @scope/pkg
  for (const entry of entries) {
    if (!entry.startsWith("@")) continue;
    const scopeDir = join(nm, entry);
    if (!statSyncSafeDir(scopeDir)) continue;
    let scopeEntries: string[];
    try {
      scopeEntries = readdirSync(scopeDir);
    } catch {
      continue;
    }
    for (const child of scopeEntries) {
      if (child.startsWith(".")) continue;
      const pkgDir = join(scopeDir, child);
      if (!statSyncSafeDir(pkgDir)) continue;
      tryPkg(pkgDir, `${entry}/${child}`);
    }
  }
  return groups;
}

function scanGitGroups(agentDir: string): Group[] {
  const gitRoot = join(agentDir, "git");
  const groups: Group[] = [];
  if (!existsSync(gitRoot)) return groups;
  let top: string[];
  try {
    top = readdirSync(gitRoot);
  } catch {
    return groups;
  }
  for (const entry of top) {
    if (entry.startsWith(".")) continue;
    const pkgDir = join(gitRoot, entry);
    if (!statSyncSafeDir(pkgDir)) continue;
    const agentsDir = join(pkgDir, "agents");
    if (!existsSync(agentsDir)) continue;
    const g = scanDirGroup(agentsDir, "git", `git:${entry}`, entry, false);
    if (g) groups.push(g);
  }
  return groups;
}

function statSyncSafeDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// ---------- override precedence ----------

// priority: project (4) > user (3) > git (2) > npm (1)
function groupPriority(type: SourceType): number {
  switch (type) {
    case "project":
      return 4;
    case "user":
      return 3;
    case "git":
      return 2;
    case "npm":
      return 1;
  }
}

function applyOverridePrecedence(groups: Group[]): void {
  // map name -> highest-priority AgentInfo
  const topByName = new Map<string, AgentInfo>();
  for (const g of groups) {
    for (const a of g.agents) {
      const cur = topByName.get(a.name);
      if (!cur || groupPriority(g.type) > groupPriority(cur.groupType)) {
        topByName.set(a.name, a);
      }
    }
  }
  for (const g of groups) {
    for (const a of g.agents) {
      const top = topByName.get(a.name)!;
      a.overridden = top !== a;
      a.effectiveEnabled = top.ownEnabled;
    }
  }
}

// ---------- GET ----------

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  try {
    const agentDir = getAgentDir();
    const groups: Group[] = [];

    // npm packages
    groups.push(...scanNpmGroups(agentDir));
    // git packages
    groups.push(...scanGitGroups(agentDir));
    // user
    const userDir = join(agentDir, "agents");
    const ug = scanDirGroup(userDir, "user", "user", "My agents", true);
    if (ug) groups.push(ug);
    // project
    const projectDir = join(cwd, ".pi", "agents");
    const pg = scanDirGroup(projectDir, "project", "project", "This project", true);
    if (pg) groups.push(pg);

    applyOverridePrecedence(groups);

    // sort: project, user, git(n), npm(n) — editable first then by type
    const typeOrder: Record<SourceType, number> = {
      project: 0,
      user: 1,
      git: 2,
      npm: 3,
    };
    groups.sort((a, b) => {
      const d = typeOrder[a.type] - typeOrder[b.type];
      if (d !== 0) return d;
      return a.label.localeCompare(b.label);
    });

    return NextResponse.json({ groups });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// ---------- frontmatter text manipulation ----------

const FM_OPEN = /^---\r?\n/;
const FM_LINE = (key: string) =>
  new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:.*\\r?\\n`, "m");

function ensureFrontmatterOpen(text: string): string {
  if (FM_OPEN.test(text)) return text;
  return `---\n---\n${text}`;
}

function setField(text: string, key: string, value: string): string {
  const pat = FM_LINE(key);
  if (pat.test(text)) {
    return text.replace(pat, `${key}: ${value}\n`);
  }
  return ensureFrontmatterOpen(text).replace(FM_OPEN, `---\n${key}: ${value}\n`);
}

function removeField(text: string, key: string): string {
  const pat = FM_LINE(key);
  if (pat.test(text)) return text.replace(pat, "");
  return text;
}

function setDisabledOnFile(filePath: string): void {
  let content = readFileSafe(filePath);
  if (content === null) return;
  // drop any existing "enabled: ..." line, then write disabled:true + enabled:false
  content = removeField(content, "enabled");
  content = setField(content, "disabled", "true");
  content = setField(content, "enabled", "false");
  writeFileSync(filePath, content, "utf8");
}

function clearDisableOnFileOrDelete(filePath: string): void {
  const content = readFileSafe(filePath);
  if (content === null) return;
  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);
  const skinny =
    body.trim().length === 0 &&
    Object.keys(frontmatter).every((k) =>
      ["name", "description", "disabled", "enabled"].includes(k)
    );
  if (skinny) {
    rmSync(filePath, { force: true });
    return;
  }
  let next = removeField(content, "disabled");
  next = removeField(next, "enabled");
  writeFileSync(filePath, next, "utf8");
}

function createSkinnyOverride(filePath: string, name: string): void {
  const content = `---\nname: ${name}\ndescription: Disabled via pi-web\ndisabled: true\nenabled: false\n---\n`;
  writeFileSync(filePath, content, "utf8");
}

// ---------- PATCH: toggle by name ----------

export async function PATCH(req: Request) {
  try {
    const body = await req.json();

    // ---- field-edit mode: { filePath, updates?: { model?, tools?, description?, thinking? } } ----
    if (body.filePath && body.updates) {
      const { filePath, updates } = body;
      if (!existsSync(filePath)) {
        return NextResponse.json({ error: "file not found" }, { status: 404 });
      }
      // only allow editing files the user owns (user/project agents)
      const agentDir = getAgentDir();
      const userDir = join(agentDir, "agents");
      const projectDir = body.cwd ? join(body.cwd, ".pi", "agents") : null;
      const ok = isUnder(filePath, userDir) || (projectDir ? isUnder(filePath, projectDir) : false);
      if (!ok) {
        return NextResponse.json(
          { error: "builtin agents are read-only; create a user/project override to customize" },
          { status: 403 }
        );
      }
      let content = readFileSafe(filePath);
      if (content === null) return NextResponse.json({ error: "unreadable" }, { status: 500 });
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined) continue;
        if (value === null || value === "") {
          content = removeField(content, key);
        } else {
          content = setField(content, key, String(value));
        }
      }
      writeFileSync(filePath, content, "utf8");
      return NextResponse.json({ success: true });
    }

    // ---- toggle mode: { name, enabled, cwd } ----
    const { name, enabled, cwd } = body;
    if (!name || typeof enabled !== "boolean") {
      return NextResponse.json(
        { error: "name and enabled (boolean) required" },
        { status: 400 }
      );
    }
    const agentDir = getAgentDir();
    const userDir = join(agentDir, "agents");
    const projectDir = cwd ? join(cwd, ".pi", "agents") : null;
    const userFile = join(userDir, `${name}.md`);
    const projectFile = projectDir ? join(projectDir, `${name}.md`) : null;

    const projectExists = projectFile ? existsSync(projectFile) : false;
    const userExists = existsSync(userFile);

    if (!enabled) {
      // disable
      if (projectExists) {
        setDisabledOnFile(projectFile!);
      } else if (userExists) {
        setDisabledOnFile(userFile);
      } else {
        // builtin (read-only) — create user override stub
        createSkinnyOverride(userFile, name);
      }
      return NextResponse.json({ success: true, action: "disabled" });
    } else {
      // enable
      if (projectExists) {
        clearDisableOnFileOrDelete(projectFile!);
        return NextResponse.json({ success: true, action: "enabled" });
      } else if (userExists) {
        clearDisableOnFileOrDelete(userFile);
        return NextResponse.json({ success: true, action: "enabled" });
      } else {
        // nothing to enable (builtin default is enabled)
        return NextResponse.json({ success: true, action: "noop" });
      }
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// ---------- POST: create a custom agent ----------

interface CreateBody {
  scope: "user" | "project";
  name?: string; // omitted when duplicating; can override
  description?: string;
  model?: string;
  thinking?: string;
  tools?: string;
  systemPrompt?: string;
  extraFrontmatter?: string; // raw YAML lines to merge
  cwd?: string;
  // duplication mode: fork a full copy (frontmatter + system prompt body) of an existing agent
  duplicateFrom?: string; // absolute path to source agent .md
  // when duplicating, listing one of these wipes that field from the copy (set null)
  clearFields?: string[];
}

function safeFileName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (/[\\/:*?"<>|]/.test(trimmed)) return null;
  if (trimmed.includes("..")) return null;
  return trimmed;
}

function buildAgentFile(body: CreateBody): string {
  const fm: string[] = ["---"];
  fm.push(`name: ${body.name!.trim()}`);
  if (body.description) fm.push(`description: ${body.description}`);
  if (body.model) fm.push(`model: ${body.model}`);
  if (body.thinking) fm.push(`thinking: ${body.thinking}`);
  if (body.tools) fm.push(`tools: ${body.tools}`);
  if (body.extraFrontmatter) {
    for (const line of body.extraFrontmatter.split(/\r?\n/)) {
      const t = line.trim();
      if (t) fm.push(t);
    }
  }
  fm.push("---");
  fm.push("");
  fm.push(body.systemPrompt ?? "");
  fm.push("");
  return fm.join("\n");
}

// Fork a full copy of an existing agent file, then apply field overrides on top.
// Used by "Customize" — the forked copy starts byte-identical to the source,
// so the agent's carefully-tuned system prompt is preserved.
type ForkResult =
  | { error: string }
  | { content: string; finalName: string; customizedFrom: string | null };

// Infer a stable package id from a source agent path, e.g.
//   .../npm/node_modules/pi-subagents/agents/scout.md -> "npm:pi-subagents"
//   .../git/@scope/pkg/agents/x.md                -> "git:@scope/pkg"
// Returns null for user/project scratch files.
function derivePackageFromPath(filePath: string): string | null {
  const p = filePath.replace(/\\/g, "/");
  let idx = p.indexOf("/npm/node_modules/");
  if (idx >= 0) {
    const tail = p.slice(idx + "/npm/node_modules/".length);
    const pkg = tail.split("/agents/")[0];
    if (pkg) return `npm:${pkg}`;
  }
  idx = p.indexOf("/git/");
  if (idx >= 0) {
    const tail = p.slice(idx + "/git/".length);
    const pkg = tail.split("/agents/")[0];
    if (pkg) return `git:${pkg}`;
  }
  return null;
}

function forkAgentFile(
  sourcePath: string,
  body: CreateBody
): ForkResult {
  let content = readFileSafe(sourcePath);
  if (content === null) return { error: "source file not readable" };
  // derive source name from frontmatter (fallback to filename)
  let srcName = "";
  try {
    const { frontmatter } = parseFrontmatter<{ name?: string }>(content);
    srcName = frontmatter.name ?? basename(sourcePath, ".md");
  } catch {
    srcName = basename(sourcePath, ".md");
  }
  const finalName = body.name?.trim() ? body.name!.trim() : srcName;
  // apply name override
  if (body.name && body.name.trim() && body.name.trim() !== srcName) {
    content = setField(content, "name", body.name.trim());
  }
  // apply field overrides (set) and clears (remove)
  const fieldMap: Record<string, string | undefined> = {
    description: body.description,
    model: body.model,
    thinking: body.thinking,
    tools: body.tools,
  };
  for (const [key, val] of Object.entries(fieldMap)) {
    if (val === undefined) continue;
    if (val === "") content = removeField(content, key);
    else content = setField(content, key, val);
  }
  if (Array.isArray(body.clearFields)) {
    for (const k of body.clearFields) content = removeField(content, k);
  }
  // tag the fork with its source package so the UI can group customized
  // copies under their origin project (foldable).
  const customizedFrom = derivePackageFromPath(sourcePath);
  if (customizedFrom) {
    // quote the scalar because the value contains a colon
    content = setField(content, "customizedFrom", `"${customizedFrom}"`);
  }
  return { content, finalName, customizedFrom } as ForkResult;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CreateBody;
    if (!body.scope) {
      return NextResponse.json({ error: "scope required" }, { status: 400 });
    }
    const agentDir = getAgentDir();
    const dir =
      body.scope === "project"
        ? join(body.cwd ?? "", ".pi", "agents")
        : join(agentDir, "agents");
    const ensureDir = () => {
      if (!existsSync(dir)) mkdirSyncRecursive(dir);
    };
    // ----- duplication mode (Customize) -----
    if (body.duplicateFrom) {
      const src = body.duplicateFrom;
      if (!existsSync(src)) {
        return NextResponse.json({ error: "source file not found" }, { status: 404 });
      }
      const result: ForkResult = forkAgentFile(src, body);
      if ("error" in result)
        return NextResponse.json({ error: result.error }, { status: 500 });
      if (!("content" in result))
        return NextResponse.json({ error: "unexpected" }, { status: 500 });
      const { content, finalName } = result;
      const safe = safeFileName(finalName);
      if (!safe) {
        return NextResponse.json({ error: "invalid derived name" }, { status: 400 });
      }
      ensureDir();
      const filePath = join(dir, `${safe}.md`);
      if (existsSync(filePath)) {
        return NextResponse.json(
          { error: `agent "${safe}" already exists at this scope. Edit it instead.` },
          { status: 409 }
        );
      }
      writeFileSync(filePath, content, "utf8");
      return NextResponse.json({ success: true, filePath, customized: true });
    }
    // ----- scratch (blank) create mode -----
    if (!body.name) {
      return NextResponse.json(
        { error: "name required (unless duplicateFrom is set)" },
        { status: 400 }
      );
    }
    const safe = safeFileName(body.name);
    if (!safe) {
      return NextResponse.json(
        { error: "invalid name (no path separators, traversal, or shell chars)" },
        { status: 400 }
      );
    }
    ensureDir();
    const filePath = join(dir, `${safe}.md`);
    if (existsSync(filePath)) {
      return NextResponse.json(
        { error: `agent "${safe}" already exists at this scope` },
        { status: 409 }
      );
    }
    const content = buildAgentFile({ ...body, name: safe });
    writeFileSync(filePath, content, "utf8");
    return NextResponse.json({ success: true, filePath });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// ---------- DELETE: remove a custom agent ----------

export async function DELETE(req: Request) {
  try {
    const body = await req.json();
    const { filePath } = body;
    if (!filePath || typeof filePath !== "string") {
      return NextResponse.json({ error: "filePath required" }, { status: 400 });
    }
    // safety: only allow deleting under user or project agents dir
    const agentDir = getAgentDir();
    const userDir = join(agentDir, "agents");
    const cwd = body.cwd;
    const projectDir = cwd ? join(cwd, ".pi", "agents") : null;
    const ok =
      isUnder(filePath, userDir) ||
      (projectDir ? isUnder(filePath, projectDir) : false);
    if (!ok) {
      return NextResponse.json(
        { error: "only custom agents under user or project agents dir can be deleted" },
        { status: 403 }
      );
    }
    if (!existsSync(filePath)) {
      return NextResponse.json({ error: "file not found" }, { status: 404 });
    }
    rmSync(filePath, { force: true });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
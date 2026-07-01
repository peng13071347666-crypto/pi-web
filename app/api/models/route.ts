import { stat } from "fs/promises";
import { createAgentSessionServices, getAgentDir, type SettingsManager } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";

export const dynamic = "force-dynamic";

const modelNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareModelEntries(
  a: { id: string; name: string; provider: string },
  b: { id: string; name: string; provider: string }
): number {
  return modelNameCollator.compare(a.name || a.id, b.name || b.id)
    || modelNameCollator.compare(a.provider, b.provider)
    || modelNameCollator.compare(a.id, b.id);
}

export async function GET(req: Request) {
  const nameMap = new Map<string, string>();
  let modelList: { id: string; name: string; provider: string }[] = [];
  let defaultModel: { provider: string; modelId: string } | null = null;
  const thinkingLevels: Record<string, string[]> = {};
  const thinkingLevelMaps: Record<string, Record<string, string | null>> = {};
  const cwd = new URL(req.url).searchParams.get("cwd") || process.cwd();

  let cwdStat;
  try {
    cwdStat = await stat(cwd);
  } catch {
    return Response.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
  }
  if (!cwdStat.isDirectory()) {
    return Response.json({ error: `Not a directory: ${cwd}` }, { status: 400 });
  }

  try {
    const agentDir = getAgentDir();
    const services = await createAgentSessionServices({ cwd, agentDir });
    const registry = services.modelRegistry;
    const available = registry.getAvailable();
    modelList = available.map((m: { id: string; name: string; provider: string; input?: string[] }) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      input: m.input ?? [],
    })).sort(compareModelEntries);
    for (const m of available) {
      const key = `${m.provider}:${m.id}`;
      nameMap.set(key, m.name);
      thinkingLevels[key] = getSupportedThinkingLevels(m);
      if (m.thinkingLevelMap) thinkingLevelMaps[key] = m.thinkingLevelMap;
    }

    const settings: SettingsManager = services.settingsManager;
    const provider = settings.getDefaultProvider();
    const modelId = settings.getDefaultModel();
    if (provider && modelId && available.some((m) => m.provider === provider && m.id === modelId)) {
      defaultModel = { provider, modelId };
    }
  } catch (e) {
    // Log the real cause so it's visible in the server console. Previously
    // this was `catch { /* return empty */ }` which silently hid version-mismatch
    // parse failures (e.g. models.json written by a newer pi than pi-web bundles).
    // The /api/version-check banner surfaces the version diagnosis; here we at
    // least keep the stack trace reachable for debugging.
    console.error("[api/models] failed to load model registry:", e);
  }

  return Response.json({ models: Object.fromEntries(nameMap), modelList, defaultModel, thinkingLevels, thinkingLevelMaps });
}

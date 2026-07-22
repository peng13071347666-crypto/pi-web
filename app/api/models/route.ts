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

// ============================================================================
// In-memory cache: avoids re-initializing the full model registry on every request.
// Cache is keyed by cwd and invalidated after CACHE_TTL_MS or when ?refresh=1 is passed.
// ============================================================================
const CACHE_TTL_MS = 30_000; // 30 seconds

type ModelsCacheEntry = {
  timestamp: number;
  data: {
    models: Record<string, string>;
    modelList: { id: string; name: string; provider: string; input?: string[] }[];
    defaultModel: { provider: string; modelId: string } | null;
    thinkingLevels: Record<string, string[]>;
    thinkingLevelMaps: Record<string, Record<string, string | null>>;
  };
};

declare global {
  var __piModelsCache: Map<string, ModelsCacheEntry> | undefined;
}

function getModelsCache(): Map<string, ModelsCacheEntry> {
  if (!globalThis.__piModelsCache) globalThis.__piModelsCache = new Map();
  return globalThis.__piModelsCache;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const cwd = url.searchParams.get("cwd") || process.cwd();
  const forceRefresh = url.searchParams.get("refresh") === "1";

  let cwdStat;
  try {
    cwdStat = await stat(cwd);
  } catch {
    return Response.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
  }
  if (!cwdStat.isDirectory()) {
    return Response.json({ error: `Not a directory: ${cwd}` }, { status: 400 });
  }

  // Check cache
  const cache = getModelsCache();
  if (!forceRefresh) {
    const cached = cache.get(cwd);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return Response.json(cached.data);
    }
  }

  const nameMap = new Map<string, string>();
  let modelList: { id: string; name: string; provider: string; input?: string[] }[] = [];
  let defaultModel: { provider: string; modelId: string } | null = null;
  const thinkingLevels: Record<string, string[]> = {};
  const thinkingLevelMaps: Record<string, Record<string, string | null>> = {};

  try {
    const agentDir = getAgentDir();
    const services = await createAgentSessionServices({ cwd, agentDir });
    const runtime = services.modelRuntime;
    const available = await runtime.getAvailable();
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
    console.error("[api/models] failed to load model registry:", e);
  }

  const data = { models: Object.fromEntries(nameMap), modelList, defaultModel, thinkingLevels, thinkingLevelMaps };

  // Store in cache
  cache.set(cwd, { timestamp: Date.now(), data });
  // Prevent unbounded growth
  if (cache.size > 10) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }

  return Response.json(data);
}

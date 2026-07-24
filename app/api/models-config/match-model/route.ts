import { createAgentSessionServices, getAgentDir } from "@earendil-works/pi-coding-agent";
import { getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";

export const dynamic = "force-dynamic";

type ModelMatch = {
  id: string;
  name?: string;
  provider: string;
  builtin: boolean;
  api?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  compat?: unknown;
};

function serializeModel(model: {
  id: string;
  name?: string;
  provider: string;
  api?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: ModelMatch["cost"];
  compat?: unknown;
}, builtin: boolean): ModelMatch {
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    builtin,
    api: model.api,
    reasoning: model.reasoning,
    thinkingLevelMap: model.thinkingLevelMap,
    input: model.input,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    cost: model.cost,
    compat: model.compat as Record<string, unknown> | undefined,
  };
}

function metadataScore(model: ModelMatch): number {
  return [
    model.name,
    model.api,
    model.reasoning !== undefined,
    model.thinkingLevelMap,
    model.input,
    model.contextWindow,
    model.maxTokens,
    model.cost,
    model.compat,
  ].filter(Boolean).length;
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { modelId?: string; excludeProvider?: string };
    const modelId = body.modelId?.trim();
    if (!modelId) {
      return Response.json({ ok: false, error: "modelId is required" }, { status: 400 });
    }

    const services = await createAgentSessionServices({ cwd: process.cwd(), agentDir: getAgentDir() });
    const runtime = services.modelRuntime;
    const allMatches = runtime
      .getModels()
      .filter((model) => model.id === modelId && model.provider !== body.excludeProvider);

    // Prefer pi's native provider catalog. If a model is not present there,
    // fall back to other configured providers so the feature remains useful
    // for locally registered aliases too.
    const builtinProviderIds = new Set<string>(getBuiltinProviders());
    const builtinMatches = allMatches.filter((model) => builtinProviderIds.has(model.provider));
    const candidates = builtinMatches.length > 0 ? builtinMatches : allMatches;
    const matches = candidates
      .map((model) => serializeModel(model, builtinMatches.length > 0))
      .sort((a, b) => metadataScore(b) - metadataScore(a) || a.provider.localeCompare(b.provider));

    return Response.json({ ok: true, matches, match: matches[0] ?? null });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

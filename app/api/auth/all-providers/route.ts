import { createAuthStorage, createModelRegistry } from "@/lib/auth-compat";

export const dynamic = "force-dynamic";

const OAUTH_PROVIDER_IDS = new Set(["anthropic", "github-copilot", "openai-codex"]);

export async function GET() {
  try {
    const authStorage = createAuthStorage();
    const registry = await createModelRegistry(authStorage);
    const all = registry.getAll();

    const seen = new Set<string>();
    const result: {
      id: string;
      displayName: string;
      configured: boolean;
      source?: string;
      modelCount: number;
    }[] = [];

    for (const m of all) {
      if (seen.has(m.provider)) continue;
      seen.add(m.provider);
      if (OAUTH_PROVIDER_IDS.has(m.provider)) continue;
      const status = registry.getProviderAuthStatus(m.provider);
      if (status.source === "models_json_key") continue;
      const displayName = registry.getProviderDisplayName(m.provider);
      const modelCount = all.filter((x: any) => x.provider === m.provider).length;
      result.push({
        id: m.provider,
        displayName,
        configured: status.configured,
        source: status.source,
        modelCount,
      });
    }

    return Response.json({ providers: result });
  } catch (e) {
    return Response.json({ providers: [], error: String(e) });
  }
}

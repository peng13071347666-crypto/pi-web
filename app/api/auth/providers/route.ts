import { createAuthStorage } from "@/lib/auth-compat";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

export const dynamic = "force-dynamic";

export async function GET() {
  const authStorage = createAuthStorage();
  const storedCredentials = await authStorage.list() as readonly { providerId: string; type: string }[];
  const providers = builtinProviders().filter((provider) => provider.auth.oauth);

  const EXCLUDED = new Set(["anthropic"]);
  const DISPLAY_NAMES: Record<string, string> = {
    "openai-codex": "ChatGPT Plus/Pro",
    "github-copilot": "GitHub Copilot",
  };

  const result = await Promise.all(
    providers
      .filter((p) => !EXCLUDED.has(p.id))
      .map(async (p) => {
        const loggedIn = storedCredentials.some((credential) => credential.providerId === p.id && credential.type === "oauth");
        return {
          id: p.id,
          name: DISPLAY_NAMES[p.id] ?? p.auth.oauth?.name ?? p.name,
          usesCallbackServer: false,
          loggedIn,
        };
      })
  );

  return Response.json({ providers: result });
}

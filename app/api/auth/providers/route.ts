import { createAuthStorage } from "@/lib/auth-compat";

export const dynamic = "force-dynamic";

export async function GET() {
  const authStorage = createAuthStorage();
  const providers = authStorage.getOAuthProviders();

  const EXCLUDED = new Set(["anthropic"]);
  const DISPLAY_NAMES: Record<string, string> = {
    "openai-codex": "ChatGPT Plus/Pro",
    "github-copilot": "GitHub Copilot",
  };

  const result = await Promise.all(
    providers
      .filter((p: any) => !EXCLUDED.has(p.id))
      .map(async (p: any) => {
        const loggedIn = authStorage.has(p.id);
        return {
          id: p.id,
          name: DISPLAY_NAMES[p.id] ?? p.name,
          usesCallbackServer: p.usesCallbackServer ?? false,
          loggedIn,
        };
      })
  );

  return Response.json({ providers: result });
}

import { createAuthStorage } from "@/lib/auth-compat";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const authStorage = createAuthStorage();
  const providers = authStorage.getOAuthProviders();
  if (!providers.find((p: any) => p.id === provider)) {
    return Response.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  }
  authStorage.logout(provider);
  return Response.json({ ok: true });
}

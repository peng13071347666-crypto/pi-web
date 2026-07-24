import { createModelRuntime } from "@/lib/auth-compat";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const runtime = await createModelRuntime();
  const providerInfo = runtime.getProvider(provider);
  if (!providerInfo?.auth.oauth) {
    return Response.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  }
  await runtime.logout(provider);
  return Response.json({ ok: true });
}

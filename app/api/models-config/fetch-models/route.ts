import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface FetchModelsRequest {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

interface ModelInfo {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  input?: string[];
  cost?: { input?: number; output?: number };
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function extractModelInfo(raw: unknown): ModelInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id : null;
  if (!id) return null;

  const info: ModelInfo = { id };

  // Name
  if (typeof obj.name === "string") info.name = obj.name;
  if (typeof obj.model === "string") info.name = info.name ?? obj.model;

  // Context window - various field names
  const ctx = obj.context_length ?? obj.contextWindow ?? obj.context_window
    ?? obj.maxContextLength ?? obj.max_context_length
    ?? (obj.top_provider && typeof obj.top_provider === "object"
      ? (obj.top_provider as Record<string, unknown>).context_length
      : undefined);
  if (typeof ctx === "number") info.contextWindow = ctx;

  // Max output tokens
  const maxOut = obj.max_completion_tokens ?? obj.maxTokens ?? obj.max_output_tokens
    ?? obj.max_output ?? obj.max_tokens;
  if (typeof maxOut === "number") info.maxTokens = maxOut;

  // Pricing (per token → per million)
  const pricing = obj.pricing ?? obj.price;
  if (pricing && typeof pricing === "object") {
    const p = pricing as Record<string, unknown>;
    const prompt = parseFloat(String(p.prompt ?? p.input ?? 0));
    const completion = parseFloat(String(p.completion ?? p.output ?? 0));
    if (prompt > 0 || completion > 0) {
      info.cost = {
        input: prompt > 0 && prompt < 1 ? prompt * 1_000_000 : prompt,
        output: completion > 0 && completion < 1 ? completion * 1_000_000 : completion,
      };
    }
  }

  // Capabilities
  const arch = obj.architecture;
  if (arch && typeof arch === "object") {
    const modality = (arch as Record<string, unknown>).modality;
    if (typeof modality === "string" && modality.includes("image")) {
      info.input = ["text", "image"];
    }
  }

  // Check for vision support
  const capabilities = obj.capabilities;
  if (capabilities && typeof capabilities === "object") {
    const caps = capabilities as Record<string, unknown>;
    if (caps.vision === true || caps.image_input === true) {
      info.input = ["text", "image"];
    }
  }

  // Reasoning / thinking support
  if (obj.reasoning === true || obj.thinking === true) {
    info.reasoning = true;
  }
  // Some APIs indicate reasoning via model ID patterns
  if (/o[134]|reason|think|deepseek-r|qwq/i.test(id)) {
    info.reasoning = true;
  }

  return info;
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as FetchModelsRequest;
    const baseUrl = normalizeUrl(body.baseUrl || "");
    if (!baseUrl) {
      return NextResponse.json({ ok: false, error: "baseUrl is required" }, { status: 400 });
    }

    // Try /v1/models first, then /models
    const urls = [`${baseUrl}/v1/models`, `${baseUrl}/models`];
    let lastError = "";
    let models: ModelInfo[] = [];

    for (const url of urls) {
      try {
        const headers: Record<string, string> = {
          "Accept": "application/json",
          ...body.headers,
        };
        if (body.apiKey) {
          headers["Authorization"] = `Bearer ${body.apiKey}`;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const res = await fetch(url, { headers, signal: controller.signal });
        clearTimeout(timeout);

        if (!res.ok) {
          lastError = `HTTP ${res.status} from ${url}`;
          continue;
        }

        const data = await res.json() as unknown;

        // Handle different response formats
        let rawModels: unknown[] = [];

        if (Array.isArray(data)) {
          rawModels = data;
        } else if (data && typeof data === "object") {
          const d = data as Record<string, unknown>;
          if (Array.isArray(d.data)) rawModels = d.data;
          else if (Array.isArray(d.models)) rawModels = d.models;
          else if (Array.isArray(d.results)) rawModels = d.results;
        }

        if (rawModels.length > 0) {
          models = rawModels
            .map(extractModelInfo)
            .filter((m): m is ModelInfo => m !== null);
          break; // Success
        } else {
          lastError = `No models found in response from ${url}`;
        }
      } catch (e) {
        lastError = e instanceof Error ? `${e.message} (${url})` : String(e);
      }
    }

    if (models.length === 0) {
      return NextResponse.json({
        ok: false,
        error: lastError || "Could not fetch models from any endpoint",
      });
    }

    // Sort by name
    models.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));

    return NextResponse.json({ ok: true, models });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

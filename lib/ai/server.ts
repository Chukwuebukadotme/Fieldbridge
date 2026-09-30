/** Shared request handling for the AI routes (server only). */

import { z } from "zod";

import { MODEL_ID_PATTERN, PROVIDERS, type ProviderId } from "./providers";

export const ProviderSchema = z.enum(["openai", "anthropic"]);
const ApiKeySchema = z.string().trim().max(400).optional();

export const ProposeRequestSchema = z.object({
  provider: ProviderSchema,
  apiKey: ApiKeySchema,
  model: z.string().trim().regex(MODEL_ID_PATTERN, "Invalid model identifier."),
  requirementsText: z.string().min(1).max(50_000),
  dictionary: z
    .array(
      z.object({
        field_name: z.string().max(200),
        data_type: z.string().max(50),
        description: z.string().max(1000),
        unit: z.string().max(100),
      }),
    )
    .min(1)
    .max(500),
});

export const VerifyRequestSchema = z.object({ provider: ProviderSchema, apiKey: ApiKeySchema });

const ENV_KEYS: Record<ProviderId, string> = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY" };

/** The key pasted in the browser wins; a key configured on the server is the fallback. */
export function resolveKey(provider: ProviderId, pasted: string | undefined): string | null {
  return pasted || process.env[ENV_KEYS[provider]] || null;
}

export function hasServerKey(provider: ProviderId): boolean {
  return Boolean(process.env[ENV_KEYS[provider]]);
}

export function missingKeyMessage(provider: ProviderId): string {
  return `No ${PROVIDERS[provider].label} API key. Add one in AI settings.`;
}

export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

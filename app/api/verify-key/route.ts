import { verifyAnthropicKey } from "@/lib/ai/anthropic";
import { ProviderError } from "@/lib/ai/errors";
import { verifyOpenAIKey } from "@/lib/ai/openai";
import { jsonError, missingKeyMessage, readJson, resolveKey, VerifyRequestSchema } from "@/lib/ai/server";

/** Confirm a key authenticates by listing models: free, and nothing is generated. */
export async function POST(request: Request) {
  const parsed = VerifyRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid request.", 400);
  const { provider, apiKey } = parsed.data;

  const key = resolveKey(provider, apiKey);
  if (!key) return jsonError(missingKeyMessage(provider), 400);
  try {
    await (provider === "openai" ? verifyOpenAIKey(key) : verifyAnthropicKey(key));
  } catch (error) {
    return jsonError(error instanceof ProviderError ? error.message : "Could not verify the key.", 401);
  }
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}

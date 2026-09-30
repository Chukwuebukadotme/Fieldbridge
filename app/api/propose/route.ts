import { proposeWithAnthropic } from "@/lib/ai/anthropic";
import { ProviderError } from "@/lib/ai/errors";
import { proposeWithOpenAI } from "@/lib/ai/openai";
import { validateBatch, withoutSamples } from "@/lib/ai/prompt";
import { jsonError, missingKeyMessage, ProposeRequestSchema, readJson, resolveKey } from "@/lib/ai/server";
import { MappingBatchSchema, TARGET_FIELDS } from "@/lib/models";

export const maxDuration = 120;

/** Ask the chosen provider for mapping proposals. The key is used for this call only: never stored or logged. */
export async function POST(request: Request) {
  const parsed = ProposeRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid request.", 400);
  const { provider, apiKey, model, requirementsText, dictionary } = parsed.data;

  const key = resolveKey(provider, apiKey);
  if (!key) return jsonError(missingKeyMessage(provider), 400);

  const fields = withoutSamples(dictionary);
  let raw;
  try {
    raw =
      provider === "openai"
        ? await proposeWithOpenAI(key, model, requirementsText, fields)
        : await proposeWithAnthropic(key, model, requirementsText, fields);
  } catch (error) {
    return jsonError(error instanceof ProviderError ? error.message : "The AI request failed.", 502);
  }

  // Validate independently of the SDK helper before anything is returned.
  const batch = MappingBatchSchema.safeParse(raw);
  if (!batch.success) return jsonError(`Malformed response: ${batch.error.issues.length} schema error(s).`, 502);
  const problems = validateBatch(batch.data, TARGET_FIELDS);
  if (problems.length) return jsonError(`Malformed response: ${problems.join(" ")}`, 502);

  return Response.json({ batch: batch.data, provider, model }, { headers: { "cache-control": "no-store" } });
}

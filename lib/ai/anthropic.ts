/** Anthropic adapter (server only). Calls the Messages API with a strict structured-output schema. */

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import { MappingBatchSchema, TARGET_FIELDS, type MappingBatch } from "../models";
import { buildUserPayload, SYSTEM_PROMPT, type PromptField } from "./prompt";
import { ProviderError, providerStatusMessage } from "./errors";

// Models that accept an explicit effort level and the server-side refusal fallback.
const EFFORT_AND_FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

function describe(error: unknown): ProviderError {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError("The request to Anthropic timed out.");
  if (error instanceof Anthropic.APIConnectionError) return new ProviderError("Could not connect to Anthropic.");
  if (error instanceof Anthropic.APIError) return new ProviderError(providerStatusMessage("Anthropic", error.status));
  return new ProviderError("Anthropic returned an unexpected error.");
}

export async function proposeWithAnthropic(apiKey: string, model: string, requirementsText: string, dictionary: PromptField[]): Promise<MappingBatch> {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 110_000 });
  const tuned = EFFORT_AND_FALLBACK_MODELS.has(model);
  let response;
  try {
    response = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPayload(requirementsText, dictionary, TARGET_FIELDS) }],
      output_config: {
        format: betaZodOutputFormat(MappingBatchSchema),
        // Medium effort keeps a live demo responsive; the checks that matter are deterministic.
        ...(tuned ? { effort: "medium" as const } : {}),
      },
      // If a safety classifier declines, the API re-runs the request on a recommended fallback model.
      ...(tuned ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
  } catch (error) {
    throw describe(error);
  }

  if (response.stop_reason === "refusal") throw new ProviderError("The model declined to answer this request.");
  if (response.stop_reason === "max_tokens") throw new ProviderError("The model's answer was cut off before it finished.");
  if (!response.parsed_output) throw new ProviderError("The model returned no structured output.");
  return response.parsed_output;
}

export async function verifyAnthropicKey(apiKey: string): Promise<void> {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 15_000 });
  try {
    await client.models.list({ limit: 1 }); // free; confirms the key authenticates
  } catch (error) {
    throw describe(error);
  }
}

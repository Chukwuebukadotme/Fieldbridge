/** OpenAI adapter (server only). Calls the Responses API with a strict structured-output schema. */

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import { MappingBatchSchema, TARGET_FIELDS, type MappingBatch } from "../models";
import { buildUserPayload, SYSTEM_PROMPT, type PromptField } from "./prompt";
import { ProviderError, providerStatusMessage } from "./errors";

function describe(error: unknown): ProviderError {
  if (error instanceof OpenAI.APIConnectionTimeoutError) return new ProviderError("The request to OpenAI timed out.");
  if (error instanceof OpenAI.APIConnectionError) return new ProviderError("Could not connect to OpenAI.");
  // Built from the status code only: OpenAI's own messages can echo part of the key.
  if (error instanceof OpenAI.APIError) return new ProviderError(providerStatusMessage("OpenAI", error.status));
  return new ProviderError("OpenAI returned an unexpected error.");
}

export async function proposeWithOpenAI(apiKey: string, model: string, requirementsText: string, dictionary: PromptField[]): Promise<MappingBatch> {
  const client = new OpenAI({ apiKey, maxRetries: 1, timeout: 110_000 });
  let response;
  try {
    response = await client.responses.parse({
      model,
      instructions: SYSTEM_PROMPT,
      input: buildUserPayload(requirementsText, dictionary, TARGET_FIELDS),
      text: { format: zodTextFormat(MappingBatchSchema, "mapping_batch") },
    });
  } catch (error) {
    throw describe(error);
  }
  if (!response.output_parsed) throw new ProviderError("The model returned no structured output.");
  return response.output_parsed;
}

export async function verifyOpenAIKey(apiKey: string): Promise<void> {
  const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 15_000 });
  try {
    await client.models.list(); // free; confirms the key authenticates
  } catch (error) {
    throw describe(error);
  }
}

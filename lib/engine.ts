/**
 * AI interpretation layer, client side: an optional live request through /api/propose,
 * with the saved Demo-mode response as fallback. The model only proposes; its output is
 * validated before anything is stored, and anything malformed is discarded.
 */

import demoJson from "@/public/demo/demo_mappings.json";

import { validateBatch, withoutSamples } from "./ai/prompt";
import { modelLabel, PROVIDERS, type ProviderId } from "./ai/providers";
import { MappingBatchSchema, type DictionaryField, type MappingBatch, type TargetField } from "./models";

export const DEMO_MAPPINGS_FILE = "demo_mappings.json";

export class MappingEngineError extends Error {
  name = "MappingEngineError";
}

export interface LiveRequest {
  provider: ProviderId;
  apiKey: string;
  model: string;
}

export interface GenerationResult {
  batch: MappingBatch;
  sourceLabel: string; // shown to the user and written into the brief
  origin: "demo" | "live_ai";
  notice: string | null; // concise message when live mode fell back
}

export function loadDemoBatch(raw: unknown = demoJson): MappingBatch {
  const parsed = MappingBatchSchema.safeParse(raw);
  if (!parsed.success) {
    throw new MappingEngineError(`Demo response ${DEMO_MAPPINGS_FILE} is invalid: ${parsed.error.issues.length} schema error(s).`);
  }
  return parsed.data;
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export async function requestLiveMappings(
  live: LiveRequest,
  requirementsText: string,
  dictionary: DictionaryField[],
  targets: TargetField[],
  fetcher: Fetcher = fetch,
): Promise<MappingBatch> {
  let response: Response;
  try {
    response = await fetcher("/api/propose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: live.provider,
        apiKey: live.apiKey,
        model: live.model,
        requirementsText,
        dictionary: withoutSamples(dictionary),
      }),
    });
  } catch {
    throw new MappingEngineError("Could not reach the server.");
  }
  const body = (await response.json().catch(() => null)) as { batch?: unknown; error?: string } | null;
  if (!response.ok || !body?.batch) throw new MappingEngineError(body?.error ?? `Request failed (${response.status}).`);

  // Re-validate on the client as well: the server is trusted code, the model output is not.
  const parsed = MappingBatchSchema.safeParse(body.batch);
  if (!parsed.success) throw new MappingEngineError(`Malformed response: ${parsed.error.issues.length} schema error(s).`);
  const problems = validateBatch(parsed.data, targets);
  if (problems.length) throw new MappingEngineError(`Malformed response: ${problems.join(" ")}`);
  return parsed.data;
}

export async function generateMappings(
  live: LiveRequest | null,
  requirementsText: string,
  dictionary: DictionaryField[],
  targets: TargetField[],
  fetcher: Fetcher = fetch,
): Promise<GenerationResult> {
  let notice: string | null = null;
  if (live) {
    try {
      const batch = await requestLiveMappings(live, requirementsText, dictionary, targets, fetcher);
      return {
        batch,
        sourceLabel: `Live AI (${PROVIDERS[live.provider].label} ${modelLabel(live.provider, live.model)})`,
        origin: "live_ai",
        notice: null,
      };
    } catch (error) {
      const reason = error instanceof MappingEngineError ? error.message : "Unexpected error.";
      notice = `Live AI unavailable: ${reason} Continuing in Demo mode.`;
    }
  }

  const demo = loadDemoBatch();
  // Keep only proposals for known targets; missing targets are filled with placeholders later.
  const known = new Set(targets.map((t) => t.name));
  const batch = { mappings: demo.mappings.filter((p) => known.has(p.target_field)), open_questions: demo.open_questions };
  return { batch, sourceLabel: `Demo mode (${DEMO_MAPPINGS_FILE})`, origin: "demo", notice };
}

import { expect, it } from "vitest";

import { SYSTEM_PROMPT, validateBatch } from "@/lib/ai/prompt";
import { generateMappings, loadDemoBatch } from "@/lib/engine";
import { TARGET_FIELDS } from "@/lib/models";

import { demoFiles } from "./helpers";

const live = { provider: "anthropic" as const, apiKey: "sk-ant-test", model: "claude-opus-5-5" };
const respond = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });

it("ships a valid demo response that covers every target and approves nothing", () => {
  const batch = loadDemoBatch();
  expect(validateBatch(batch, TARGET_FIELDS)).toEqual([]);
  expect(batch.mappings.every((p) => (p.status as string) !== "Approved")).toBe(true);
});

it("uses a valid live response and withholds sample values from the request", async () => {
  const { req, dictionary } = demoFiles();
  let sent = "";
  const fetcher = async (_url: string, init: RequestInit) => {
    sent = String(init.body);
    return new Response(JSON.stringify({ batch: loadDemoBatch() }), { status: 200 });
  };
  const result = await generateMappings(live, req.text, dictionary.fields, TARGET_FIELDS, fetcher);
  expect(result.origin).toBe("live_ai");
  expect(result.sourceLabel).toBe("Live AI (Anthropic Claude Opus 5.5)");
  expect(sent).toContain("annual_gross_income_gbp");
  expect(sent).not.toContain("48000");
});

it("rejects malformed live output and falls back to Demo mode", async () => {
  const { req, dictionary } = demoFiles();
  const invented = {
    batch: {
      mappings: [{ requirement_id: "R9", target_field: "credit_score", source_fields: [], transformation_id: "none", evidence_quote: "", reasoning: "", assumptions: [], status: "Missing" }],
      open_questions: [],
    },
  };
  const result = await generateMappings(live, req.text, dictionary.fields, TARGET_FIELDS, respond(invented));
  expect(result.origin).toBe("demo");
  expect(result.notice).toContain("Unknown target field 'credit_score'");

  const approvedByAi = { batch: { ...loadDemoBatch(), mappings: loadDemoBatch().mappings.map((m) => ({ ...m, status: "Approved" })) } };
  const second = await generateMappings(live, req.text, dictionary.fields, TARGET_FIELDS, respond(approvedByAi));
  expect(second.origin).toBe("demo");
  expect(second.notice).toContain("schema error");
});

it("falls back with the server's message when the key is rejected", async () => {
  const { req, dictionary } = demoFiles();
  const result = await generateMappings(live, req.text, dictionary.fields, TARGET_FIELDS, respond({ error: "Anthropic rejected the API key (401)." }, 502));
  expect(result.origin).toBe("demo");
  expect(result.notice).toBe("Live AI unavailable: Anthropic rejected the API key (401). Continuing in Demo mode.");
});

it("states the guardrails in the prompt", () => {
  for (const phrase of ["Do not invent source fields", "exactly", "Do not infer consent time from submission time", "gross and net", "different currencies", "Never mark a proposal Approved"]) {
    expect(SYSTEM_PROMPT).toContain(phrase);
  }
});

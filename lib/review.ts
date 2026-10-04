/**
 * Session workspace and reviewer actions. Every reviewer action appends an audit event.
 * Actions are pure: they return a new workspace and never mutate the one passed in.
 */

import type { LoadedFile } from "./inputs";
import type { GenerationResult } from "./engine";
import {
  APPROVED,
  BLOCKED,
  DEMO_REVIEWER,
  MISSING,
  PROJECT,
  RISK_ORDER,
  mappingFromProposal,
  nowIso,
  type AuditEvent,
  type DictionaryField,
  type Mapping,
  type MappingEvaluation,
  type MappingStatus,
  type OpenQuestion,
  type Requirement,
  type TargetField,
} from "./models";
import { canApprove, evaluateMapping, isSubmissionTime, type RuleContext } from "./rules";
import { applyTransformation, findSpec, formatValue } from "./transformations";

export interface InputFileSummary {
  name: string;
  fileType: string;
  origin: string;
  count: number;
  status: string;
}

export interface Workspace {
  customer: string;
  objective: string;
  mappingSource: string;
  createdAt: string;
  inputFiles: InputFileSummary[];
  requirementsName: string;
  dictionaryName: string;
  requirementsText: string;
  requirements: Requirement[];
  dictionary: DictionaryField[];
  targets: TargetField[];
  mappings: Mapping[];
  openQuestions: OpenQuestion[];
  audit: AuditEvent[];
}

export type Evaluations = Record<string, MappingEvaluation>;

// --- Lookups -----------------------------------------------------------------------------

export function ruleContext(ws: Workspace): RuleContext {
  return {
    requirementsText: ws.requirementsText,
    requirements: Object.fromEntries(ws.requirements.map((r) => [r.id, r])),
    dictionary: Object.fromEntries(ws.dictionary.map((f) => [f.field_name, f])),
    targets: Object.fromEntries(ws.targets.map((t) => [t.name, t])),
    requirementsName: ws.requirementsName,
    dictionaryName: ws.dictionaryName,
  };
}

export function evaluateAll(ws: Workspace): Evaluations {
  const ctx = ruleContext(ws);
  return Object.fromEntries(ws.mappings.map((m) => [m.target_field, evaluateMapping(m, ctx)]));
}

export function getMapping(ws: Workspace, target: string): Mapping {
  const mapping = ws.mappings.find((m) => m.target_field === target);
  if (!mapping) throw new Error(`No mapping for ${target}.`);
  return mapping;
}

function event(action: string, target: string | null = null, previous: string | null = null, next: string | null = null, actor = DEMO_REVIEWER): AuditEvent {
  return { timestamp: nowIso(), actor, action, target_field: target, previous_value: previous, new_value: next };
}

function withMapping(ws: Workspace, target: string, update: (m: Mapping) => Mapping, events: AuditEvent[]): Workspace {
  return {
    ...ws,
    mappings: ws.mappings.map((m) => (m.target_field === target ? update(m) : m)),
    audit: [...ws.audit, ...events],
  };
}

// --- Construction ------------------------------------------------------------------------------

function summary(f: LoadedFile): InputFileSummary {
  return {
    name: f.name,
    fileType: f.fileType,
    origin: f.origin === "demo" ? "Demo data" : "Uploaded",
    count: f.count,
    status: f.ok ? "Parsed" : `Failed: ${f.error}`,
  };
}

export function buildWorkspace(req: LoadedFile, dictionary: LoadedFile, targets: TargetField[], result: GenerationResult): Workspace {
  const byTarget = new Map(result.batch.mappings.map((p) => [p.target_field, p]));
  const mappings: Mapping[] = targets.map((t) => {
    const proposal = byTarget.get(t.name);
    if (proposal) return mappingFromProposal(proposal, result.origin);
    // Guarantee one mapping per required target, even when the proposal set omits one.
    return {
      requirement_id: "",
      target_field: t.name,
      source_fields: [],
      transformation_id: "none",
      evidence_quote: "",
      reasoning: "No proposal was returned for this target field.",
      assumptions: [],
      proposed_status: MISSING,
      decision: "Pending",
      decided_at: null,
      origin: "placeholder",
      edited_by_reviewer: false,
      revision: 0,
    };
  });
  const actor = result.origin === "live_ai" ? "FieldBridge (Live AI)" : "FieldBridge (Demo mode)";
  return {
    customer: PROJECT.customer,
    objective: PROJECT.objective,
    mappingSource: result.sourceLabel,
    createdAt: nowIso(),
    inputFiles: [summary(req), summary(dictionary)],
    requirementsName: req.name,
    dictionaryName: dictionary.name,
    requirementsText: req.text,
    requirements: req.requirements,
    dictionary: dictionary.fields,
    targets,
    mappings,
    openQuestions: result.batch.open_questions.map((text, i) => ({ id: i + 1, text, raised_by: "AI proposal", resolved: false })),
    audit: [event("Generated mapping proposals", null, null, `${mappings.length} proposals from ${result.sourceLabel}`, actor)],
  };
}

// --- Ordering and navigation -----------------------------------------------------------------------

export function riskSorted(ws: Workspace, evaluations: Evaluations): Mapping[] {
  const position = new Map(ws.targets.map((t, i) => [t.name, i]));
  return [...ws.mappings].sort(
    (a, b) =>
      RISK_ORDER[evaluations[a.target_field].status] - RISK_ORDER[evaluations[b.target_field].status] ||
      (position.get(a.target_field) ?? 0) - (position.get(b.target_field) ?? 0),
  );
}

export function unresolved(ws: Workspace, evaluations: Evaluations): Mapping[] {
  return riskSorted(ws, evaluations).filter((m) => evaluations[m.target_field].status !== APPROVED);
}

export function nextIssue(ws: Workspace, evaluations: Evaluations, current: string | null): string | null {
  const queue = unresolved(ws, evaluations).map((m) => m.target_field);
  if (!queue.length) return null;
  const index = current ? queue.indexOf(current) : -1;
  return index >= 0 ? queue[(index + 1) % queue.length] : queue[0];
}

// --- Reviewer actions ----------------------------------------------------------------------------------

export function approve(ws: Workspace, target: string): Workspace {
  const mapping = getMapping(ws, target);
  const evaluation = evaluateMapping(mapping, ruleContext(ws));
  if (!canApprove(evaluation, mapping)) {
    throw new Error(`${target} cannot be approved while its status is ${evaluation.status}.`);
  }
  return withMapping(ws, target, (m) => ({ ...m, decision: "Approved", decided_at: nowIso() }), [
    event("Approved mapping", target, mapping.decision, "Approved"),
  ]);
}

export function reject(ws: Workspace, target: string, reason = ""): Workspace {
  const mapping = getMapping(ws, target);
  const note = reason.trim();
  return withMapping(ws, target, (m) => ({ ...m, decision: "Rejected", decided_at: nowIso() }), [
    event("Rejected mapping", target, mapping.decision, note ? `Rejected: ${note}` : "Rejected"),
  ]);
}

/** Apply a reviewer correction. Returns the same workspace object if nothing changed. */
export function correct(ws: Workspace, target: string, sourceFields: string[], transformationId: string, requirementId?: string | null): Workspace {
  const mapping = getMapping(ws, target);
  const events: AuditEvent[] = [];
  const next: Mapping = { ...mapping };
  if (sourceFields.join("\u0000") !== mapping.source_fields.join("\u0000")) {
    events.push(event("Changed source fields", target, mapping.source_fields.join(", ") || "(none)", sourceFields.join(", ") || "(none)"));
    next.source_fields = [...sourceFields];
  }
  if (transformationId !== mapping.transformation_id) {
    events.push(event("Changed transformation", target, mapping.transformation_id, transformationId));
    next.transformation_id = transformationId;
  }
  if (requirementId && requirementId !== mapping.requirement_id) {
    const requirement = ws.requirements.find((r) => r.id === requirementId);
    if (!requirement) throw new Error(`Unknown requirement ${requirementId}.`);
    events.push(
      event("Changed requirement evidence", target, `${mapping.requirement_id}: ${mapping.evidence_quote}`, `${requirement.id}: ${requirement.text}`),
    );
    next.requirement_id = requirement.id;
    next.evidence_quote = requirement.text; // exact passage from the parsed document
  }
  if (!events.length) return ws;
  next.edited_by_reviewer = true;
  next.proposed_status = null; // the AI's view no longer describes this mapping
  next.revision = mapping.revision + 1;
  if (mapping.decision !== "Pending") {
    events.push(event("Decision reset after edit", target, mapping.decision, "Pending"));
    next.decision = "Pending";
    next.decided_at = null;
  }
  return withMapping(ws, target, () => next, events);
}

export interface MappingChange {
  target: string;
  sourceFields: string[];
  transformationId: string;
  requirementId: string | null;
}

/** Save several edits from the field-mapping editor at once. Each changed attribute is audited. */
export function applyCorrections(ws: Workspace, changes: MappingChange[]): Workspace {
  return changes.reduce((acc, c) => correct(acc, c.target, c.sourceFields, c.transformationId, c.requirementId), ws);
}

export function setQuestionResolved(ws: Workspace, questionId: number, resolved: boolean): Workspace {
  const question = ws.openQuestions.find((q) => q.id === questionId);
  if (!question || question.resolved === resolved) return ws;
  return {
    ...ws,
    openQuestions: ws.openQuestions.map((q) => (q.id === questionId ? { ...q, resolved } : q)),
    audit: [...ws.audit, event(resolved ? "Resolved open question" : "Reopened open question", null, null, question.text)],
  };
}

export function addQuestion(ws: Workspace, text: string): Workspace {
  const clean = text.trim();
  if (!clean) return ws;
  const id = Math.max(0, ...ws.openQuestions.map((q) => q.id)) + 1;
  return {
    ...ws,
    openQuestions: [...ws.openQuestions, { id, text: clean, raised_by: DEMO_REVIEWER, resolved: false }],
    audit: [...ws.audit, event("Added open question", null, null, clean)],
  };
}

export function recordExport(ws: Workspace, format: string): Workspace {
  return { ...ws, audit: [...ws.audit, event("Exported integration brief", null, null, format)] };
}

// --- Derived content ------------------------------------------------------------------------------------

/** Open questions raised by deterministic checks. They disappear when the finding is fixed. */
export function ruleQuestions(ws: Workspace, evaluations: Evaluations): { text: string; status: MappingStatus }[] {
  const questions: { text: string; status: MappingStatus }[] = [];
  for (const m of riskSorted(ws, evaluations)) {
    const ev = evaluations[m.target_field];
    if (ev.status === MISSING) {
      questions.push({
        text: `${m.target_field}: no source field satisfies ${m.requirement_id || "this requirement"}. Which field should supply it?`,
        status: MISSING,
      });
    } else if (ev.status === BLOCKED) {
      questions.push({ text: `${m.target_field} is blocked. ${ev.reasons[0] ?? ""}`.trim(), status: BLOCKED });
    }
  }
  return questions;
}

export function readiness(ws: Workspace, evaluations: Evaluations): { ready: boolean; headline: string } {
  const required = ws.mappings.filter((m) => ws.targets.find((t) => t.name === m.target_field)?.required);
  const openItems = required.filter((m) => evaluations[m.target_field].status !== APPROVED);
  const openQuestions = ws.openQuestions.filter((q) => !q.resolved);
  if (!openItems.length && !openQuestions.length) {
    return { ready: true, headline: `All ${required.length} required mappings are approved and no open questions remain.` };
  }
  const counts = new Map<MappingStatus, number>();
  for (const m of openItems) {
    const status = evaluations[m.target_field].status;
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const parts = [...counts.entries()]
    .sort(([a], [b]) => RISK_ORDER[a] - RISK_ORDER[b])
    .map(([status, n]) => `${n} ${status.toLowerCase()}`);
  if (openQuestions.length) parts.push(`${openQuestions.length} open question${openQuestions.length === 1 ? "" : "s"}`);
  return {
    ready: false,
    headline: `${openItems.length} of ${required.length} required mappings unresolved (${parts.join(", ")}).`,
  };
}

export interface TestCase {
  target: string;
  case: string;
  given: string;
  expect: string;
}

function fill(template: string, values: Record<string, string>): string | null {
  let missing = false;
  const out = template.replace(/\{(\w+)\}/g, (_, key: string) => {
    if (!(key in values)) missing = true;
    return values[key] ?? "";
  });
  return missing ? null : out;
}

/** Initial test cases from deterministic templates attached to each transformation. */
export function buildTestPlan(ws: Workspace): TestCase[] {
  const ctx = ruleContext(ws);
  const rows: TestCase[] = [];
  for (const m of ws.mappings) {
    const spec = findSpec(m.transformation_id);
    if (!spec) {
      rows.push({ target: m.target_field, case: "Unregistered transformation", given: m.transformation_id, expect: "Blocked; no test generated" });
      continue;
    }
    const values: Record<string, string> = { target: m.target_field };
    const samples = m.source_fields.map((f) => (Object.hasOwn(ctx.dictionary, f) ? ctx.dictionary[f].sample_value : ""));
    m.source_fields.forEach((name, i) => {
      values[`src${i}`] = name;
      values[`sample${i}`] = samples[i];
    });
    try {
      values.sample_out = spec.fn ? formatValue(applyTransformation(spec.id, samples)) : "—";
    } catch (error) {
      values.sample_out = `error (${(error as Error).message})`; // the sample failing is itself a finding
    }
    for (const template of spec.tests) {
      const given = fill(template.given, values);
      const expect = fill(template.expect, values);
      if (given !== null && expect !== null) rows.push({ target: m.target_field, case: template.case, given, expect });
    }
    const target = ctx.targets[m.target_field];
    if (target.is_consent_time) {
      const substitute = ws.dictionary.find(isSubmissionTime);
      if (substitute) {
        rows.push({
          target: m.target_field,
          case: "Submission time never used as consent",
          given: `${substitute.field_name} populated, consent field absent`,
          expect: `${m.target_field} left empty and record flagged; never copied from ${substitute.field_name}`,
        });
      }
    }
    if (target.income_basis) {
      rows.push({
        target: m.target_field,
        case: "Net income rejected",
        given: "Source described as net / take-home income",
        expect: "Mapping blocked; net is never accepted for a gross target",
      });
    }
  }
  return rows;
}

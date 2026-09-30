"use client";

import { ArrowRight, Check, CornerDownRight, Info, SkipForward, X } from "lucide-react";
import { useEffect, useState } from "react";

import { APPROVED, BLOCKED, MISSING, READY, REVIEW, type Mapping, type MappingEvaluation, type MappingStatus } from "@/lib/models";
import { getMapping, nextIssue, riskSorted, ruleContext, unresolved } from "@/lib/review";
import { canApprove, evaluateMapping } from "@/lib/rules";
import { findSpec, REGISTRY } from "@/lib/transformations";

import { Button, Callout, Card, cx, FieldName, Kbd, SectionLabel, Select, StatusBadge, Tabs } from "../ui";
import { useReview } from "./state";
import { StepHeader } from "./Workbench";

const STATUS_ORDER: MappingStatus[] = [BLOCKED, MISSING, REVIEW, READY, APPROVED];

export function MapStep() {
  const { workspace, evaluations, selected, select, approve, goTo, notice, dismissNotice } = useReview();
  const ordered = riskSorted(workspace, evaluations);
  const current = selected && evaluations[selected] ? selected : ordered[0].target_field;
  const remaining = unresolved(workspace, evaluations).length;

  // Keyboard: ↑/↓ or j/k move between rows, n jumps to the next issue, a approves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable=true], [role=tablist]")) return;
      const index = ordered.findIndex((m) => m.target_field === current);
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        select(ordered[Math.min(index + 1, ordered.length - 1)].target_field);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        select(ordered[Math.max(index - 1, 0)].target_field);
      } else if (e.key === "n") {
        const next = nextIssue(workspace, evaluations, current);
        if (next) select(next);
      } else if (e.key === "a") {
        const m = getMapping(workspace, current);
        if (canApprove(evaluations[current], m)) approve(current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ordered, current, workspace, evaluations, select, approve]);

  const counts = STATUS_ORDER.map((s) => [s, Object.values(evaluations).filter((e) => e.status === s).length] as const).filter(([, n]) => n);

  return (
    <div>
      <StepHeader
        title="Map and review"
        description="One proposal per required target field, riskiest first. Select a row to inspect its evidence, then approve, reject or correct it."
        actions={
          <>
            <Button variant="secondary" icon={<SkipForward className="size-4" aria-hidden />} disabled={!remaining} onClick={() => {
              const next = nextIssue(workspace, evaluations, current);
              if (next) select(next);
            }}>
              Review next issue <span className="text-slate-400">({remaining})</span>
            </Button>
            <Button variant="ghost" icon={<ArrowRight className="size-4" aria-hidden />} onClick={() => goTo(3)}>
              Validate
            </Button>
          </>
        }
      />

      {notice && (
        <div className="mb-4 animate-fade-in">
          <Callout tone="warning" icon={<Info className="size-4" aria-hidden />}>
            <div className="flex items-start justify-between gap-3">
              <span>{notice}</span>
              <button type="button" onClick={dismissNotice} aria-label="Dismiss" className="rounded p-0.5 text-amber-700 hover:bg-amber-100">
                <X className="size-4" aria-hidden />
              </button>
            </div>
          </Callout>
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
              {counts.map(([status, n]) => (
                <span key={status} className="inline-flex items-center gap-1.5">
                  <StatusBadge status={status} />
                  <span className="text-xs text-slate-500">×{n}</span>
                </span>
              ))}
              <span className="ml-auto text-xs text-slate-500">Proposals from {workspace.mappingSource}</span>
            </div>
            <MappingTable ordered={ordered} evaluations={evaluations} current={current} onSelect={select} />
          </Card>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> move
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>N</Kbd> next issue
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>A</Kbd> approve
            </span>
            <span className="ml-auto">Statuses come from deterministic rule checks. The AI can ask for review but cannot clear a check or approve.</span>
          </div>
        </div>
        <EvidencePanel key={current} target={current} />
      </div>
    </div>
  );
}

function MappingTable({ ordered, evaluations, current, onSelect }: { ordered: Mapping[]; evaluations: Record<string, MappingEvaluation>; current: string; onSelect: (t: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="py-2.5 pr-3 pl-4 font-medium">Target field</th>
            <th className="px-3 py-2.5 font-medium">Suggested source</th>
            <th className="px-3 py-2.5 font-medium">Transformation</th>
            <th className="px-3 py-2.5 font-medium">Status</th>
            <th className="py-2.5 pr-4 pl-3 font-medium">Reviewer decision</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((m) => {
            const active = m.target_field === current;
            return (
              <tr
                key={m.target_field}
                onClick={() => onSelect(m.target_field)}
                className={cx(
                  "cursor-pointer border-t border-slate-100 align-top transition-colors",
                  active ? "bg-blue-50/70 shadow-[inset_3px_0_0_var(--color-blue-600)]" : "hover:bg-slate-50",
                )}
              >
                <td className="py-3 pr-3 pl-4">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(m.target_field);
                    }}
                    aria-current={active ? "true" : undefined}
                    className="text-left font-medium hover:underline"
                  >
                    <FieldName name={m.target_field} className="font-semibold" />
                  </button>
                </td>
                <td className="px-3 py-3">
                  {m.source_fields.length ? (
                    <div className="flex flex-col gap-0.5">
                      {m.source_fields.map((f) => (
                        <FieldName key={f} name={f} />
                      ))}
                    </div>
                  ) : (
                    <span className="text-red-700 italic">None found</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <FieldName name={m.transformation_id} className="text-slate-600" />
                </td>
                <td className="px-3 py-3">
                  <StatusBadge status={evaluations[m.target_field].status} />
                </td>
                <td className="py-3 pr-4 pl-3">
                  <Decision decision={m.decision} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Decision({ decision }: { decision: Mapping["decision"] }) {
  if (decision === "Approved") return <span className="inline-flex items-center gap-1 font-medium whitespace-nowrap text-emerald-700"><Check className="size-3.5" aria-hidden />Approved</span>;
  if (decision === "Rejected") return <span className="inline-flex items-center gap-1 font-medium whitespace-nowrap text-red-700"><X className="size-3.5" aria-hidden />Rejected</span>;
  return <span className="whitespace-nowrap text-slate-500">Pending</span>;
}

type PanelTab = "evidence" | "checks" | "correct";

function EvidencePanel({ target }: { target: string }) {
  const { workspace, evaluations, approve, reject } = useReview();
  const mapping = getMapping(workspace, target);
  const ev = evaluations[target];
  const [tab, setTab] = useState<PanelTab>(mapping.decision === "Rejected" ? "correct" : "evidence");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const openChecks = ev.checks.filter((c) => c.status !== READY).length;
  const approvable = canApprove(ev, mapping);
  const tone = ev.status === APPROVED || ev.status === READY ? "success" : ev.status === REVIEW ? "warning" : "danger";

  return (
    <aside aria-label={`Evidence for ${target}`} className="min-w-0 lg:sticky lg:top-20">
      <Card className="flex max-h-none flex-col lg:max-h-[calc(100vh-6.5rem)]">
        <div className="border-b border-slate-100 px-5 pt-4 pb-3">
          <div className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Evidence panel</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <FieldName name={target} className="text-[15px] font-semibold text-slate-900" />
            <StatusBadge status={ev.status} />
          </div>
          <div className="mt-3">
            <Callout tone={tone} title={`Why ${ev.status}`}>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                {ev.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </Callout>
          </div>
          <div className="mt-3">
            <Tabs<PanelTab>
              label="Evidence panel sections"
              value={tab}
              onChange={setTab}
              tabs={[
                { id: "evidence", label: "Evidence" },
                {
                  id: "checks",
                  label: (
                    <>
                      Rule checks
                      <span className={cx("rounded-full px-1.5 text-[11px]", openChecks ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800")}>
                        {openChecks ? `${openChecks} open` : "all ready"}
                      </span>
                    </>
                  ),
                },
                { id: "correct", label: "Correct mapping" },
              ]}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" role="tabpanel">
          {tab === "evidence" && <EvidenceDetails mapping={mapping} ev={ev} />}
          {tab === "checks" && <ChecksList ev={ev} />}
          {tab === "correct" && <CorrectionForm mapping={mapping} onApplied={() => setTab("evidence")} />}
        </div>

        <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-3.5">
          {rejecting ? (
            <div className="animate-fade-in">
              <label htmlFor="reject-reason" className="text-[13px] font-medium text-slate-700">
                Reason for rejecting (optional)
              </label>
              <textarea
                id="reject-reason"
                autoFocus
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
                placeholder="e.g. Confirm the income period with Northstar first"
              />
              <div className="mt-2 flex gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    reject(target, reason);
                    setRejecting(false);
                    setReason("");
                    setTab("correct");
                  }}
                >
                  Confirm rejection
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setRejecting(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <Button variant="primary" className="flex-1" icon={<Check className="size-4" aria-hidden />} disabled={!approvable} onClick={() => approve(target)}>
                  Approve mapping
                </Button>
                <Button variant="secondary" icon={<X className="size-4" aria-hidden />} disabled={mapping.decision === "Rejected"} onClick={() => setRejecting(true)}>
                  Reject
                </Button>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {mapping.decision === "Approved"
                  ? "Approved. Editing the mapping resets the decision to Pending."
                  : mapping.decision === "Rejected"
                    ? "Rejected. It stays Blocked until it is corrected."
                    : approvable
                      ? "Approving confirms the assumptions above and records it in the audit history."
                      : "Approval is disabled until the Missing or Blocked findings are resolved."}
              </p>
            </>
          )}
        </div>
      </Card>
    </aside>
  );
}

function EvidenceDetails({ mapping, ev }: { mapping: Mapping; ev: MappingEvaluation }) {
  const { workspace } = useReview();
  const ctx = ruleContext(workspace);
  const target = ctx.targets[mapping.target_field];
  const spec = findSpec(mapping.transformation_id);
  const evidenceCheck = ev.checks.find((c) => c.number === 5)!;
  const requirement = ctx.requirements[mapping.requirement_id];
  const assumptions = [...mapping.assumptions.map((a) => [a, "proposal"]), ...(spec?.assumptions ?? []).map((a) => [a, "registry"])];
  const origin = { demo: "Saved Demo-mode proposal", live_ai: "Live AI proposal", placeholder: "System placeholder" }[mapping.origin];

  return (
    <div className="space-y-5">
      <section>
        <SectionLabel>Requirement {mapping.requirement_id || "(none cited)"}</SectionLabel>
        <blockquote className="rounded-r-lg border-l-[3px] border-blue-500 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-800">
          {mapping.evidence_quote || <em className="text-slate-500">No evidence quoted.</em>}
        </blockquote>
        <div className={cx("mt-1.5 text-xs font-medium", evidenceCheck.status === READY ? "text-emerald-700" : "text-red-700")}>
          {evidenceCheck.status === READY ? `✓ Found verbatim in ${workspace.requirementsName}, line ${requirement?.line ?? "?"}` : `✕ ${evidenceCheck.evidence}`}
        </div>
      </section>

      <section>
        <SectionLabel>Source → target</SectionLabel>
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {mapping.source_fields.length ? (
            mapping.source_fields.map((f) => {
              const field = ctx.dictionary[f];
              return (
                <div key={f} className="px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <FieldName name={f} className="font-semibold" />
                    <span className="text-xs text-slate-500">{field ? `${field.data_type} · ${field.unit || "no unit"}` : "not in dictionary"}</span>
                  </div>
                  <div className="mt-0.5 text-[13px] text-slate-600">{field?.description ?? <em className="text-red-700">This field does not exist in the uploaded dictionary.</em>}</div>
                </div>
              );
            })
          ) : (
            <div className="px-3 py-2.5 text-[13px] text-red-700 italic">No source field identified</div>
          )}
          <div className="flex items-start gap-2 bg-slate-50/60 px-3 py-2.5">
            <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FieldName name={target.name} className="font-semibold" />
                <span className="text-xs text-slate-500">
                  {target.data_type} · {target.unit}
                </span>
              </div>
              <div className="mt-0.5 text-[13px] text-slate-600">{target.description}</div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <SectionLabel>Transformation</SectionLabel>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="rounded-md bg-slate-100 px-2 py-0.5">
            <FieldName name={mapping.transformation_id} />
          </span>
          <span className="text-slate-600">{spec?.formula ?? "Not an approved transformation. It will not be run."}</span>
        </div>
      </section>

      <section>
        <SectionLabel>Sample preview</SectionLabel>
        <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
          <div className="rounded-lg border border-slate-200 px-3 py-2">
            <div className="text-[11px] font-medium text-slate-500">Before (dictionary sample)</div>
            {ev.preview.inputs.length ? (
              ev.preview.inputs.map(([f, v]) => (
                <div key={f} className="mt-1 text-[13px] break-all">
                  <span className="font-mono text-xs text-slate-500">{f}</span>
                  <div className="font-mono font-medium text-slate-900">{v || "—"}</div>
                </div>
              ))
            ) : (
              <div className="mt-1 text-[13px] text-slate-500">—</div>
            )}
          </div>
          <div className="grid place-items-center text-slate-400">
            <ArrowRight className="size-4" aria-hidden />
          </div>
          <div className={cx("rounded-lg border px-3 py-2", ev.preview.output !== null ? "border-emerald-200 bg-emerald-50/50" : "border-red-200 bg-red-50/50")}>
            <div className="text-[11px] font-medium text-slate-500">After</div>
            {ev.preview.output !== null ? (
              <div className="mt-1 text-[13px] break-all">
                <span className="font-mono text-xs text-slate-500">{mapping.target_field}</span>
                <div className="font-mono text-base font-semibold text-slate-900">{ev.preview.output}</div>
              </div>
            ) : (
              <div className="mt-1 text-[13px] text-red-700">{ev.preview.error}</div>
            )}
          </div>
        </div>
      </section>

      <section>
        <SectionLabel>Reason for the suggestion</SectionLabel>
        <p className="text-[13px] leading-5 text-slate-700">{mapping.reasoning || "—"}</p>
        <p className="mt-1 text-xs text-slate-500">
          {origin}.{mapping.edited_by_reviewer && " Edited by the reviewer since it was proposed, so this rationale may be out of date."}
        </p>
      </section>

      <section>
        <SectionLabel>Explicit assumptions</SectionLabel>
        {assumptions.length ? (
          <ul className="space-y-1.5">
            {assumptions.map(([text, source]) => (
              <li key={text} className="flex gap-2 text-[13px] text-slate-700">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-slate-400" aria-hidden />
                <span>
                  {text} <span className="text-xs text-slate-400">({source})</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-slate-500">None stated.</p>
        )}
      </section>
    </div>
  );
}

function ChecksList({ ev }: { ev: MappingEvaluation }) {
  return (
    <ol className="divide-y divide-slate-100">
      {ev.checks.map((c) => (
        <li key={c.number} className="flex items-start gap-3 py-2.5 first:pt-0">
          <span className="mt-0.5 w-4 shrink-0 text-right text-xs text-slate-400">{c.number}</span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-slate-800">{c.name}</div>
            {c.status !== READY && (
              <div className="mt-0.5 text-xs text-slate-500">{c.evidence.startsWith("Not run") ? c.evidence : c.remediation}</div>
            )}
          </div>
          <StatusBadge status={c.status} />
        </li>
      ))}
    </ol>
  );
}

function CorrectionForm({ mapping, onApplied }: { mapping: Mapping; onApplied: () => void }) {
  const { workspace, correct } = useReview();
  const ctx = ruleContext(workspace);
  const ids = Object.keys(REGISTRY);
  const [transformation, setTransformation] = useState(ids.includes(mapping.transformation_id) ? mapping.transformation_id : "none");
  const [sources, setSources] = useState<string[]>(mapping.source_fields);
  const [requirement, setRequirement] = useState(mapping.requirement_id);
  const spec = REGISTRY[transformation];
  const names = workspace.dictionary.map((f) => f.field_name);
  const chosen = spec.inputRoles.map((_, i) => (sources[i] && names.includes(sources[i]) ? sources[i] : ""));
  const complete = chosen.every(Boolean);
  const unchanged =
    transformation === mapping.transformation_id && chosen.join("|") === mapping.source_fields.join("|") && requirement === mapping.requirement_id;

  const draftEval =
    complete && !unchanged
      ? evaluateMapping(
          {
            ...mapping,
            source_fields: chosen,
            transformation_id: transformation,
            requirement_id: requirement,
            evidence_quote: requirement !== mapping.requirement_id ? (ctx.requirements[requirement]?.text ?? "") : mapping.evidence_quote,
            decision: "Pending",
            proposed_status: null,
          },
          ctx,
        )
      : null;

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-slate-500">
        Choose only from the approved transformation registry and the uploaded dictionary. The outcome updates as you edit, before anything is saved.
      </p>
      <Select label="Transformation (approved registry only)" value={transformation} onChange={setTransformation}>
        {ids.map((id) => (
          <option key={id} value={id}>
            {id} · {REGISTRY[id].label}
          </option>
        ))}
      </Select>
      {spec.inputRoles.map((role, i) => (
        <Select
          key={`${transformation}-${i}`}
          label={`${role} (source field)`}
          value={chosen[i]}
          onChange={(value) => setSources(chosen.map((current, j) => (j === i ? value : current)))}
        >
          <option value="" disabled>
            Select a source field
          </option>
          {workspace.dictionary.map((f) => (
            <option key={f.field_name} value={f.field_name}>
              {f.field_name} · {f.data_type} · {f.unit || "no unit"}
            </option>
          ))}
        </Select>
      ))}
      <Select label="Requirement evidence (quoted exactly from the document)" value={requirement} onChange={setRequirement}>
        {!ctx.requirements[requirement] && <option value={requirement}>{requirement || "(none cited)"}</option>}
        {workspace.requirements.map((r) => (
          <option key={r.id} value={r.id}>
            {r.id}: {r.text}
          </option>
        ))}
      </Select>

      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3.5 py-3 text-[13px]">
        {unchanged ? (
          <span className="text-slate-500">These are the current settings. Change a field to preview the outcome.</span>
        ) : !complete ? (
          <span className="text-slate-500">Select every source field to preview the outcome.</span>
        ) : (
          draftEval && (
            <div className="animate-fade-in">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-700">If applied:</span>
                <StatusBadge status={draftEval.status} />
                <span className="font-mono text-xs text-slate-600">→ {draftEval.preview.output ?? draftEval.preview.error}</span>
              </div>
              {(draftEval.status === BLOCKED || draftEval.status === MISSING) && draftEval.reasons[0] && (
                <p className="mt-1.5 text-xs text-red-800">{draftEval.reasons[0]}</p>
              )}
            </div>
          )
        )}
      </div>

      <Button
        variant="secondary"
        disabled={!complete || unchanged}
        onClick={() => {
          correct(mapping.target_field, chosen, transformation, requirement);
          onApplied();
        }}
      >
        Apply correction
      </Button>
    </div>
  );
}

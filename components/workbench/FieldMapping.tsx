"use client";

import { ArrowRight, CircleDashed, Info, Save, Undo2 } from "lucide-react";
import { useEffect, useRef } from "react";

import { BLOCKED, MISSING, type Mapping, type MappingEvaluation, type TargetField } from "@/lib/models";
import { getMapping, ruleContext } from "@/lib/review";
import { evaluateMapping, type RuleContext } from "@/lib/rules";
import { REGISTRY } from "@/lib/transformations";

import { Button, Card, cx, FieldName, StatusBadge } from "../ui";
import { useReview, type MappingDraft } from "./state";

const selectClass =
  "h-8 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-[13px] text-slate-900 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none";

interface Row {
  target: TargetField;
  saved: Mapping;
  draft: MappingDraft;
  changed: boolean;
  incomplete: boolean;
  ev: MappingEvaluation;
}

function toDraft(m: Mapping): MappingDraft {
  return { sourceFields: [...m.source_fields], transformationId: m.transformation_id, requirementId: m.requirement_id };
}

function sameAsSaved(d: MappingDraft, m: Mapping): boolean {
  return d.transformationId === m.transformation_id && d.requirementId === m.requirement_id && d.sourceFields.join("|") === m.source_fields.join("|");
}

/** Evaluate an unsaved edit with the same deterministic rules as a saved mapping. */
function evaluateDraft(m: Mapping, d: MappingDraft, ctx: RuleContext): MappingEvaluation {
  return evaluateMapping(
    {
      ...m,
      source_fields: d.sourceFields.filter(Boolean),
      transformation_id: d.transformationId,
      requirement_id: d.requirementId,
      evidence_quote: d.requirementId !== m.requirement_id ? (ctx.requirements[d.requirementId]?.text ?? "") : m.evidence_quote,
      decision: "Pending",
      proposed_status: null,
    },
    ctx,
  );
}

export function FieldMapping() {
  const { workspace, evaluations, drafts, setDraft, discardDrafts, saveDrafts, selected } = useReview();
  const ctx = ruleContext(workspace);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  const rows: Row[] = workspace.targets.map((target) => {
    const saved = getMapping(workspace, target.name);
    const draft = drafts[target.name] ?? toDraft(saved);
    const changed = Boolean(drafts[target.name]);
    const arity = REGISTRY[draft.transformationId]?.inputRoles.length ?? draft.sourceFields.length;
    return {
      target,
      saved,
      draft,
      changed,
      incomplete: draft.sourceFields.filter(Boolean).length < arity,
      ev: changed ? evaluateDraft(saved, draft, ctx) : evaluations[target.name],
    };
  });

  // Bring the row the user came to edit into view.
  useEffect(() => {
    if (selected) rowRefs.current[selected]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selected]);

  const update = (row: Row, next: MappingDraft) => setDraft(row.target.name, sameAsSaved(next, row.saved) ? null : next);

  const changeTransformation = (row: Row, transformationId: string) => {
    const roles = REGISTRY[transformationId]?.inputRoles.length ?? 0;
    const sourceFields = Array.from({ length: roles }, (_, i) => row.draft.sourceFields[i] ?? "");
    update(row, { ...row.draft, transformationId, sourceFields });
  };

  const changeSource = (row: Row, index: number, value: string) => {
    if (row.draft.transformationId === "none") {
      // Picking a source for an unmapped target starts with a plain copy; the checks say if that's wrong.
      if (value) update(row, { ...row.draft, transformationId: "identity", sourceFields: [value] });
      return;
    }
    const roles = REGISTRY[row.draft.transformationId]?.inputRoles.length ?? 1;
    if (!value && roles === 1) {
      update(row, { ...row.draft, transformationId: "none", sourceFields: [] });
      return;
    }
    update(row, { ...row.draft, sourceFields: row.draft.sourceFields.map((f, i) => (i === index ? value : f)) });
  };

  const mapped = rows.filter((r) => r.draft.sourceFields.some(Boolean)).length;
  const unmapped = rows.length - mapped;
  const blocked = rows.filter((r) => r.ev.status === BLOCKED).length;
  const changedRows = rows.filter((r) => r.changed);
  const incompleteRows = changedRows.filter((r) => r.incomplete);
  const used = new Set(rows.flatMap((r) => r.draft.sourceFields.filter(Boolean)));
  const unused = workspace.dictionary.filter((f) => !used.has(f.field_name));

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">Field mapping</h2>
          <p className="mt-0.5 text-[13px] text-slate-500">
            Match each required target field to source fields from <span className="font-medium text-slate-700">{workspace.dictionaryName}</span>. Checks re-run
            as you edit; nothing is saved until you click Save mapping.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium" aria-label="Mapping summary">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 ring-1 ring-emerald-600/20 ring-inset">
            ✓ {mapped} mapped
          </span>
          {unmapped > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-red-700 ring-1 ring-red-600/20 ring-inset">
              <CircleDashed className="size-3" aria-hidden /> {unmapped} unmapped
            </span>
          )}
          {blocked > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-red-700 ring-1 ring-red-600/20 ring-inset">✕ {blocked} blocked</span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-[13px]">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="w-[22%] py-2.5 pr-3 pl-5 font-medium">
                Target field <span className="text-red-600">*</span> required
              </th>
              <th className="w-[24%] px-3 py-2.5 font-medium">Source field</th>
              <th className="w-[19%] px-3 py-2.5 font-medium">Transformation</th>
              <th className="w-[17%] px-3 py-2.5 font-medium">Sample preview</th>
              <th className="py-2.5 pr-5 pl-3 font-medium">Check</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const spec = REGISTRY[row.draft.transformationId];
              const roles = spec?.inputRoles ?? [];
              const problem = row.ev.status === BLOCKED || row.ev.status === MISSING;
              const preview = row.ev.preview;
              return (
                <tr
                  key={row.target.name}
                  ref={(el) => {
                    rowRefs.current[row.target.name] = el;
                  }}
                  className={cx(
                    "border-t border-slate-100 align-top transition-colors",
                    problem && "bg-red-50/40",
                    row.changed && "shadow-[inset_3px_0_0_var(--color-blue-600)]",
                    selected === row.target.name && !row.changed && "shadow-[inset_3px_0_0_var(--color-slate-300)]",
                  )}
                >
                  <td className="py-3 pr-3 pl-5">
                    <div className="flex items-baseline gap-1">
                      <FieldName name={row.target.name} className="font-semibold" />
                      {row.target.required && (
                        <span className="text-red-600" aria-label="required">
                          *
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {row.target.data_type} · {row.target.unit}
                    </div>
                    <label className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                      Evidence
                      <select
                        value={row.draft.requirementId}
                        onChange={(e) => update(row, { ...row.draft, requirementId: e.target.value })}
                        className="h-6 rounded border border-slate-300 bg-white px-1 text-xs text-slate-700"
                        aria-label={`Requirement evidence for ${row.target.name}`}
                      >
                        {!ctx.requirements[row.draft.requirementId] && <option value={row.draft.requirementId}>{row.draft.requirementId || "None"}</option>}
                        {workspace.requirements.map((r) => (
                          <option key={r.id} value={r.id} title={r.text}>
                            {r.id}
                          </option>
                        ))}
                      </select>
                    </label>
                  </td>

                  <td className="px-3 py-3">
                    <div className="space-y-1.5">
                      {(roles.length ? roles : ["Source value"]).map((role, i) => (
                        <div key={`${row.draft.transformationId}-${i}`}>
                          {roles.length > 1 && <div className="mb-0.5 text-[11px] font-medium text-slate-500">{role}</div>}
                          <select
                            value={row.draft.sourceFields[i] ?? ""}
                            onChange={(e) => changeSource(row, i, e.target.value)}
                            aria-label={`${role} for ${row.target.name}`}
                            className={cx(selectClass, !row.draft.sourceFields[i] && "border-red-300 text-slate-500")}
                          >
                            <option value="">— Not mapped —</option>
                            {workspace.dictionary.map((f) => (
                              <option key={f.field_name} value={f.field_name}>
                                {f.field_name}
                              </option>
                            ))}
                          </select>
                          {(() => {
                            const field = ctx.dictionary[row.draft.sourceFields[i] ?? ""];
                            return field ? (
                              <div className="mt-0.5 truncate text-xs text-slate-500" title={field.description}>
                                {field.data_type}
                                {field.unit ? ` · ${field.unit}` : ""} · {field.description || "no description"}
                              </div>
                            ) : null;
                          })()}
                        </div>
                      ))}
                    </div>
                  </td>

                  <td className="px-3 py-3">
                    <select
                      value={row.draft.transformationId}
                      onChange={(e) => changeTransformation(row, e.target.value)}
                      aria-label={`Transformation for ${row.target.name}`}
                      className={selectClass}
                    >
                      {!spec && <option value={row.draft.transformationId}>{row.draft.transformationId} (not approved)</option>}
                      {Object.values(REGISTRY).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    {spec && <div className="mt-1 text-xs text-slate-500">{spec.formula}</div>}
                  </td>

                  <td className="px-3 py-3">
                    {preview.inputs.length > 0 && (
                      <div className="font-mono text-xs break-all text-slate-600">{preview.inputs.map(([, v]) => v || "—").join(", ")}</div>
                    )}
                    {preview.output !== null ? (
                      <div className="mt-0.5 flex items-center gap-1 font-mono text-[13px] font-semibold text-slate-900">
                        <ArrowRight className="size-3 text-slate-400" aria-hidden /> {preview.output}
                      </div>
                    ) : (
                      <div className="mt-0.5 text-xs text-slate-500">{row.draft.sourceFields.some(Boolean) ? preview.error : "No source, nothing to preview"}</div>
                    )}
                  </td>

                  <td className="py-3 pr-5 pl-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={row.ev.status} />
                      {row.changed && <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">Edited</span>}
                    </div>
                    {row.incomplete ? (
                      <p className="mt-1 text-xs text-slate-500">Select every source field to finish this mapping.</p>
                    ) : (
                      problem && row.ev.reasons[0] && <p className="mt-1 line-clamp-3 text-xs text-red-800">{row.ev.reasons[0]}</p>
                    )}
                    {row.changed && row.saved.decision === "Approved" && (
                      <p className="mt-1 text-xs text-amber-800">Saving returns this approved mapping to Pending.</p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-start gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-3 text-[13px] text-slate-600">
        <Info className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
        {unused.length ? (
          <div>
            <span className="font-medium text-slate-700">Not mapped to any target ({unused.length}):</span>{" "}
            {unused.map((f, i) => (
              <span key={f.field_name}>
                <FieldName name={f.field_name} className="text-xs" />
                {i < unused.length - 1 && ", "}
              </span>
            ))}
            . These fields won&apos;t be sent to the decisioning workflow.
          </div>
        ) : (
          <span>Every source field in the dictionary is used by a target.</span>
        )}
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t border-slate-200 bg-white/95 px-5 py-3 backdrop-blur">
        <p className="text-[13px] text-slate-600" aria-live="polite">
          {changedRows.length ? (
            <>
              <span className="font-medium text-slate-900">
                {changedRows.length} unsaved change{changedRows.length === 1 ? "" : "s"}
              </span>
              {incompleteRows.length > 0 && <span className="text-amber-800"> · finish {incompleteRows.map((r) => r.target.name).join(", ")} to save</span>}
            </>
          ) : (
            "All changes saved. Edits are recorded in the audit history."
          )}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" icon={<Undo2 className="size-4" aria-hidden />} disabled={!changedRows.length} onClick={discardDrafts}>
            Discard
          </Button>
          <Button variant="primary" icon={<Save className="size-4" aria-hidden />} disabled={!changedRows.length || incompleteRows.length > 0} onClick={saveDrafts}>
            Save mapping
          </Button>
        </div>
      </div>
    </Card>
  );
}

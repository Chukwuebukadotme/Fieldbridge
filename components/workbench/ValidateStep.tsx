"use client";

import { ArrowRight, ChevronDown, FlaskConical, PencilLine } from "lucide-react";
import { useState } from "react";

import { READY, type CheckStatus } from "@/lib/models";
import { buildTestPlan, riskSorted } from "@/lib/review";

import { Button, Card, CardHeader, cx, FieldName, StatusBadge } from "../ui";
import { useReview } from "./state";
import { StepHeader } from "./Workbench";

export function ValidateStep() {
  const { workspace, evaluations, selected, select, goTo } = useReview();
  const ordered = riskSorted(workspace, evaluations);
  const current = selected && evaluations[selected] ? selected : ordered[0].target_field;
  const ev = evaluations[current];
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const isOpen = (key: string, status: CheckStatus) => expanded[key] ?? status !== READY;
  const plan = buildTestPlan(workspace);

  return (
    <div>
      <StepHeader
        title="Validate"
        description="Ten deterministic checks per mapping, re-run on every change. The AI never decides whether a check passes."
        actions={
          <Button variant="primary" icon={<ArrowRight className="size-4" aria-hidden />} onClick={() => goTo(4)}>
            Continue to approval
          </Button>
        }
      />

      <div className="grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <nav aria-label="Mappings" className="lg:sticky lg:top-20">
          <ul className="space-y-1.5">
            {ordered.map((m) => {
              const e = evaluations[m.target_field];
              const failing = e.checks.filter((c) => c.status !== READY).length;
              const active = m.target_field === current;
              return (
                <li key={m.target_field}>
                  <button
                    type="button"
                    onClick={() => select(m.target_field)}
                    aria-current={active ? "true" : undefined}
                    className={cx(
                      "w-full rounded-xl border bg-white px-3.5 py-3 text-left transition-all",
                      active ? "border-blue-600 shadow-[0_0_0_3px_rgba(37,99,235,0.12)]" : "border-slate-200 hover:border-slate-300",
                    )}
                  >
                    <FieldName name={m.target_field} className="font-semibold" />
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <StatusBadge status={e.status} />
                      <span className="text-xs text-slate-500">{failing ? `${failing} of 10 open` : "10 of 10 ready"}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0 space-y-5">
          <Card key={current} className="animate-fade-in">
            <CardHeader
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <FieldName name={current} className="text-sm font-semibold" /> <StatusBadge status={ev.status} />
                </span>
              }
              description={ev.reasons[0]}
              actions={
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpanded(Object.fromEntries(ev.checks.map((c) => [`${current}-${c.number}`, !ev.checks.every((x) => isOpen(`${current}-${x.number}`, x.status))])))}
                  >
                    {ev.checks.every((c) => isOpen(`${current}-${c.number}`, c.status)) ? "Collapse all" : "Expand all"}
                  </Button>
                  <Button variant="secondary" size="sm" icon={<PencilLine className="size-3.5" aria-hidden />} onClick={() => goTo(2)}>
                    Open in review
                  </Button>
                </>
              }
            />
            <ul>
              {ev.checks.map((c) => {
                const key = `${current}-${c.number}`;
                const open = isOpen(key, c.status);
                return (
                  <li key={key} className="border-t border-slate-100 first:border-t-0">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setExpanded((s) => ({ ...s, [key]: !open }))}
                      className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-50"
                    >
                      <span className="w-5 shrink-0 text-xs text-slate-400">{c.number}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium text-slate-900">{c.name}</span>
                        <span className="block truncate text-xs text-slate-500">{c.checked}</span>
                      </span>
                      <StatusBadge status={c.status} />
                      <ChevronDown className={cx("size-4 shrink-0 text-slate-400 transition-transform", open && "rotate-180")} aria-hidden />
                    </button>
                    {open && (
                      <div className="grid animate-fade-in gap-3 px-5 pb-4 pl-13 text-[13px] sm:grid-cols-2">
                        <div className="rounded-lg bg-slate-50 px-3 py-2">
                          <div className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Evidence or sample used</div>
                          <div className="mt-0.5 break-words text-slate-800">{c.evidence}</div>
                        </div>
                        <div className={cx("rounded-lg px-3 py-2", c.remediation ? "bg-amber-50" : "bg-emerald-50")}>
                          <div className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Remediation</div>
                          <div className="mt-0.5 text-slate-800">{c.remediation ?? "None needed. This check passed."}</div>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            <CardHeader
              title={
                <span className="inline-flex items-center gap-2">
                  <FlaskConical className="size-4 text-slate-500" aria-hidden /> Initial test plan
                </span>
              }
              description="Generated from deterministic templates attached to each registered transformation. The AI does not write these tests."
            />
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="py-2 pr-2 pl-5 font-medium">ID</th>
                    <th className="px-3 py-2 font-medium">Target field</th>
                    <th className="px-3 py-2 font-medium">Case</th>
                    <th className="px-3 py-2 font-medium">Given</th>
                    <th className="py-2 pr-5 pl-3 font-medium">Expect</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.map((row, i) => (
                    <tr key={i} className="border-t border-slate-100 align-top">
                      <td className="py-2.5 pr-2 pl-5 text-slate-500">T{i + 1}</td>
                      <td className="px-3 py-2.5">
                        <FieldName name={row.target} />
                      </td>
                      <td className="px-3 py-2.5 font-medium text-slate-800">{row.case}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-600">{row.given}</td>
                      <td className="py-2.5 pr-5 pl-3 text-slate-700">{row.expect}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

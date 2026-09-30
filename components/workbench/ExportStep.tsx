"use client";

import { AlertTriangle, CheckCircle2, Copy, Download, Eye, History, MessageSquarePlus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { briefFileName, buildBrief } from "@/lib/exporter";
import { readiness, riskSorted, ruleQuestions } from "@/lib/review";
import { canApprove } from "@/lib/rules";

import { Button, Card, CardHeader, cx, FieldName, inputClass, StatusBadge } from "../ui";
import { Decision } from "./MapStep";
import { useReview } from "./state";
import { StepHeader } from "./Workbench";

export function ExportStep() {
  const { workspace, evaluations, approve, reject, select, goTo, setQuestionResolved, addQuestion, exportBrief } = useReview();
  const { ready, headline } = readiness(workspace, evaluations);
  const brief = useMemo(() => buildBrief(workspace, evaluations), [workspace, evaluations]);
  const derived = ruleQuestions(workspace, evaluations);
  const [question, setQuestion] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <div>
      <StepHeader title="Approve and export" description="Record final decisions, settle open questions and download the integration brief." />

      <div
        role={ready ? "status" : "alert"}
        className={cx(
          "mb-5 flex items-start gap-3 rounded-xl border px-5 py-4",
          ready ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50",
        )}
      >
        {ready ? <CheckCircle2 className="mt-0.5 size-5 text-emerald-600" aria-hidden /> : <AlertTriangle className="mt-0.5 size-5 text-amber-600" aria-hidden />}
        <div>
          <div className={cx("text-sm font-semibold", ready ? "text-emerald-900" : "text-amber-900")}>{ready ? "Ready for build" : "Not ready for build"}</div>
          <p className={cx("mt-0.5 text-[13px]", ready ? "text-emerald-800" : "text-amber-900")}>
            {headline}
            {!ready && " You can still export the brief. It will be marked NOT READY and list every unresolved item."}
          </p>
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Reviewer decisions" description="Approve mappings whose checks pass, or send them back for correction." />
            <ul>
              {riskSorted(workspace, evaluations).map((m) => {
                const ev = evaluations[m.target_field];
                return (
                  <li key={m.target_field} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 px-5 py-3 first:border-t-0">
                    <div className="min-w-0 flex-1 basis-56">
                      <FieldName name={m.target_field} className="font-semibold" />
                      <div className="mt-0.5 truncate text-xs text-slate-500">
                        {m.source_fields.join(", ") || "no source"} → {m.transformation_id}
                      </div>
                    </div>
                    <StatusBadge status={ev.status} />
                    <div className="w-20 text-[13px]">
                      <Decision decision={m.decision} />
                    </div>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="secondary" disabled={!canApprove(ev, m)} onClick={() => approve(m.target_field)}>
                        Approve
                      </Button>
                      <Button size="sm" variant="secondary" disabled={m.decision === "Rejected"} onClick={() => reject(m.target_field, "")}>
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          select(m.target_field);
                          goTo(2);
                        }}
                      >
                        Correct
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Open questions" description="Questions for Northstar Lending. Tick one when it has been answered." />
            <div className="divide-y divide-slate-100">
              {workspace.openQuestions.map((q) => (
                <label key={q.id} className="flex cursor-pointer items-start gap-3 px-5 py-3 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={q.resolved}
                    onChange={(e) => setQuestionResolved(q.id, e.target.checked)}
                    className="mt-0.5 size-4 rounded border-slate-300 accent-blue-600"
                  />
                  <span className="min-w-0">
                    <span className={cx("block text-[13px]", q.resolved ? "text-slate-400 line-through" : "text-slate-800")}>{q.text}</span>
                    <span className="block text-xs text-slate-500">Raised by {q.raised_by}</span>
                  </span>
                </label>
              ))}
              {derived.map((q) => (
                <div key={q.text} className="flex items-start gap-3 px-5 py-3">
                  <StatusBadge status={q.status} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-[13px] text-slate-800">{q.text}</span>
                    <span className="block text-xs text-slate-500">Raised by rule checks. Clears when the finding is fixed.</span>
                  </span>
                </div>
              ))}
              {!workspace.openQuestions.length && !derived.length && <p className="px-5 py-3 text-[13px] text-slate-500">No open questions.</p>}
            </div>
            <form
              className="flex gap-2 border-t border-slate-100 px-5 py-3"
              onSubmit={(e) => {
                e.preventDefault();
                addQuestion(question);
                setQuestion("");
              }}
            >
              <label htmlFor="new-question" className="sr-only">
                Add a question for the lender
              </label>
              <input
                id="new-question"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Add a question for the lender, e.g. Is income verified or self-declared?"
                className={inputClass}
              />
              <Button type="submit" variant="secondary" icon={<MessageSquarePlus className="size-4" aria-hidden />} disabled={!question.trim()}>
                Add
              </Button>
            </form>
          </Card>
        </div>

        <Card className="lg:sticky lg:top-20">
          <CardHeader title="Integration brief" description="Markdown for developers, reviewers and governance stakeholders." />
          <div className="space-y-3 p-5">
            <ul className="space-y-1 text-[13px] text-slate-600">
              {["Mappings, approved and unapproved", "Formulas and requirement evidence", "Assumptions and check results", "Open questions and test plan", "Audit history and limitations"].map((item) => (
                <li key={item} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
            <Button variant="primary" className="w-full" icon={<Download className="size-4" aria-hidden />} onClick={() => exportBrief("download")}>
              Download brief (.md)
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" size="sm" icon={<Eye className="size-3.5" aria-hidden />} onClick={() => setPreviewOpen(true)}>
                Preview
              </Button>
              <Button variant="secondary" size="sm" icon={<Copy className="size-3.5" aria-hidden />} onClick={() => exportBrief("copy")}>
                Copy
              </Button>
            </div>
            {!ready && <p className="text-xs text-amber-800">The brief will be marked NOT READY FOR BUILD.</p>}
            <p className="truncate text-xs text-slate-400">{briefFileName(workspace)}</p>
          </div>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <History className="size-4 text-slate-500" aria-hidden /> Audit history
            </span>
          }
          description="Newest first. Kept in this browser tab only."
        />
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-xs text-slate-500">
                <th className="py-2 pr-3 pl-5 font-medium">Time (UTC)</th>
                <th className="px-3 py-2 font-medium">Actor</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Target field</th>
                <th className="px-3 py-2 font-medium">Previous</th>
                <th className="py-2 pr-5 pl-3 font-medium">New</th>
              </tr>
            </thead>
            <tbody>
              {[...workspace.audit].reverse().map((e, i) => (
                <tr key={`${e.timestamp}-${i}`} className="border-t border-slate-100 align-top">
                  <td className="py-2 pr-3 pl-5 font-mono text-xs whitespace-nowrap text-slate-500">{e.timestamp.slice(11, 19)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-700">{e.actor}</td>
                  <td className="px-3 py-2 font-medium text-slate-900">{e.action}</td>
                  <td className="px-3 py-2">{e.target_field ? <FieldName name={e.target_field} /> : <span className="text-slate-400">—</span>}</td>
                  <td className="px-3 py-2 text-slate-600">{e.previous_value ?? <span className="text-slate-400">—</span>}</td>
                  <td className="py-2 pr-5 pl-3 text-slate-600">{e.new_value ?? <span className="text-slate-400">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {previewOpen && <BriefPreview brief={brief} onClose={() => setPreviewOpen(false)} onDownload={() => exportBrief("download")} />}
    </div>
  );
}

function BriefPreview({ brief, onClose, onDownload }: { brief: string; onClose: () => void; onDownload: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Portal to <body>: the animated step container would otherwise trap position: fixed.
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="brief-title">
      <div className="absolute inset-0 animate-fade-in bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative flex max-h-[88vh] w-full max-w-4xl animate-fade-in flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <h2 id="brief-title" className="text-sm font-semibold">
            Integration brief preview
          </h2>
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" icon={<Download className="size-3.5" aria-hidden />} onClick={onDownload}>
              Download
            </Button>
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Close preview" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100">
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </div>
        <div className="md overflow-y-auto px-7 py-6">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{brief}</ReactMarkdown>
        </div>
      </div>
    </div>,
    document.body,
  );
}

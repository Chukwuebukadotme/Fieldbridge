"use client";

import { AlertTriangle, ArrowRight, CheckCircle2, Download, FileSpreadsheet, FileText, KeyRound, Replace, Sparkles, Upload, X, XCircle } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";

import { modelLabel, PROVIDERS, type EngineMode, type ProviderId } from "@/lib/ai/providers";
import { DICTIONARY_COLUMNS, type LoadedFile } from "@/lib/inputs";
import { TARGET_FIELDS } from "@/lib/models";

import { Button, Card, CardHeader, cx, FieldName, Pill } from "../ui";
import { useWorkbench, type FileKind } from "./state";
import { StepHeader } from "./Workbench";

export function UploadStep() {
  const { reqFile, dictFile, loadDemo, workspace, generating, generate, goTo, ai } = useWorkbench();
  const bothOk = Boolean(reqFile?.ok && dictFile?.ok);
  const nothingLoaded = !reqFile && !dictFile;
  const uploadWarnings = [reqFile, dictFile].reduce((n, f) => n + (f?.checks.filter((c) => c.status === "warn").length ?? 0), 0);

  return (
    <div>
      <StepHeader
        title="Load lender inputs"
        description="Add Northstar Lending's requirements (.txt) and data dictionary (.csv). Files are parsed in your browser; in Demo mode nothing is sent anywhere."
        actions={
          !nothingLoaded && (
            <Button variant="ghost" size="sm" icon={<Sparkles className="size-3.5" aria-hidden />} onClick={() => loadDemo()}>
              {reqFile?.origin === "demo" ? "Reload demo data" : "Use demo data"}
            </Button>
          )
        }
      />

      {nothingLoaded && (
        <Card className="mb-5 overflow-hidden">
          <div className="flex flex-col gap-4 bg-gradient-to-r from-blue-50 via-white to-white px-5 py-5 sm:flex-row sm:items-center">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-600 text-white shadow-sm">
              <Sparkles className="size-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-slate-900">Start with the Northstar Lending demo data</h2>
              <p className="mt-0.5 text-[13px] text-slate-600">
                Three requirements and a three-field data dictionary for an affordability feed. Loads instantly; no account or key needed.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 text-[13px] text-slate-500">
                <Download className="size-3.5" aria-hidden />
                <a href="/demo/demo_requirements.txt" download className="font-medium text-slate-600 hover:text-slate-900 hover:underline">
                  .txt
                </a>
                <span aria-hidden>·</span>
                <a href="/demo/demo_data_dictionary.csv" download className="font-medium text-slate-600 hover:text-slate-900 hover:underline">
                  .csv
                </a>
              </span>
              <Button variant="primary" icon={<Sparkles className="size-4" aria-hidden />} onClick={() => loadDemo()}>
                Use demo data
              </Button>
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
        <FileCard
          kind="req"
          file={reqFile}
          title="Requirements document"
          extension="txt"
          icon={<FileText className="size-5" aria-hidden />}
          template="/templates/requirements_template.txt"
          guidance={
            <>
              One requirement per line, starting with an ID like <code className="rounded bg-slate-100 px-1 font-mono text-xs text-slate-700">R1:</code>.
              Evidence is matched against this text exactly.
            </>
          }
        />
        <FileCard
          kind="dict"
          file={dictFile}
          title="Data dictionary"
          extension="csv"
          icon={<FileSpreadsheet className="size-5" aria-hidden />}
          template="/templates/data_dictionary_template.csv"
          guidance={
            <span className="flex flex-wrap items-center gap-1">
              Columns:
              {DICTIONARY_COLUMNS.required.map((c) => (
                <code key={c} className="rounded bg-slate-100 px-1 font-mono text-xs text-slate-800">
                  {c}
                  <span className="text-red-600" aria-label="required">
                    *
                  </span>
                </code>
              ))}
              {DICTIONARY_COLUMNS.optional.map((c) => (
                <code key={c} className="rounded border border-dashed border-slate-300 px-1 font-mono text-xs text-slate-500">
                  {c}
                </code>
              ))}
            </span>
          }
          footer={
            reqFile?.origin === "demo" && (
              <button
                type="button"
                onClick={() => loadDemo(dictFile?.name === "demo_data_dictionary_v2.csv" ? "demo_data_dictionary.csv" : "demo_data_dictionary_v2.csv")}
                className="text-[13px] font-medium text-blue-700 hover:underline"
              >
                {dictFile?.name === "demo_data_dictionary_v2.csv" ? "Switch back to the original demo dictionary" : "Try the updated demo dictionary (v2, adds a consent field)"}
              </button>
            )
          }
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <TargetsCard />
        <EngineCard />
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="text-[13px] text-slate-600">
          {bothOk ? (
            <>
              <span className="font-medium text-slate-900">{reqFile!.count} requirements</span> and{" "}
              <span className="font-medium text-slate-900">{dictFile!.count} fields</span> ready
              {uploadWarnings > 0 && <span className="text-amber-800"> ({uploadWarnings} upload warning{uploadWarnings === 1 ? "" : "s"})</span>}.{" "}
              {ai.mode === "demo" ? "Proposals come from Demo mode." : `Proposals come from ${PROVIDERS[ai.mode].label} ${modelLabel(ai.mode, ai.models[ai.mode])}.`}
              {workspace && <span className="text-amber-700"> Generating again replaces the current decisions and audit history.</span>}
            </>
          ) : (
            `Load a valid ${[!reqFile?.ok && "requirements document", !dictFile?.ok && "data dictionary"].filter(Boolean).join(" and ")} to continue.`
          )}
        </div>
        <div className="flex items-center gap-2">
          {workspace && !generating && (
            <Button variant="secondary" onClick={() => goTo(2)}>
              Return to review
            </Button>
          )}
          <Button
            variant={nothingLoaded ? "secondary" : "primary"}
            disabled={!bothOk}
            loading={generating}
            icon={<ArrowRight className="size-4" aria-hidden />}
            onClick={generate}
          >
            {generating ? (ai.mode === "demo" ? "Loading proposals…" : `Asking ${PROVIDERS[ai.mode].label}…`) : "Generate mapping proposals"}
          </Button>
        </div>
      </div>

      {generating && ai.mode !== "demo" && <GeneratingCard provider={ai.mode} />}
    </div>
  );
}

function GeneratingCard({ provider }: { provider: ProviderId }) {
  const { ai } = useWorkbench();
  return (
    <Card className="mt-4 animate-fade-in p-5">
      <div className="text-sm font-medium text-slate-900">
        {PROVIDERS[provider].label} {modelLabel(provider, ai.models[provider])} is reading the requirements…
      </div>
      <p className="mt-0.5 text-[13px] text-slate-500">
        Usually 10–60 seconds. The response is validated against a strict schema; if anything goes wrong, FieldBridge continues in Demo mode.
      </p>
      <div className="mt-4 space-y-2" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <div className="skeleton h-5 w-1/4" />
            <div className="skeleton h-5 w-1/4" />
            <div className="skeleton h-5 w-1/5" />
            <div className="skeleton h-5 w-24" />
          </div>
        ))}
      </div>
    </Card>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const CHECK_ICON = {
  pass: <CheckCircle2 className="size-4 text-emerald-600" aria-label="Passed" />,
  warn: <AlertTriangle className="size-4 text-amber-600" aria-label="Warning" />,
  fail: <XCircle className="size-4 text-red-600" aria-label="Failed" />,
};

function FileCard({
  kind,
  file,
  title,
  extension,
  icon,
  template,
  guidance,
  footer,
}: {
  kind: FileKind;
  file: LoadedFile | null;
  title: string;
  extension: "txt" | "csv";
  icon: React.ReactNode;
  template: string;
  guidance: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { uploadFile, clearFile } = useWorkbench();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) uploadFile(kind, dropped);
  };

  const warnings = file?.checks.filter((c) => c.status === "warn").length ?? 0;
  const failed = file?.checks.some((c) => c.status === "fail") ?? false;
  const checksSummary = failed ? "Failed" : warnings ? `${warnings} warning${warnings === 1 ? "" : "s"}` : `All ${file?.checks.length ?? 0} passed`;

  return (
    <Card className={cx("flex min-w-0 flex-col transition-colors", dragging && "border-blue-400 bg-blue-50/40")}>
      <div
        className="flex flex-1 flex-col p-5"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            <div className="mt-1 text-[13px] text-slate-500">{guidance}</div>
          </div>
          <a
            href={template}
            download
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
          >
            <Download className="size-3.5" aria-hidden /> Template
          </a>
        </div>
        <input
          ref={input}
          type="file"
          accept={`.${extension}`}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            if (chosen) uploadFile(kind, chosen);
            e.target.value = "";
          }}
        />
        {!file ? (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-4 py-8 text-center transition-colors hover:border-blue-400 hover:bg-blue-50/40"
          >
            <span className="grid size-10 place-items-center rounded-full bg-white text-slate-500 shadow-sm ring-1 ring-slate-200">
              <Upload className="size-4" aria-hidden />
            </span>
            <span className="text-sm font-medium text-slate-700">
              Drag and drop or <span className="text-blue-700">browse</span>
            </span>
            <span className="text-xs text-slate-500">Accepts .{extension} · UTF-8 · up to 1 MB</span>
          </button>
        ) : (
          <div className="animate-fade-in">
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
              <div className={cx("grid size-9 shrink-0 place-items-center rounded-lg", file.ok ? "bg-blue-50 text-blue-700" : "bg-red-50 text-red-700")}>{icon}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-900">{file.name}</div>
                <div className="text-xs text-slate-500">
                  {formatSize(file.size)} · {file.origin === "demo" ? "Demo data" : "Uploaded"}
                  {file.ok && ` · ${file.count} ${kind === "req" ? "requirements" : "fields"} detected`}
                </div>
              </div>
              <Button variant="ghost" size="sm" icon={<Replace className="size-3.5" aria-hidden />} onClick={() => input.current?.click()} aria-label={`Replace ${file.name}`}>
                <span className="hidden sm:inline">Replace</span>
              </Button>
              <button
                type="button"
                onClick={() => clearFile(kind)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label={`Remove ${file.name}`}
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            <div className={cx("mt-3 rounded-lg border", failed ? "border-red-200" : warnings ? "border-amber-200" : "border-slate-200")}>
              <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                <span className="text-xs font-semibold tracking-wider text-slate-500 uppercase">Upload checks</span>
                <span className={cx("text-xs font-medium", failed ? "text-red-700" : warnings ? "text-amber-800" : "text-emerald-700")}>{checksSummary}</span>
              </div>
              <ul className="divide-y divide-slate-100">
                {file.checks.map((check) => (
                  <li key={check.label} className="flex items-start gap-2.5 px-3 py-2">
                    <span className="mt-px shrink-0">{CHECK_ICON[check.status]}</span>
                    <span className="min-w-0 text-[13px]">
                      <span className="font-medium text-slate-800">{check.label}</span>
                      <span className="block text-xs break-words text-slate-500">{check.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {failed && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-red-100 bg-red-50/60 px-3 py-2 text-xs text-red-800">
                  Fix the file and upload it again, or start from the template.
                  <Button size="sm" variant="secondary" icon={<Replace className="size-3.5" aria-hidden />} onClick={() => input.current?.click()}>
                    Upload again
                  </Button>
                </div>
              )}
            </div>

            {file.ok && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setPreviewOpen((o) => !o)}
                  aria-expanded={previewOpen}
                  className="text-[13px] font-medium text-slate-600 hover:text-slate-900"
                >
                  {previewOpen ? "Hide" : "Preview"} parsed contents
                </button>
                {previewOpen && <ParsedPreview file={file} />}
              </div>
            )}
          </div>
        )}
        {footer && <div className="mt-3">{footer}</div>}
      </div>
    </Card>
  );
}

function ParsedPreview({ file }: { file: LoadedFile }) {
  const cellClass = "border-b border-slate-100 px-2.5 py-1.5 text-left align-top";
  return (
    <div className="mt-2 max-h-60 animate-fade-in overflow-auto rounded-lg border border-slate-200">
      <table className="w-full text-xs">
        {file.kind === "requirements" ? (
          <>
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className={cellClass}>ID</th>
                <th className={cellClass}>Line</th>
                <th className={cellClass}>Requirement</th>
              </tr>
            </thead>
            <tbody>
              {file.requirements.map((r) => (
                <tr key={r.id}>
                  <td className={cx(cellClass, "font-medium")}>{r.id}</td>
                  <td className={cellClass}>{r.line}</td>
                  <td className={cellClass}>{r.text}</td>
                </tr>
              ))}
            </tbody>
          </>
        ) : (
          <>
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                {["field_name", "data_type", "unit", "sample_value", "description"].map((h) => (
                  <th key={h} className={cellClass}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {file.fields.map((f) => (
                <tr key={f.field_name}>
                  <td className={cellClass}>
                    <FieldName name={f.field_name} className="text-xs" />
                  </td>
                  <td className={cellClass}>{f.data_type}</td>
                  <td className={cellClass}>{f.unit}</td>
                  <td className={cellClass}>{f.sample_value}</td>
                  <td className={cellClass}>{f.description}</td>
                </tr>
              ))}
            </tbody>
          </>
        )}
      </table>
    </div>
  );
}

function TargetsCard() {
  return (
    <Card>
      <CardHeader title="What the destination workflow requires" description="Required target fields for the credit-decisioning workflow (demo definition)." />
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="px-5 py-2 font-medium">Target field</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Unit</th>
              <th className="px-5 py-2 font-medium">Meaning</th>
            </tr>
          </thead>
          <tbody>
            {TARGET_FIELDS.map((t) => (
              <tr key={t.name} className="border-t border-slate-100 align-top">
                <td className="px-5 py-2.5">
                  <FieldName name={t.name} />
                </td>
                <td className="px-3 py-2.5 text-slate-600">{t.data_type}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">{t.unit}</td>
                <td className="px-5 py-2.5 text-slate-600">{t.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function EngineCard() {
  const { ai, setMode, hasKey, openSettings, serverKeys } = useWorkbench();
  const options: { id: EngineMode; title: string; body: string }[] = [
    { id: "demo", title: "Demo mode", body: "Replays a saved, validated response. No key needed." },
    { id: "openai", title: "OpenAI", body: modelLabel("openai", ai.models.openai) },
    { id: "anthropic", title: "Anthropic", body: modelLabel("anthropic", ai.models.anthropic) },
  ];
  return (
    <Card>
      <CardHeader
        title="Mapping proposals"
        description="Who interprets the requirements. Checks and approvals work the same either way."
        actions={
          <Button variant="ghost" size="sm" icon={<KeyRound className="size-3.5" aria-hidden />} onClick={openSettings}>
            API keys
          </Button>
        }
      />
      <div role="radiogroup" aria-label="Mapping engine" className="grid gap-2 p-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
        {options.map((option) => {
          const active = ai.mode === option.id;
          const provider = option.id === "demo" ? null : option.id;
          const keyState = provider ? (ai.keys[provider] ? "Your key added" : serverKeys[provider] ? "Server key available" : "No key yet") : "Always available";
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => {
                setMode(option.id);
                if (provider && !hasKey(provider)) openSettings();
              }}
              className={cx(
                "rounded-lg border p-3 text-left transition-all",
                active ? "border-blue-600 bg-blue-50/50 ring-1 ring-blue-600" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-900">{option.title}</span>
                <span className={cx("size-3.5 rounded-full border-2", active ? "border-blue-600 bg-blue-600 shadow-[inset_0_0_0_2px_white]" : "border-slate-300")} aria-hidden />
              </div>
              <div className="mt-1 text-xs text-slate-500">{option.body}</div>
              <div className="mt-2">
                <Pill className={cx(provider && !hasKey(provider) && "bg-amber-50 text-amber-800")}>{keyState}</Pill>
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

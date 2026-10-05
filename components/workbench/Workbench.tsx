"use client";

import { Check, ChevronRight, RotateCcw, Sparkles, Workflow } from "lucide-react";

import { APPROVED, BLOCKED, MISSING } from "@/lib/models";
import { readiness, unresolved } from "@/lib/review";

import { Button, cx } from "../ui";
import { ExportStep } from "./ExportStep";
import { MapStep } from "./MapStep";
import { SettingsDrawer } from "./SettingsDrawer";
import { useWorkbench, WorkbenchProvider, type Step } from "./state";
import { ToastProvider } from "./Toasts";
import { UploadStep } from "./UploadStep";
import { ValidateStep } from "./ValidateStep";

export function Workbench() {
  return (
    <ToastProvider>
      <WorkbenchProvider>
        <Shell />
      </WorkbenchProvider>
    </ToastProvider>
  );
}

function Shell() {
  const { step, workspace } = useWorkbench();
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-6 pb-16 sm:px-6">
        <Stepper />
        <div key={step} className="mt-6 animate-fade-in">
          {step === 1 || !workspace ? <UploadStep /> : step === 2 ? <MapStep /> : step === 3 ? <ValidateStep /> : <ExportStep />}
        </div>
      </main>
      <Footer />
      <SettingsDrawer />
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-slate-200/80 bg-white/60">
      <div className="mx-auto max-w-[1400px] px-4 py-5 text-center text-[13px] text-slate-500 sm:px-6">
        Built with care by{" "}
        {/* New tab: all review state lives in this tab, so navigating away would lose it. */}
        <a
          href="https://chukwuebukaonyemelukwe.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-slate-700 underline decoration-slate-300 underline-offset-4 transition-colors hover:text-blue-700 hover:decoration-blue-400"
        >
          Chukwuebuka<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    </footer>
  );
}

function Header() {
  const { engineLabel, ai, openSettings, workspace, reset, hasKey } = useWorkbench();
  const provider = ai.mode === "demo" ? null : ai.mode;
  const live = provider !== null;
  const keyReady = provider ? hasKey(provider) : false;
  const keyRejected = provider ? ai.verify[provider].state === "error" : false;
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-2">
          <div className="grid size-7 place-items-center rounded-lg bg-gradient-to-b from-blue-500 to-blue-700 text-white shadow-sm">
            <Workflow className="size-4" aria-hidden />
          </div>
          <span className="text-[15px] font-semibold tracking-tight">FieldBridge</span>
        </div>
        <ChevronRight className="hidden size-4 text-slate-300 sm:block" aria-hidden />
        <div className="hidden min-w-0 items-center gap-2 sm:flex">
          <span className="truncate text-sm text-slate-600">Northstar Lending</span>
          <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700 ring-1 ring-blue-600/15 ring-inset">Demo data</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {workspace && (
            <Button variant="ghost" size="sm" icon={<RotateCcw className="size-3.5" aria-hidden />} onClick={reset}>
              <span className="hidden sm:inline">Start over</span>
            </Button>
          )}
          <button
            type="button"
            onClick={openSettings}
            className="inline-flex h-8 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            aria-label={`AI settings. Current engine: ${engineLabel}`}
          >
            <span
              className={cx("size-2 rounded-full", !live ? "bg-slate-400" : keyRejected ? "bg-red-500" : keyReady ? "bg-emerald-500" : "bg-amber-500")}
              aria-hidden
            />
            <Sparkles className="size-3.5 text-slate-400" aria-hidden />
            <span className="max-w-[180px] truncate">{engineLabel}</span>
            {live && !keyReady && !keyRejected && <span className="text-amber-700">· add key</span>}
            {keyRejected && <span className="text-red-700">· key rejected</span>}
          </button>
          <div
            className="grid size-8 place-items-center rounded-full bg-slate-800 text-[11px] font-semibold text-white"
            title="Signed in as Demo reviewer"
            aria-label="Demo reviewer"
          >
            DR
          </div>
        </div>
      </div>
    </header>
  );
}

const STEPS: { id: Step; label: string }[] = [
  { id: 1, label: "Upload" },
  { id: 2, label: "Map and review" },
  { id: 3, label: "Validate" },
  { id: 4, label: "Approve and export" },
];

function Stepper() {
  const { step, goTo, workspace, evaluations, reqFile, dictFile } = useWorkbench();

  const detail = (id: Step): string => {
    if (id === 1) {
      const loaded = [reqFile, dictFile].filter((f) => f?.ok).length;
      return workspace ? "Proposals generated" : `${loaded} of 2 files loaded`;
    }
    if (!workspace || !evaluations) return "Not started";
    const statuses = Object.values(evaluations).map((e) => e.status);
    if (id === 2) {
      const open = unresolved(workspace, evaluations).length;
      return open ? `${open} of ${statuses.length} unresolved` : "All approved";
    }
    if (id === 3) {
      const blocking = statuses.filter((s) => s === BLOCKED || s === MISSING).length;
      return blocking ? `${blocking} blocking finding${blocking === 1 ? "" : "s"}` : "No blocking findings";
    }
    return readiness(workspace, evaluations).ready ? "Ready for build" : "Not ready for build";
  };

  const complete = (id: Step): boolean => {
    if (id === 1) return Boolean(workspace);
    if (!workspace || !evaluations) return false;
    const statuses = Object.values(evaluations).map((e) => e.status);
    if (id === 2) return statuses.every((s) => s === APPROVED);
    if (id === 3) return statuses.every((s) => s !== BLOCKED && s !== MISSING);
    return readiness(workspace, evaluations).ready;
  };

  return (
    <nav aria-label="Workflow progress">
      <ol className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {STEPS.map(({ id, label }) => {
          const current = id === step;
          const reachable = id === 1 || Boolean(workspace);
          const done = complete(id);
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => goTo(id)}
                disabled={!reachable}
                aria-current={current ? "step" : undefined}
                className={cx(
                  "group flex w-full items-center gap-3 rounded-xl border bg-white px-3.5 py-2.5 text-left transition-all",
                  current ? "border-blue-600 shadow-[0_0_0_3px_rgba(37,99,235,0.12)]" : "border-slate-200 hover:border-slate-300 hover:shadow-sm",
                  !reachable && "cursor-not-allowed opacity-60 hover:border-slate-200 hover:shadow-none",
                )}
              >
                <span
                  className={cx(
                    "grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold",
                    current ? "bg-blue-600 text-white" : done ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20" : "bg-slate-100 text-slate-500",
                  )}
                >
                  {done && !current ? <Check className="size-3.5" aria-label="Complete" /> : id}
                </span>
                <span className="min-w-0">
                  <span className={cx("block truncate text-sm font-medium", current ? "text-slate-900" : "text-slate-700")}>{label}</span>
                  <span className="block truncate text-xs text-slate-500">{detail(id)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function StepHeader({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-3xl">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

"use client";

import { CheckCircle2, ExternalLink, Eye, EyeOff, KeyRound, Loader2, ShieldCheck, X, XCircle } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { MODEL_ID_PATTERN, PROVIDERS, type EngineMode, type ProviderId } from "@/lib/ai/providers";

import { Button, cx, inputClass } from "../ui";
import { useWorkbench } from "./state";

const MODES: { id: EngineMode; label: string }[] = [
  { id: "demo", label: "Demo mode" },
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
];

export function SettingsDrawer() {
  const { settingsOpen, closeSettings, ai, setMode } = useWorkbench();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!settingsOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSettings();
      if (e.key !== "Tab" || !panel.current) return;
      // Keep focus inside the drawer while it is open.
      const focusable = [...panel.current.querySelectorAll<HTMLElement>("button, input, select, a[href]")].filter((el) => !el.hasAttribute("disabled"));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [settingsOpen, closeSettings]);

  if (!settingsOpen) return null;

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="absolute inset-0 animate-fade-in bg-slate-900/30 backdrop-blur-[2px]" onClick={closeSettings} />
      <div ref={panel} className="absolute inset-y-0 right-0 flex w-full max-w-md animate-slide-in-right flex-col border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-6 py-5">
          <div>
            <h2 id="settings-title" className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <KeyRound className="size-4 text-slate-500" aria-hidden /> AI settings
            </h2>
            <p className="mt-1 text-[13px] text-slate-500">Choose who proposes mappings. Use your own OpenAI or Anthropic API key.</p>
          </div>
          <button type="button" onClick={closeSettings} aria-label="Close settings" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100">
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium text-slate-700">Mapping engine</legend>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
              {MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  aria-pressed={ai.mode === mode.id}
                  data-autofocus={ai.mode === mode.id ? "" : undefined}
                  onClick={() => setMode(mode.id)}
                  className={cx(
                    "rounded-md px-2 py-1.5 text-[13px] font-medium transition-all",
                    ai.mode === mode.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900",
                  )}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </fieldset>

          {ai.mode === "demo" ? (
            <div className="animate-fade-in rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-[13px] text-slate-600">
              Demo mode replays a saved, schema-valid response for the Northstar Lending demo data. No key and no network call are needed. Pick OpenAI or
              Anthropic to use your own key.
            </div>
          ) : (
            <ProviderSettings key={ai.mode} provider={ai.mode} />
          )}

          <div className="flex gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-[13px] text-emerald-950">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
            <div className="space-y-1">
              <div className="font-semibold">How your key is handled</div>
              <ul className="list-disc space-y-0.5 pl-4 text-emerald-900">
                <li>Kept only in this browser tab&apos;s memory. Refreshing or closing the tab clears it.</li>
                <li>Sent over HTTPS with each request to FieldBridge&apos;s server, which forwards it to the provider for that call only.</li>
                <li>Never saved, logged, or written to the audit history or the brief.</li>
                <li>Record-level sample values are never sent to the model.</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-6 py-4">
          <Button variant="primary" onClick={closeSettings}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProviderSettings({ provider }: { provider: ProviderId }) {
  const { ai, setKey, setModel, verifyKey, serverKeys } = useWorkbench();
  const info = PROVIDERS[provider];
  const keyId = useId();
  const modelId = useId();
  const [visible, setVisible] = useState(false);
  const key = ai.keys[provider];
  const verify = ai.verify[provider];
  const preset = info.models.some((m) => m.id === ai.models[provider]);
  const [custom, setCustom] = useState(!preset);
  const looksWrong = key && !info.keyHint.test(key);
  const modelValid = MODEL_ID_PATTERN.test(ai.models[provider]);

  return (
    <div className="animate-fade-in space-y-5">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label htmlFor={keyId} className="text-[13px] font-medium text-slate-700">
            {info.label} API key
          </label>
          <a href={info.keysUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline">
            Get a key <ExternalLink className="size-3" aria-hidden />
          </a>
        </div>
        <div className="relative">
          <input
            id={keyId}
            type={visible ? "text" : "password"}
            value={key}
            onChange={(e) => setKey(provider, e.target.value)}
            placeholder={serverKeys[provider] ? "Optional: the server has a key configured" : info.keyPlaceholder}
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            className={cx(inputClass, "pr-10 font-mono")}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Hide key" : "Show key"}
            className="absolute inset-y-0 right-0 grid w-9 place-items-center text-slate-400 hover:text-slate-700"
          >
            {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </button>
        </div>
        {looksWrong && <p className="mt-1 text-xs text-amber-700">This doesn&apos;t look like an {info.label} key ({info.keyPlaceholder}).</p>}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" disabled={!key && !serverKeys[provider]} loading={verify.state === "checking"} onClick={() => verifyKey(provider)}>
            Verify key
          </Button>
          {key && (
            <Button size="sm" variant="ghost" onClick={() => setKey(provider, "")}>
              Clear key
            </Button>
          )}
          <span aria-live="polite" className="text-xs">
            {verify.state === "ok" && (
              <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                <CheckCircle2 className="size-3.5" aria-hidden /> {verify.message}
              </span>
            )}
            {verify.state === "error" && (
              <span className="inline-flex items-center gap-1 font-medium text-red-700">
                <XCircle className="size-3.5" aria-hidden /> {verify.message}
              </span>
            )}
            {verify.state === "checking" && (
              <span className="inline-flex items-center gap-1 text-slate-500">
                <Loader2 className="size-3.5 animate-spin" aria-hidden /> Checking…
              </span>
            )}
          </span>
        </div>
        <p className="mt-1.5 text-xs text-slate-500">Verifying lists your available models. It is free and generates nothing.</p>
      </div>

      <div>
        <label htmlFor={modelId} className="mb-1 block text-[13px] font-medium text-slate-700">
          Model
        </label>
        <select
          id={modelId}
          value={custom ? "__custom" : ai.models[provider]}
          onChange={(e) => {
            if (e.target.value === "__custom") {
              setCustom(true);
            } else {
              setCustom(false);
              setModel(provider, e.target.value);
            }
          }}
          className={inputClass}
        >
          {info.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} · {m.note}
            </option>
          ))}
          <option value="__custom">Other model ID…</option>
        </select>
        {custom && (
          <input
            aria-label="Custom model ID"
            value={ai.models[provider]}
            onChange={(e) => setModel(provider, e.target.value.trim())}
            placeholder="model-id"
            spellCheck={false}
            className={cx(inputClass, "mt-2 font-mono", !modelValid && "border-red-400")}
          />
        )}
        <p className="mt-1.5 text-xs text-slate-500">
          {provider === "anthropic"
            ? "Uses structured outputs at medium effort. On Opus 5.5 and Sonnet 5.5, a declined request is retried on a fallback model automatically."
            : "Uses the Responses API with a strict structured-output schema."}
        </p>
      </div>
    </div>
  );
}

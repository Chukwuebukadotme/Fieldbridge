"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { modelLabel, PROVIDERS, type EngineMode, type ProviderId } from "@/lib/ai/providers";
import { generateMappings } from "@/lib/engine";
import { briefFileName, buildBrief } from "@/lib/exporter";
import { parseDictionary, parseRequirements, rejectedFile, type LoadedFile } from "@/lib/inputs";
import { TARGET_FIELDS } from "@/lib/models";
import * as review from "@/lib/review";

import { useToast } from "./Toasts";

export type Step = 1 | 2 | 3 | 4;
export type FileKind = "req" | "dict";
export type MapView = "review" | "mapping";

/** An unsaved edit in the field-mapping editor. */
export interface MappingDraft {
  sourceFields: string[];
  transformationId: string;
  requirementId: string;
}
type VerifyState = { state: "idle" | "checking" | "ok" | "error"; message: string | null };

export interface AiSettings {
  mode: EngineMode;
  /** Pasted keys live only in this React state: never persisted, logged or exported. */
  keys: Record<ProviderId, string>;
  models: Record<ProviderId, string>;
  verify: Record<ProviderId, VerifyState>;
}

interface Snapshot {
  step: Step;
  reqFile: LoadedFile | null;
  dictFile: LoadedFile | null;
  workspace: review.Workspace | null;
  selected: string | null;
}

const MAX_UPLOAD_BYTES = 1_000_000;
const DEMO_BASE = "/demo/";

function useWorkbenchState() {
  const toast = useToast();
  const [step, setStep] = useState<Step>(1);
  const [reqFile, setReqFile] = useState<LoadedFile | null>(null);
  const [dictFile, setDictFile] = useState<LoadedFile | null>(null);
  const [workspace, setWorkspace] = useState<review.Workspace | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mapView, setMapView] = useState<MapView>("review");
  const [drafts, setDrafts] = useState<Record<string, MappingDraft>>({});
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [serverKeys, setServerKeys] = useState<Record<ProviderId, boolean>>({ openai: false, anthropic: false });
  const [ai, setAi] = useState<AiSettings>({
    mode: "demo",
    keys: { openai: "", anthropic: "" },
    models: { openai: PROVIDERS.openai.defaultModel, anthropic: PROVIDERS.anthropic.defaultModel },
    verify: { openai: { state: "idle", message: null }, anthropic: { state: "idle", message: null } },
  });

  useEffect(() => {
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => body?.serverKeys && setServerKeys(body.serverKeys))
      .catch(() => {});
  }, []);

  const evaluations = useMemo(() => (workspace ? review.evaluateAll(workspace) : null), [workspace]);

  // --- Undoable snapshots -----------------------------------------------------------------

  const snapshot = (): Snapshot => ({ step, reqFile, dictFile, workspace, selected });
  const restore = (s: Snapshot) => {
    setStep(s.step);
    setReqFile(s.reqFile);
    setDictFile(s.dictFile);
    setWorkspace(s.workspace);
    setSelected(s.selected);
    setDrafts({});
  };

  /** Changing inputs invalidates proposals; keep an undo so review work is never lost by accident. */
  const inputsChanged = (before: Snapshot) => {
    if (!before.workspace) return;
    setWorkspace(null);
    setSelected(null);
    setDrafts({});
    setNotice(null);
    toast({ tone: "info", title: "Inputs changed", description: "Generate proposals again to review the new files.", action: { label: "Undo", onClick: () => restore(before) } });
  };

  // --- Files -----------------------------------------------------------------------------------

  const loadDemo = async (dictionaryName = "demo_data_dictionary.csv") => {
    const before = snapshot();
    try {
      const [reqRaw, dictRaw] = await Promise.all(
        ["demo_requirements.txt", dictionaryName].map(async (name) => {
          const response = await fetch(DEMO_BASE + name);
          if (!response.ok) throw new Error(name);
          return response.arrayBuffer();
        }),
      );
      setReqFile(parseRequirements("demo_requirements.txt", reqRaw, "demo"));
      setDictFile(parseDictionary(dictionaryName, dictRaw, "demo"));
      inputsChanged(before);
    } catch (error) {
      toast({ tone: "error", title: "Could not load demo data", description: `${(error as Error).message} was not found.` });
    }
  };

  const uploadFile = async (kind: FileKind, file: File) => {
    const before = snapshot();
    const extension = kind === "req" ? ".txt" : ".csv";
    const parser = kind === "req" ? parseRequirements : parseDictionary;
    const fileKind = kind === "req" ? "requirements" : "dictionary";
    const set = kind === "req" ? setReqFile : setDictFile;
    let loaded: LoadedFile;
    if (!file.name.toLowerCase().endsWith(extension)) {
      loaded = rejectedFile(file.name, fileKind, file.size, "Supported file type", `Only ${extension} files are supported here.`);
    } else if (file.size > MAX_UPLOAD_BYTES) {
      loaded = rejectedFile(file.name, fileKind, file.size, "Within size limit", "The file is larger than 1 MB.");
    } else {
      try {
        loaded = parser(file.name, await file.arrayBuffer(), "upload");
      } catch (error) {
        loaded = rejectedFile(file.name, fileKind, file.size, "File can be read", `The file could not be read: ${(error as Error).message}`);
      }
    }
    set(loaded);
    inputsChanged(before);
  };

  const clearFile = (kind: FileKind) => {
    const before = snapshot();
    (kind === "req" ? setReqFile : setDictFile)(null);
    inputsChanged(before);
  };

  // --- AI settings -------------------------------------------------------------------------------

  const setMode = (mode: EngineMode) => setAi((s) => ({ ...s, mode }));
  const setKey = (provider: ProviderId, key: string) =>
    setAi((s) => ({ ...s, keys: { ...s.keys, [provider]: key.trim() }, verify: { ...s.verify, [provider]: { state: "idle", message: null } } }));
  const setModel = (provider: ProviderId, model: string) => setAi((s) => ({ ...s, models: { ...s.models, [provider]: model } }));

  const verifyKey = async (provider: ProviderId) => {
    const setVerify = (v: VerifyState) => setAi((s) => ({ ...s, verify: { ...s.verify, [provider]: v } }));
    setVerify({ state: "checking", message: null });
    try {
      const response = await fetch("/api/verify-key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, apiKey: ai.keys[provider] || undefined }),
      });
      const body = await response.json().catch(() => null);
      setVerify(response.ok ? { state: "ok", message: "Key verified" } : { state: "error", message: body?.error ?? "Could not verify the key." });
    } catch {
      setVerify({ state: "error", message: "Could not reach the server." });
    }
  };

  const hasKey = (provider: ProviderId) => Boolean(ai.keys[provider]) || serverKeys[provider];

  // --- Generation ----------------------------------------------------------------------------------

  const generate = async () => {
    if (!reqFile?.ok || !dictFile?.ok) return;
    setGenerating(true);
    setNotice(null);
    const provider = ai.mode === "demo" ? null : ai.mode;
    let result;
    if (provider && !hasKey(provider)) {
      result = await generateMappings(null, reqFile.text, dictFile.fields, TARGET_FIELDS);
      result = { ...result, notice: `Live AI unavailable: no ${PROVIDERS[provider].label} API key added. Continuing in Demo mode.` };
    } else {
      result = await generateMappings(
        provider ? { provider, apiKey: ai.keys[provider], model: ai.models[provider] } : null,
        reqFile.text,
        dictFile.fields,
        TARGET_FIELDS,
      );
    }
    const ws = review.buildWorkspace(reqFile, dictFile, TARGET_FIELDS, result);
    const evals = review.evaluateAll(ws);
    setWorkspace(ws);
    setDrafts({});
    setMapView("review");
    setSelected(review.riskSorted(ws, evals)[0]?.target_field ?? null);
    setGenerating(false);
    setStep(2);
    if (result.notice) setNotice(result.notice); // shown as a banner above the mapping table
    if (result.origin === "demo" && (reqFile.origin !== "demo" || dictFile.name !== "demo_data_dictionary.csv")) {
      setNotice((n) =>
        [n, "Demo mode replays saved proposals for the demo data. Rule checks flag anything that doesn't fit your files; correct those mappings or use live AI."]
          .filter(Boolean)
          .join(" "),
      );
    }
  };

  // --- Reviewer actions -----------------------------------------------------------------------------

  const mutate = (fn: (ws: review.Workspace) => review.Workspace): boolean => {
    if (!workspace) return false;
    try {
      const next = fn(workspace);
      setWorkspace(next);
      return next !== workspace;
    } catch (error) {
      toast({ tone: "error", title: "Action not allowed", description: (error as Error).message });
      return false;
    }
  };

  const actions = {
    // Results of these actions are visible in place (status, row order, audit), so no toast.
    approve: (target: string) => mutate((ws) => review.approve(ws, target)),
    reject: (target: string, reason: string) => mutate((ws) => review.reject(ws, target, reason)),
    correct: (target: string, sources: string[], transformation: string, requirement: string | null) =>
      mutate((ws) => review.correct(ws, target, sources, transformation, requirement)),
    saveDrafts: () => {
      const changes = Object.entries(drafts).map(([target, d]) => ({
        target,
        sourceFields: d.sourceFields,
        transformationId: d.transformationId,
        requirementId: d.requirementId,
      }));
      if (!changes.length) return;
      if (mutate((ws) => review.applyCorrections(ws, changes))) {
        toast({ tone: "success", title: "Mapping saved", description: `${changes.length} target field${changes.length === 1 ? "" : "s"} updated. Checks re-ran and the changes are in the audit history.` });
      }
      setDrafts({});
    },
    setQuestionResolved: (id: number, resolved: boolean) => mutate((ws) => review.setQuestionResolved(ws, id, resolved)),
    addQuestion: (text: string) => mutate((ws) => review.addQuestion(ws, text)),
  };

  const exportBrief = (format: "download" | "copy") => {
    if (!workspace || !evaluations) return;
    const brief = buildBrief(workspace, evaluations);
    if (format === "download") {
      const url = URL.createObjectURL(new Blob([brief], { type: "text/markdown;charset=utf-8" }));
      const link = Object.assign(document.createElement("a"), { href: url, download: briefFileName(workspace) });
      link.click();
      URL.revokeObjectURL(url);
      mutate((ws) => review.recordExport(ws, "Markdown brief downloaded"));
      toast({ tone: "success", title: "Brief downloaded", description: briefFileName(workspace) });
    } else {
      navigator.clipboard.writeText(brief).then(
        () => {
          mutate((ws) => review.recordExport(ws, "Markdown brief copied to clipboard"));
          toast({ tone: "success", title: "Brief copied to clipboard" });
        },
        () => toast({ tone: "error", title: "Could not copy", description: "Your browser blocked clipboard access." }),
      );
    }
  };

  const reset = () => {
    const before = snapshot();
    setStep(1);
    setReqFile(null);
    setDictFile(null);
    setWorkspace(null);
    setSelected(null);
    setDrafts({});
    setNotice(null);
    toast({ tone: "info", title: "Workspace cleared", description: "API keys and settings were kept.", action: { label: "Undo", onClick: () => restore(before) } });
  };

  const goTo = (target: Step) => {
    if (target > 1 && !workspace) return;
    setStep(target);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /** Jump to the field-mapping editor with one target highlighted. */
  const editMapping = (target: string) => {
    setSelected(target);
    setMapView("mapping");
    goTo(2);
  };

  const setDraft = (target: string, draft: MappingDraft | null) =>
    setDrafts((all) => {
      const next = { ...all };
      if (draft) next[target] = draft;
      else delete next[target];
      return next;
    });

  const engineLabel =
    ai.mode === "demo" ? "Demo mode" : `${PROVIDERS[ai.mode].label} · ${modelLabel(ai.mode, ai.models[ai.mode])}`;

  return {
    step,
    goTo,
    reqFile,
    dictFile,
    loadDemo,
    uploadFile,
    clearFile,
    workspace,
    evaluations,
    selected,
    select: setSelected,
    mapView,
    setMapView,
    editMapping,
    drafts,
    setDraft,
    discardDrafts: () => setDrafts({}),
    generating,
    generate,
    notice,
    dismissNotice: () => setNotice(null),
    ai,
    setMode,
    setKey,
    setModel,
    verifyKey,
    hasKey,
    serverKeys,
    engineLabel,
    settingsOpen,
    openSettings: () => setSettingsOpen(true),
    closeSettings: () => setSettingsOpen(false),
    exportBrief,
    reset,
    ...actions,
  };
}

export type WorkbenchApi = ReturnType<typeof useWorkbenchState>;

const WorkbenchContext = createContext<WorkbenchApi | null>(null);

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const api = useWorkbenchState();
  return <WorkbenchContext.Provider value={api}>{children}</WorkbenchContext.Provider>;
}

export function useWorkbench(): WorkbenchApi {
  const api = useContext(WorkbenchContext);
  if (!api) throw new Error("useWorkbench must be used inside WorkbenchProvider");
  return api;
}

/** Workspace and evaluations for steps 2–4, which only render once proposals exist. */
export function useReview() {
  const api = useWorkbench();
  if (!api.workspace || !api.evaluations) throw new Error("No workspace");
  return { ...api, workspace: api.workspace, evaluations: api.evaluations };
}

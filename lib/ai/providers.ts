/** Provider and model metadata shared by the settings UI and the API routes. Contains no secrets. */

export type ProviderId = "openai" | "anthropic";
export type EngineMode = "demo" | ProviderId;

export interface ModelOption {
  id: string;
  label: string;
  note: string;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  keyPlaceholder: string;
  keyHint: RegExp;
  keysUrl: string;
  defaultModel: string;
  models: ModelOption[];
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    keyPlaceholder: "sk-…",
    keyHint: /^sk-/,
    keysUrl: "https://platform.openai.com/api-keys",
    defaultModel: "gpt-5-mini",
    models: [
      { id: "gpt-5-mini", label: "GPT-5 mini", note: "Fast, low cost" },
      { id: "gpt-5", label: "GPT-5", note: "Most capable" },
    ],
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    keyPlaceholder: "sk-ant-…",
    keyHint: /^sk-ant-/,
    keysUrl: "https://console.anthropic.com/settings/keys",
    defaultModel: "claude-opus-5-5",
    models: [
      { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "Most capable" },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "Faster, lower cost" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", note: "Fastest" },
    ],
  },
};

/** Model identifiers are free text in the UI; keep them to a safe character set. */
export const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

export function modelLabel(provider: ProviderId, model: string): string {
  return PROVIDERS[provider].models.find((m) => m.id === model)?.label ?? model;
}

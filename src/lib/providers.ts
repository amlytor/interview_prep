// Which AI backends QuantPrep can talk to.
//
// Two wire protocols cover everything: Anthropic's native Messages API, and
// the OpenAI-compatible /chat/completions shape that DeepSeek, Moonshot (Kimi),
// Alibaba (Qwen), OpenRouter, and local runtimes all expose. Adding a provider
// is a matter of adding a row here — no new client code.
//
// CORS caveat: the app is browser-only, so a provider has to send permissive
// CORS headers for a direct call to work. OpenRouter and Anthropic explicitly
// support browser calls; the others are best-effort and may need OpenRouter (or
// a local proxy) instead. `browserNote` is what the Settings page shows.

export type ProviderKind = "anthropic" | "openai-compatible";

export interface ProviderModel {
  id: string;
  label: string;
}

export interface ProviderInfo {
  id: string;
  label: string;
  kind: ProviderKind;
  /** Base URL for openai-compatible providers. Empty for Anthropic (SDK default). */
  baseUrl: string;
  /** Suggested models. The custom-model field always overrides this. */
  models: ProviderModel[];
  /**
   * Public, unauthenticated endpoint returning an OpenAI-style {data: [{id}]}
   * model list. When set, Settings loads the live catalogue instead of relying
   * on the hardcoded `models` above (which become a fallback).
   */
  modelsUrl?: string;
  keyUrl: string;
  keyLabel: string;
  keyPlaceholder: string;
  browserNote?: string;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    kind: "anthropic",
    baseUrl: "",
    models: [
      { id: "claude-sonnet-5", label: "Claude Sonnet 5 (recommended)" },
      { id: "claude-opus-5", label: "Claude Opus 5 (highest quality)" },
      { id: "claude-fable-5", label: "Claude Fable 5 (most capable, priciest)" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (fastest, cheapest)" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
    ],
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyLabel: "console.anthropic.com",
    keyPlaceholder: "sk-ant-...",
  },
  {
    id: "openrouter",
    label: "OpenRouter (DeepSeek, Qwen, Kimi, everything)",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    // Fallback only — the live catalogue below is fetched at runtime, so these
    // are used just when the browser can't reach openrouter.ai.
    models: [
      { id: "deepseek/deepseek-chat", label: "DeepSeek Chat" },
      { id: "qwen/qwen-max", label: "Qwen Max" },
      { id: "moonshotai/kimi-k2", label: "Kimi K2 (Moonshot)" },
      { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5 (via OpenRouter)" },
    ],
    modelsUrl: "https://openrouter.ai/api/v1/models",
    keyUrl: "https://openrouter.ai/keys",
    keyLabel: "openrouter.ai/keys",
    keyPlaceholder: "sk-or-v1-...",
    browserNote:
      "One key, hundreds of models, and it explicitly supports being called from a browser — the least friction if you want to mix providers. The model list below is loaded live from OpenRouter, with prices, so it's always current.",
  },
  {
    id: "deepseek",
    label: "DeepSeek (direct)",
    kind: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    models: [
      { id: "deepseek-chat", label: "deepseek-chat" },
      { id: "deepseek-reasoner", label: "deepseek-reasoner" },
    ],
    keyUrl: "https://platform.deepseek.com/api_keys",
    keyLabel: "platform.deepseek.com",
    keyPlaceholder: "sk-...",
    browserNote:
      "Calling DeepSeek straight from the browser depends on their CORS headers. If Test Connection fails with a network error, the request was blocked before it left the page — use OpenRouter instead.",
  },
  {
    id: "moonshot",
    label: "Moonshot / Kimi (direct)",
    kind: "openai-compatible",
    baseUrl: "https://api.moonshot.ai/v1",
    models: [
      { id: "kimi-k2-0905-preview", label: "kimi-k2-0905-preview" },
      { id: "moonshot-v1-128k", label: "moonshot-v1-128k" },
      { id: "moonshot-v1-32k", label: "moonshot-v1-32k" },
    ],
    keyUrl: "https://platform.moonshot.ai/console/api-keys",
    keyLabel: "platform.moonshot.ai",
    keyPlaceholder: "sk-...",
    browserNote:
      "Use the .cn base URL instead if your account is on the China endpoint — edit the base URL field below. Same CORS caveat as DeepSeek.",
  },
  {
    id: "dashscope",
    label: "Qwen / Alibaba DashScope (direct)",
    kind: "openai-compatible",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    models: [
      { id: "qwen-max", label: "qwen-max" },
      { id: "qwen-plus", label: "qwen-plus" },
      { id: "qwen-turbo", label: "qwen-turbo (cheapest)" },
    ],
    keyUrl: "https://bailian.console.aliyun.com/",
    keyLabel: "Alibaba Cloud console",
    keyPlaceholder: "sk-...",
    browserNote:
      "This is the international endpoint. Mainland accounts use dashscope.aliyuncs.com — edit the base URL below. Same CORS caveat as DeepSeek.",
  },
  {
    id: "local",
    label: "Local model (Ollama / LM Studio / llama.cpp)",
    kind: "openai-compatible",
    baseUrl: "http://localhost:11434/v1",
    models: [
      { id: "qwen2.5:14b", label: "qwen2.5:14b" },
      { id: "deepseek-r1:14b", label: "deepseek-r1:14b" },
      { id: "llama3.1:8b", label: "llama3.1:8b" },
    ],
    keyUrl: "https://ollama.com/download",
    keyLabel: "ollama.com",
    keyPlaceholder: "(usually blank — press Save with an empty key)",
    browserNote:
      "Nothing leaves your machine, and there's no bill. Ollama needs OLLAMA_ORIGINS set to allow the Vite dev origin (e.g. OLLAMA_ORIGINS=http://localhost:5173 ollama serve) or the browser call is blocked. LM Studio's server: base URL http://localhost:1234/v1.",
  },
  {
    id: "custom",
    label: "Custom OpenAI-compatible endpoint",
    kind: "openai-compatible",
    baseUrl: "",
    models: [],
    keyUrl: "",
    keyLabel: "",
    keyPlaceholder: "sk-...",
    browserNote:
      "Anything that speaks POST /chat/completions works — a self-hosted gateway, vLLM, Together, Groq, Fireworks. Set the base URL up to and including /v1.",
  },
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

// OpenRouter is the default for a fresh install: one key reaches Claude,
// DeepSeek, Qwen, and Kimi alike, and it is the provider least likely to be
// blocked by CORS from a browser-only app. Existing installs keep whatever
// they already had — this only affects first run.
export const DEFAULT_PROVIDER_ID = "openrouter";
export const DEFAULT_MODEL = "anthropic/claude-sonnet-5";

/**
 * What a settings payload with no `provider` field must have been. Those
 * predate multi-provider support, when Anthropic was the only option — so they
 * migrate to Anthropic, not to the new default, which they'd have no key for.
 */
export const LEGACY_PROVIDER_ID = "anthropic";

export function providerInfo(id: string): ProviderInfo {
  return BY_ID.get(id) ?? PROVIDERS[0];
}

// The app's single AI entry point.
//
// Every feature here (grading, quiz generation, note drafting, note
// classification) is the same request shape: one system prompt + one user
// message, text back. So the provider difference is confined to completeText()
// below — Anthropic's native Messages API via the official SDK, or the
// OpenAI-compatible /chat/completions shape that DeepSeek, Kimi, Qwen,
// OpenRouter, and local runtimes all speak. Everything else in this file is
// provider-agnostic.
import Anthropic from "@anthropic-ai/sdk";
import type {
  Choice,
  Difficulty,
  Question,
  QuestionValidation,
  Settings,
  StudyNote,
  Verdict,
  WhyMissedTag,
} from "../types";
import { MISSING_PREREQ_TAG, WHY_MISSED_TAGS } from "../types";
import type { ChatTurn, MissDiagnosis } from "../types";
import type { TopicId, TopicInfo } from "./topics";
import { topicLabel } from "./topics";
import { providerInfo } from "./providers";
import type { ProviderModel } from "./providers";

export interface GradingResult {
  verdict: Verdict;
  feedback: string;
  whyMissed: WhyMissedTag | null;
}

export class GradingError extends Error {
  cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "GradingError";
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Provider dispatch
// ---------------------------------------------------------------------------

interface LlmConfig {
  providerId: string;
  kind: "anthropic" | "openai-compatible";
  providerLabel: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  keyRequired: boolean;
}

/** Resolve the active provider/model/key/base-URL out of Settings. */
export function llmConfig(settings: Settings): LlmConfig {
  const info = providerInfo(settings.provider);
  return {
    providerId: info.id,
    kind: info.kind,
    providerLabel: info.label,
    model: settings.model,
    apiKey: settings.apiKeys?.[info.id] ?? "",
    baseUrl: (settings.baseUrls?.[info.id] || info.baseUrl).replace(/\/+$/, ""),
    // A local runtime is normally unauthenticated; everything else needs a key.
    keyRequired: info.id !== "local",
  };
}

interface CompletionRequest {
  system: string;
  user: string;
  maxTokens: number;
}

/** Human-readable failure for a native Anthropic SDK error. */
function describeAnthropicError(err: unknown, model: string): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "Invalid API key. Double-check the key you entered in Settings.";
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return "Your API key doesn't have permission to use this model.";
  }
  if (err instanceof Anthropic.NotFoundError) {
    return `Model "${model}" wasn't found. Check the model ID in Settings.`;
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Rate limited by the Anthropic API. Wait a moment, then retry.";
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Couldn't reach the Anthropic API. Check your internet connection and retry.";
  }
  if (err instanceof Anthropic.APIError) {
    return `Anthropic API error (status ${err.status ?? "unknown"}): ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return "Unknown error while contacting the Anthropic API.";
}

async function completeAnthropic(cfg: LlmConfig, req: CompletionRequest): Promise<string> {
  // Local, single-user app: the key never leaves the browser except in requests
  // going directly to api.anthropic.com.
  const client = new Anthropic({ apiKey: cfg.apiKey, dangerouslyAllowBrowser: true });
  try {
    const response = await client.messages.create({
      model: cfg.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
    });
    if (response.stop_reason === "refusal") {
      throw new GradingError("Claude declined this request. Try rephrasing and retry.");
    }
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new GradingError("Claude's response had no text content.");
    }
    return textBlock.text;
  } catch (err) {
    if (err instanceof GradingError) throw err;
    throw new GradingError(describeAnthropicError(err, cfg.model), err);
  }
}

/** Best-effort extraction of a provider's own error message from its body. */
function openAiErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const err = (body as Record<string, unknown>).error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const msg = (err as Record<string, unknown>).message;
    if (typeof msg === "string") return msg;
  }
  const msg = (body as Record<string, unknown>).message;
  return typeof msg === "string" ? msg : null;
}

interface OpenAiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Single system + user turn — the shape every non-chat feature uses. */
function completeOpenAiCompatible(cfg: LlmConfig, req: CompletionRequest): Promise<string> {
  return postOpenAiChat(
    cfg,
    [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
    req.maxTokens,
  );
}

/** Full turn history, for the diagnostic chat. */
function completeOpenAiChat(
  cfg: LlmConfig,
  system: string,
  turns: ChatTurn[],
  maxTokens: number,
): Promise<string> {
  return postOpenAiChat(
    cfg,
    [{ role: "system", content: system }, ...turns.map((t) => ({ role: t.role, content: t.content }))],
    maxTokens,
  );
}

async function postOpenAiChat(
  cfg: LlmConfig,
  messages: OpenAiMessage[],
  maxTokens: number,
): Promise<string> {
  if (!cfg.baseUrl) {
    throw new GradingError("No base URL set for this provider. Add one in Settings.");
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  if (cfg.providerId === "openrouter") {
    // OpenRouter attributes browser traffic with these; both are optional.
    headers["http-referer"] = window.location.origin;
    headers["x-title"] = "QuantPrep";
  }

  let response: Response;
  try {
    response = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, messages }),
    });
  } catch (err) {
    // fetch() rejects for network failures AND for CORS rejections, which look
    // identical from script. CORS is by far the likelier cause here.
    throw new GradingError(
      `Couldn't reach ${cfg.providerLabel} at ${cfg.baseUrl}. Either the network is down, or the ` +
        `provider refused a direct browser call (CORS). OpenRouter and Anthropic both allow ` +
        `browser calls — switching to one of those in Settings is the usual fix.`,
      err,
    );
  }

  if (!response.ok) {
    let detail: string | null = null;
    try {
      detail = openAiErrorMessage(await response.json());
    } catch {
      /* non-JSON error body; fall through to the status-only message */
    }
    const suffix = detail ? `: ${detail}` : "";
    if (response.status === 401 || response.status === 403) {
      throw new GradingError(`${cfg.providerLabel} rejected your API key (${response.status})${suffix}`);
    }
    if (response.status === 404) {
      throw new GradingError(
        `Model "${cfg.model}" wasn't found at ${cfg.baseUrl}. Check the model ID and base URL in Settings${suffix}`,
      );
    }
    if (response.status === 429) {
      throw new GradingError(`Rate limited by ${cfg.providerLabel}. Wait a moment, then retry${suffix}`);
    }
    throw new GradingError(`${cfg.providerLabel} error (status ${response.status})${suffix}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (err) {
    throw new GradingError(`${cfg.providerLabel} returned a non-JSON response.`, err);
  }

  const body = payload as Record<string, unknown>;

  // OpenRouter (and some gateways) can report a failure inside a 200 response
  // rather than via the status code.
  const inlineError = openAiErrorMessage(body);
  if (inlineError) {
    throw new GradingError(`${cfg.providerLabel} error: ${inlineError}`);
  }

  const choices = body.choices;
  const first = Array.isArray(choices) ? (choices[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) {
    throw new GradingError(`${cfg.providerLabel} returned no completion for "${cfg.model}". Retry.`);
  }

  const message = first.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (typeof content === "string" && content.trim().length > 0) return content;

  // Empty visible content has a few distinct causes, and saying which one saves
  // a lot of guesswork. The common one is a reasoning model: it spends the
  // output budget on internal reasoning and emits nothing visible, which shows
  // up as finish_reason "length" and/or a populated `reasoning` field.
  const finish = typeof first.finish_reason === "string" ? first.finish_reason : null;
  const reasoning = typeof message?.reasoning === "string" ? message.reasoning : "";

  if (finish === "length") {
    throw new GradingError(
      `"${cfg.model}" hit its output-token limit before producing an answer` +
        (reasoning ? " — it spent the whole budget on internal reasoning." : ".") +
        ` This is typical of reasoning models. Pick a non-reasoning model in Settings (for grading, a ` +
        `standard chat model is both faster and cheaper), or retry — the limit is already generous.`,
    );
  }

  // Truncation aside, a reasoning model may put everything in `reasoning`.
  // Better to use it than to fail — the schema validators reject it if unusable.
  if (reasoning.trim().length > 0) return reasoning;

  if (finish === "content_filter") {
    throw new GradingError(`"${cfg.model}" refused this request via its content filter. Try a different model.`);
  }
  throw new GradingError(
    `${cfg.providerLabel} returned an empty response for "${cfg.model}"` +
      (finish ? ` (finish_reason: ${finish})` : "") +
      `. The model may be temporarily unavailable on this provider — retry, or pick another model in Settings.`,
  );
}

/** One system + one user message in, text out — whichever provider is active. */
async function completeText(settings: Settings, req: CompletionRequest): Promise<string> {
  const cfg = llmConfig(settings);
  if (cfg.keyRequired && !cfg.apiKey) {
    throw new GradingError(`No API key set for ${cfg.providerLabel}. Add one in Settings.`);
  }
  if (!cfg.model) {
    throw new GradingError("No model selected. Pick one in Settings.");
  }
  return cfg.kind === "anthropic"
    ? completeAnthropic(cfg, req)
    : completeOpenAiCompatible(cfg, req);
}

/** Format an OpenRouter per-token price string as dollars per million tokens. */
function perMillion(raw: unknown): string | null {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n)) return null;
  if (n === 0) return "free";
  const perM = n * 1_000_000;
  return `$${perM < 1 ? perM.toFixed(2) : perM.toFixed(perM < 10 ? 1 : 0)}`;
}

/**
 * Load a provider's live model catalogue from its public (unauthenticated)
 * models endpoint. Used so the model picker never depends on a hardcoded list
 * going stale. Returns null when the provider has no such endpoint; throws only
 * on an unexpected shape — callers fall back to the built-in suggestions.
 */
export async function fetchProviderModels(providerId: string): Promise<ProviderModel[] | null> {
  const info = providerInfo(providerId);
  if (!info.modelsUrl) return null;

  const response = await fetch(info.modelsUrl);
  if (!response.ok) throw new Error(`model list request failed (${response.status})`);
  const payload = (await response.json()) as { data?: unknown };
  if (!Array.isArray(payload.data)) throw new Error("unexpected model list shape");

  const models: ProviderModel[] = [];
  for (const entry of payload.data) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== "string") continue;

    const name = typeof e.name === "string" ? e.name : e.id;
    const pricing = e.pricing as Record<string, unknown> | undefined;
    const inPrice = perMillion(pricing?.prompt);
    const outPrice = perMillion(pricing?.completion);
    // "free" on both sides reads better than "free/free".
    const price =
      inPrice && outPrice ? (inPrice === "free" && outPrice === "free" ? "free" : `${inPrice}/${outPrice} per M`) : null;

    models.push({ id: e.id, label: price ? `${name} · ${price}` : name });
  }
  models.sort((a, b) => a.id.localeCompare(b.id));
  return models;
}

/**
 * Whether the active provider has everything it needs to be called. Drives the
 * "set up AI first" banners — note that a local runtime is ready without a key,
 * so this is not the same as checking for a non-empty API key.
 */
export function aiConfigured(settings: Settings): boolean {
  const cfg = llmConfig(settings);
  if (!cfg.model) return false;
  if (cfg.keyRequired && !cfg.apiKey) return false;
  if (cfg.kind === "openai-compatible" && !cfg.baseUrl) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Multi-turn chat
// ---------------------------------------------------------------------------

/**
 * Continue a conversation. Same provider dispatch as completeText(), but takes
 * a turn history instead of a single user message — needed for the diagnostic
 * chat, where the model asks a follow-up before concluding.
 */
export async function completeChat(
  settings: Settings,
  system: string,
  turns: ChatTurn[],
  maxTokens = 2000,
): Promise<string> {
  const cfg = llmConfig(settings);
  if (cfg.keyRequired && !cfg.apiKey) {
    throw new GradingError(`No API key set for ${cfg.providerLabel}. Add one in Settings.`);
  }
  if (turns.length === 0) throw new GradingError("Nothing to send.");

  if (cfg.kind === "anthropic") {
    const client = new Anthropic({ apiKey: cfg.apiKey, dangerouslyAllowBrowser: true });
    try {
      const response = await client.messages.create({
        model: cfg.model,
        max_tokens: maxTokens,
        system,
        messages: turns.map((t) => ({ role: t.role, content: t.content })),
      });
      if (response.stop_reason === "refusal") {
        throw new GradingError("Claude declined to continue this conversation.");
      }
      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new GradingError("Claude's reply had no text content.");
      }
      return textBlock.text;
    } catch (err) {
      if (err instanceof GradingError) throw err;
      throw new GradingError(describeAnthropicError(err, cfg.model), err);
    }
  }

  return completeOpenAiChat(cfg, system, turns, maxTokens);
}

/** Minimal round-trip used by the Settings page "Test connection" button. */
export async function testConnection(settings: Settings): Promise<string> {
  const cfg = llmConfig(settings);
  await completeText(settings, {
    system: "You are a connection test. Reply with the single word OK.",
    user: "Reply with the single word OK.",
    maxTokens: 600,
  });
  return `${cfg.providerLabel} responded — ${cfg.model} is reachable.`;
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert quant interview coach grading a candidate's free-text answer to a probability, derivatives/Greeks, or risk-theory interview question.

Judge the candidate's answer against the canonical answer and explanation provided. Respond in a Socratic teaching style:
- If the candidate is CORRECT: briefly affirm why, in 1-2 sentences.
- If the candidate is PARTIALLY correct (right idea/technique but an execution error, or the right final answer reached via flawed reasoning): give a nudge that points at what's missing or wrong WITHOUT handing them the full derivation, so they have a chance to close the gap themselves.
- If the candidate is INCORRECT or clearly lost: give the full explanation, teaching the correct approach step by step.

Also classify the primary reason the candidate missed the question (ONLY when verdict is "partial" or "incorrect"; use null when verdict is "correct"), choosing exactly ONE tag from this fixed taxonomy:
- "didn't recognize technique" — they didn't identify which method/framework applies
- "misread problem" — they solved a different problem than the one actually asked
- "knew technique but couldn't execute" — right approach, but broke down in execution
- "arithmetic slip" — right approach and setup, but a computational/arithmetic error
- "ran out of time" — only use this if the candidate's answer itself says they ran out of time or gave up partway

Respond with ONLY a JSON object — no markdown code fences, no prose before or after — matching exactly this shape:
{"verdict": "correct" | "partial" | "incorrect", "feedback": "<your feedback text>", "whyMissed": "<one of the five tags above>" | null}`;

function buildUserPrompt(question: Question, userAnswer: string): string {
  return `Question (${question.difficulty}, topics: ${question.topics.map(topicLabel).join(", ")}):
${question.prompt}

Canonical answer: ${question.canonicalAnswer}

Full worked explanation (for your reference when judging and writing feedback — do not just paste this back verbatim):
${question.explanation}

Candidate's answer:
${userAnswer || "(left blank)"}`;
}

function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json|markdown|md)?/i, "")
    .replace(/```$/, "")
    .trim();
}

function parseGradingResponse(raw: string): GradingResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    throw new GradingError(
      "The model's response wasn't valid JSON, so it couldn't be graded automatically. Raw response:\n\n" + raw,
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new GradingError("Unexpected response shape from the grading model.");
  }
  const obj = parsed as Record<string, unknown>;

  const verdict = obj.verdict;
  if (verdict !== "correct" && verdict !== "partial" && verdict !== "incorrect") {
    throw new GradingError("Unexpected verdict in the model's response: " + JSON.stringify(obj.verdict));
  }

  const feedback = typeof obj.feedback === "string" ? obj.feedback : "";

  let whyMissed: WhyMissedTag | null = null;
  if (typeof obj.whyMissed === "string" && (WHY_MISSED_TAGS as string[]).includes(obj.whyMissed)) {
    whyMissed = obj.whyMissed as WhyMissedTag;
  }

  return { verdict, feedback, whyMissed };
}

export async function gradeFreeTextAnswer(
  question: Question,
  userAnswer: string,
  settings: Settings,
): Promise<GradingResult> {
  const raw = await completeText(settings, {
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(question, userAnswer),
    maxTokens: 4000,
  });
  return parseGradingResponse(raw);
}

// ---------------------------------------------------------------------------
// Quiz generation from a note
// ---------------------------------------------------------------------------

/** A question ready to be staged: everything but the store-assigned id/createdAt. */
export type QuizDraft = Omit<Question, "id" | "createdAt">;

const CHOICE_IDS = ["a", "b", "c", "d", "e", "f"];

const QUIZ_SYSTEM_PROMPT = `You are writing practice questions for a candidate preparing for quantitative trading and quant-research interviews (Jane Street, SIG, Optiver, and the Zhou / Crack / Heard on the Street problem books). These are NOT undergraduate textbook exercises. Calibrate to the anchors below — they are real questions from this student's own bank, and your output must sit at the same level.

EASY — one step, one named technique, no trap:
  "You flip a fair coin repeatedly until you get heads. What is the expected number of flips?"

MEDIUM — two steps, or one technique applied in a setup that hides it:
  "A bag has 3 red and 2 blue balls. You draw without replacement until you get a blue ball. What is the expected draw number of the first blue?"

HARD — multi-step reasoning, non-obvious choice of technique, or a classic trap:
  "You flip a fair coin repeatedly. What is the expected number of flips to get two heads in a row?"  (state recursion)
  "Shuffle a 52-card deck and flip through it. What is the expected number of times an Ace appears immediately before a King?"  (indicator variables + linearity)
  "Five pirates ranked by seniority split 100 gold coins. The senior proposes a split; if at least half accept it passes, otherwise he is thrown overboard and the next proposes. All are perfectly rational and prefer more gold, then survival. What does the senior propose?"  (backward induction)

WHAT "HARD" DOES NOT MEAN. Do not make a question harder by using bigger numbers, more balls, more dice, or uglier fractions. Arithmetic weight is not difficulty. A question is hard because the candidate must realise WHICH technique applies, chain two or more ideas together, or avoid a trap that makes the wrong answer look right. If your "hard" question is the easy anchor with 47 in place of 2, you have failed this instruction.

Produce a mix of:
(a) 2-3 recall questions checking the note's key formulas, triggers, and pitfalls (difficulty "easy", a mix of multiple_choice and free_text), and
(b) 2-3 application questions that apply the technique to a NOVEL setup appearing neither in the note nor in the "existing questions" list (difficulty "medium" or "hard", mostly free_text).

Rules:
- Do NOT duplicate or trivially reword the existing questions you are shown.
- Every question must be self-contained and precisely worded, with a single defensible answer.
- canonicalAnswer is the short final answer; explanation is a complete worked solution teaching the technique.
- For multiple_choice: 4 plausible options, exactly one correct, correctOption is the 0-based index into options. Wrong options should be the answers a candidate would actually reach by making a specific mistake — not random numbers.
- "technique" names the method the question tests (e.g. "linearity of expectation via indicator variables", "condition on the first step").
- "difficultyRationale" is ONE sentence on why it sits at the claimed difficulty. If you cannot name a reason beyond "the numbers are larger", the question is not hard — lower the label or write a better question.

Respond with ONLY a JSON object — no markdown code fences, no prose — of exactly this shape:
{"questions": [{"difficulty": "easy" | "medium" | "hard", "type": "free_text" | "multiple_choice", "prompt": "...", "canonicalAnswer": "...", "explanation": "...", "technique": "...", "difficultyRationale": "...", "options": ["..."], "correctOption": 0}]}
(options/correctOption only on multiple_choice questions.)`;

function validateQuizPayload(raw: string, note: StudyNote): QuizDraft[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    throw new GradingError("The quiz response wasn't valid JSON. Retry the generation.\n\nRaw response:\n" + raw);
  }

  // Accept either {questions: [...]} or a bare array.
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).questions)
      ? ((parsed as Record<string, unknown>).questions as unknown[])
      : null;
  if (!list || list.length === 0) {
    throw new GradingError("The quiz response had no questions array. Retry the generation.");
  }

  const drafts: QuizDraft[] = [];
  for (const [i, entry] of list.entries()) {
    if (typeof entry !== "object" || entry === null) {
      throw new GradingError(`Quiz question ${i + 1} isn't an object. Retry the generation.`);
    }
    const q = entry as Record<string, unknown>;

    const difficulty = q.difficulty;
    if (difficulty !== "easy" && difficulty !== "medium" && difficulty !== "hard") {
      throw new GradingError(`Quiz question ${i + 1} has an invalid difficulty. Retry the generation.`);
    }
    const type = q.type;
    if (type !== "free_text" && type !== "multiple_choice") {
      throw new GradingError(`Quiz question ${i + 1} has an invalid type. Retry the generation.`);
    }
    if (typeof q.prompt !== "string" || q.prompt.trim().length === 0) {
      throw new GradingError(`Quiz question ${i + 1} is missing a prompt. Retry the generation.`);
    }
    if (typeof q.canonicalAnswer !== "string" || q.canonicalAnswer.trim().length === 0) {
      throw new GradingError(`Quiz question ${i + 1} is missing a canonicalAnswer. Retry the generation.`);
    }
    if (typeof q.explanation !== "string" || q.explanation.trim().length === 0) {
      throw new GradingError(`Quiz question ${i + 1} is missing an explanation. Retry the generation.`);
    }

    const draft: QuizDraft = {
      prompt: q.prompt.trim(),
      // Force the note's topic regardless of what the model tagged — a quiz
      // generated from a note always belongs to that note's topic.
      topics: [note.topicId],
      difficulty: difficulty as Difficulty,
      answerMode: type === "multiple_choice" ? "multiple-choice" : "free-text",
      canonicalAnswer: q.canonicalAnswer.trim(),
      explanation: q.explanation.trim(),
      custom: true,
      origin: "ai",
      answerSeen: false,
      technique: typeof q.technique === "string" ? q.technique.trim() : undefined,
      difficultyRationale:
        typeof q.difficultyRationale === "string" ? q.difficultyRationale.trim() : undefined,
    };

    if (type === "multiple_choice") {
      const options = q.options;
      const correct = q.correctOption;
      if (
        !Array.isArray(options) ||
        options.length < 2 ||
        options.length > CHOICE_IDS.length ||
        !options.every((o) => typeof o === "string" && o.trim().length > 0)
      ) {
        throw new GradingError(`Quiz question ${i + 1} has invalid options. Retry the generation.`);
      }
      if (typeof correct !== "number" || !Number.isInteger(correct) || correct < 0 || correct >= options.length) {
        throw new GradingError(`Quiz question ${i + 1} has an invalid correctOption. Retry the generation.`);
      }
      draft.choices = (options as string[]).map((text, idx): Choice => ({ id: CHOICE_IDS[idx], text }));
      draft.correctChoiceId = CHOICE_IDS[correct];
    }

    drafts.push(draft);
  }
  return drafts;
}

/**
 * Generate a quiz from a study note. Returns validated drafts for the staging
 * queue; throws GradingError on API failure or malformed output (nothing is
 * ever saved from a bad response — the caller just retries).
 */
export async function generateQuizFromNote(
  note: StudyNote,
  existingPrompts: string[],
  settings: Settings,
  /** Difficulty steer from the student's own ratings; null when there's no signal. */
  calibrationInstruction: string | null = null,
): Promise<QuizDraft[]> {
  const existing =
    existingPrompts.length > 0
      ? `Existing questions for this topic (do NOT duplicate these):\n${existingPrompts
          .map((p, i) => `${i + 1}. ${p}`)
          .join("\n")}`
      : "There are no existing questions for this topic yet.";

  const raw = await completeText(settings, {
    system: calibrationInstruction
      ? `${QUIZ_SYSTEM_PROMPT}\n\n${calibrationInstruction}`
      : QUIZ_SYSTEM_PROMPT,
    user: `Topic: ${note.title}

Study note (markdown):
${note.body}

${existing}`,
    maxTokens: 8000,
  });
  return validateQuizPayload(raw, note);
}

// ---------------------------------------------------------------------------
// Note drafting
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Validation pass: check generated questions before they reach the staging queue
// ---------------------------------------------------------------------------

const VALIDATE_SYSTEM_PROMPT = `You are checking draft interview questions for defects BEFORE a student sees them. The student intends to approve clean questions WITHOUT reading the answer, so a broken question would silently poison their practice. Be strict.

Flag a question as "suspect" if any of these hold:
- The problem is ambiguous, or admits more than one defensible answer.
- The stated answer is wrong, or does not follow from the problem.
- The problem is missing information needed to solve it.
- The explanation contradicts the stated answer.
- It does not actually test the topic it is filed under.
- For multiple choice: more than one option is defensible, or none is correct.
- It is a near-duplicate of another question in the same batch.

Do NOT flag a question merely for being easy, terse, or unoriginal — those are not defects. Judge correctness and well-formedness only.

Respond with ONLY a JSON object — no markdown code fences, no prose — of exactly this shape:
{"results": [{"index": 0, "status": "clean" | "suspect", "issues": ["..."]}]}
Include one entry per question, in the order given, with "index" matching the number shown. "issues" is empty for clean questions and states the specific defect otherwise.`;

/**
 * Check a batch of drafts for well-formedness in ONE call (not one per
 * question — cheaper, and it also lets the model spot duplicates within the
 * batch). Never throws: a failed validation pass marks everything "suspect"
 * so the user inspects rather than bulk-approving unchecked content.
 */
export async function validateQuizDrafts(
  drafts: QuizDraft[],
  settings: Settings,
): Promise<QuestionValidation[]> {
  const unchecked = (reason: string): QuestionValidation[] =>
    drafts.map(() => ({ status: "suspect" as const, issues: [reason] }));

  const listing = drafts
    .map((d, i) => {
      const choices = d.choices
        ? `\nOptions: ${d.choices.map((c) => `${c.id}) ${c.text}`).join("  ")}\nCorrect option: ${d.correctChoiceId}`
        : "";
      return `[${i}] Topic: ${topicLabel(d.topics[0] ?? "")} · claimed difficulty: ${d.difficulty}
Question: ${d.prompt}${choices}
Stated answer: ${d.canonicalAnswer}
Explanation: ${d.explanation}`;
    })
    .join("\n\n---\n\n");

  let raw: string;
  try {
    raw = await completeText(settings, {
      system: VALIDATE_SYSTEM_PROMPT,
      user: `Check these ${drafts.length} draft questions:\n\n${listing}`,
      maxTokens: 4000,
    });
  } catch (err) {
    return unchecked(
      `Couldn't run the automatic check (${err instanceof Error ? err.message : "unknown error"}) — review this one yourself.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return unchecked("The automatic check returned malformed output — review this one yourself.");
  }

  const results = (parsed as Record<string, unknown>)?.results;
  if (!Array.isArray(results)) {
    return unchecked("The automatic check returned an unexpected shape — review this one yourself.");
  }

  // Map by declared index rather than position: a model that drops or reorders
  // an entry must not shift everyone else's verdict onto the wrong question.
  const byIndex = new Map<number, QuestionValidation>();
  for (const entry of results) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.index !== "number" || !Number.isInteger(e.index)) continue;
    const issues = Array.isArray(e.issues)
      ? e.issues.filter((i): i is string => typeof i === "string" && i.trim().length > 0)
      : [];
    // Anything not explicitly cleared is treated as suspect — fail closed.
    const status: QuestionValidation["status"] =
      e.status === "clean" && issues.length === 0 ? "clean" : "suspect";
    byIndex.set(e.index, {
      status,
      issues: status === "suspect" && issues.length === 0 ? ["Flagged without a stated reason."] : issues,
    });
  }

  return drafts.map(
    (_, i) => byIndex.get(i) ?? { status: "suspect", issues: ["The automatic check skipped this one."] },
  );
}

const NOTE_SECTIONS = `## Core idea
## When to use (trigger)
## Key formulas  (use $...$ inline math and $$...$$ display math, LaTeX syntax)
## Worked example
## Common mistakes`;

const NOTE_SYSTEM_PROMPT = `You are an expert quant interview coach writing a study note for interview prep.

Write the note as markdown with exactly these sections, in this order:
${NOTE_SECTIONS}

Keep it tight and practical — interview-focused intuition, not a textbook chapter. Respond with ONLY the markdown note body: no preamble, no code fences, and do not include a top-level title heading (the app renders the title separately).`;

/**
 * Draft a new note body, or extend an existing one, for a topic. Returns
 * markdown only; the caller decides whether/how to apply it (authored notes
 * are never overwritten without explicit confirmation in the UI).
 */
export async function generateNoteMarkdown(
  topicTitle: string,
  currentBody: string | null,
  settings: Settings,
): Promise<string> {
  const userPrompt = currentBody
    ? `Topic: ${topicTitle}

Here is the current note. Produce an improved, expanded version that keeps everything correct and useful from it (especially any personal reminders), deepens the weakest sections, and stays in the same section structure:

${currentBody}`
    : `Topic: ${topicTitle}

There is no note for this topic yet — write one from scratch.`;

  const raw = await completeText(settings, {
    system: NOTE_SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: 6000,
  });
  const body = stripFences(raw);
  if (body.length < 40) {
    throw new GradingError("The model returned an implausibly short note draft. Retry.");
  }
  return body;
}

// ---------------------------------------------------------------------------
// Miss diagnosis: work out WHY a question was missed, then classify it
// ---------------------------------------------------------------------------

/** Everything the diagnostic chat needs to know about the miss. */
export interface DiagnosisContext {
  prompt: string;
  userAnswer: string;
  canonicalAnswer: string;
  explanation: string;
  topicLabels: string[];
  verdict: Verdict;
  /** id — label for every topic upstream in the prereq graph, with mastery. */
  prereqOptions: { id: TopicId; label: string; mastery: number }[];
}

function diagnosisSystemPrompt(ctx: DiagnosisContext): string {
  const prereqs =
    ctx.prereqOptions.length > 0
      ? ctx.prereqOptions
          .map((p) => `  ${p.id} — ${p.label} (their mastery: ${p.mastery}/100)`)
          .join("\n")
      : "  (this topic has no prerequisites in their graph)";

  return `You are a quant interview coach helping a student work out WHY they just got a question wrong. You are diagnosing, not re-teaching.

Your goal is the ROOT CAUSE, which is often not the obvious one. A student who says "I forgot the formula" may actually not have recognised which technique applied; one who made an arithmetic slip may have set the problem up in a needlessly messy way. Probe for that.

How to run this conversation:
- Open by naming what you can already see went wrong, in one or two sentences, and ask ONE specific question that would distinguish between the likely causes. Do not ask a vague "what do you think went wrong?".
- Ask at most two or three questions in total. This is a quick diagnosis, not a tutorial.
- When you have enough to name the root cause, say so plainly and stop asking questions.
- Be direct and brief. No preamble, no praise, no restating their answer back to them.

The question they missed:
${ctx.prompt}

Their answer:
${ctx.userAnswer || "(left blank)"}

The correct answer: ${ctx.canonicalAnswer}
Worked solution: ${ctx.explanation}
Topic(s): ${ctx.topicLabels.join(", ")}
Grader's verdict: ${ctx.verdict}

Prerequisite topics in their knowledge graph (the ONLY topics you may cite as a missing prerequisite):
${prereqs}

If the real cause is that a prerequisite isn't solid, say which one by name and why you think so — their mastery scores above are evidence, but their own words matter more.`;
}

/** Opening turn: the model speaks first, so seed it with an instruction. */
export const DIAGNOSIS_OPENER = "Why do you think I got this wrong? Start the diagnosis.";

export async function diagnosisReply(
  ctx: DiagnosisContext,
  turns: ChatTurn[],
  settings: Settings,
): Promise<string> {
  return completeChat(settings, diagnosisSystemPrompt(ctx), turns, 1500);
}

function concludeSystemPrompt(ctx: DiagnosisContext): string {
  const ids = ctx.prereqOptions.map((p) => p.id);
  return `You are summarising a completed diagnostic conversation between a quant interview coach and a student about a question the student got wrong.

Classify the root cause into EXACTLY ONE of these tags, verbatim:
${WHY_MISSED_TAGS.map((t) => `- "${t}"`).join("\n")}

Guidance on the tags:
- "missing prerequisite knowledge" means the gap is in a topic UNDERNEATH this one — they could not have got this right without first shoring that up. Use it only when the conversation actually supports that, not as a catch-all.
- "knew technique but couldn't execute" means they picked the right method and then broke down applying it.
- "didn't recognize technique" means they never identified which method applied.

If and only if you choose "missing prerequisite knowledge", list the responsible topics in "recommendedTopics", using ids from this exact list and no others:
${ids.length > 0 ? ids.map((i) => `  ${i}`).join("\n") : "  (none available — in that case return an empty list)"}
For every other tag, "recommendedTopics" must be an empty list.

"summary" is ONE sentence, written to the student in the second person, naming the specific cause — not a generic platitude. Good: "You conditioned on the wrong event because you read 'at least one' as 'exactly one'." Bad: "You made a mistake on this problem."

Respond with ONLY a JSON object — no markdown code fences, no prose — of exactly this shape:
{"tag": "<one tag, verbatim>", "summary": "...", "recommendedTopics": ["<id>", ...]}`;
}

/**
 * Turn a finished conversation into a stored diagnosis. Recommended topics are
 * validated against the prerequisite closure, so the model cannot invent a
 * topic or point at one that isn't genuinely upstream.
 */
export async function concludeDiagnosis(
  ctx: DiagnosisContext,
  turns: ChatTurn[],
  settings: Settings,
): Promise<Pick<MissDiagnosis, "tag" | "summary" | "recommendedTopics">> {
  const transcript = turns
    .map((t) => `${t.role === "user" ? "Student" : "Coach"}: ${t.content}`)
    .join("\n\n");

  const raw = await completeText(settings, {
    system: concludeSystemPrompt(ctx),
    user: `The question: ${ctx.prompt}\n\nTheir answer: ${ctx.userAnswer || "(left blank)"}\n\nThe conversation:\n\n${transcript}`,
    maxTokens: 2000,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    throw new GradingError("The diagnosis summary wasn't valid JSON. Retry.\n\nRaw response:\n" + raw);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new GradingError("Unexpected diagnosis shape. Retry.");
  }
  const obj = parsed as Record<string, unknown>;

  const tag = WHY_MISSED_TAGS.find((t) => t === obj.tag);
  if (!tag) {
    throw new GradingError(
      `The diagnosis came back with an unrecognised reason (${JSON.stringify(obj.tag)}). Retry.`,
    );
  }

  const allowed = new Set(ctx.prereqOptions.map((p) => p.id));
  const recommendedTopics =
    tag === MISSING_PREREQ_TAG && Array.isArray(obj.recommendedTopics)
      ? (obj.recommendedTopics.filter(
          (t): t is TopicId => typeof t === "string" && allowed.has(t),
        ) as TopicId[])
      : [];

  const summary =
    typeof obj.summary === "string" && obj.summary.trim().length > 0
      ? obj.summary.trim()
      : "No summary was returned — edit this to describe what went wrong.";

  return { tag, summary, recommendedTopics };
}

// ---------------------------------------------------------------------------
// Note classification: raw notes in, a filed + formatted note out
// ---------------------------------------------------------------------------

export interface ClassifiedNote {
  /** Suggested title for the topic. */
  title: string;
  /** An existing topic this clearly belongs under, or null if it's genuinely new. */
  existingTopicId: TopicId | null;
  /** Why the model filed it that way — shown to the user before they accept. */
  reasoning: string;
  /** Existing topics this builds on, for the prerequisite graph. */
  prereqs: TopicId[];
  /** The raw notes rewritten into the app's five-section markdown format. */
  body: string;
}

const CLASSIFY_SYSTEM_PROMPT = `You are organizing a quant-interview student's raw, unstructured notes into their existing study system.

You will be given (a) the student's raw notes and (b) the list of topics already in their system, as "id — label" pairs.

Decide two things, then rewrite the notes.

1. FILING. If the raw notes are clearly about a topic that already exists, set "existingTopicId" to that topic's id. Only do this when it is a genuine match — the notes belong inside that topic, not merely near it. If the notes cover a technique or idea that has no home in the list, set "existingTopicId" to null and give a short, specific "title" for a new topic (2-5 words, the name of the technique — not a sentence).

2. PREREQUISITES. List the ids of existing topics a student would need to understand FIRST. Choose from the given ids only; use 0-3, fewer is better, and never include the topic itself.

3. REWRITE. Rewrite the raw notes as a markdown study note with exactly these sections, in this order:
${NOTE_SECTIONS}

Preserve everything substantive the student wrote, including personal reminders and their own phrasing where it is clear. Fill in gaps where a section would otherwise be empty, but do not invent personal experiences they did not describe. No preamble, no code fences, no top-level title heading.

Respond with ONLY a JSON object — no markdown code fences, no prose — of exactly this shape:
{"title": "...", "existingTopicId": "<an id from the list>" | null, "reasoning": "<one sentence on why you filed it there>", "prereqs": ["<id>", ...], "body": "<the markdown note>"}`;

/**
 * Given a paste of raw notes, ask the model where it belongs in the existing
 * taxonomy and rewrite it into the app's note format. Purely advisory — the
 * caller shows the result for approval before anything is saved.
 */
export async function classifyNotes(
  rawNotes: string,
  topics: TopicInfo[],
  settings: Settings,
): Promise<ClassifiedNote> {
  const validIds = new Set(topics.map((t) => t.id));
  const raw = await completeText(settings, {
    system: CLASSIFY_SYSTEM_PROMPT,
    user: `Existing topics (id — label):
${topics.map((t) => `${t.id} — ${t.label}`).join("\n")}

Raw notes from the student:
${rawNotes}`,
    maxTokens: 8000,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    throw new GradingError("The classification response wasn't valid JSON. Retry.\n\nRaw response:\n" + raw);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new GradingError("Unexpected classification response shape. Retry.");
  }
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.body !== "string" || obj.body.trim().length < 40) {
    throw new GradingError("The model didn't return a usable note body. Retry.");
  }

  // Drop any id the model invented rather than picking from the list.
  const existingTopicId =
    typeof obj.existingTopicId === "string" && validIds.has(obj.existingTopicId) ? obj.existingTopicId : null;
  const prereqs = Array.isArray(obj.prereqs)
    ? (obj.prereqs.filter(
        (p): p is string => typeof p === "string" && validIds.has(p) && p !== existingTopicId,
      ) as TopicId[])
    : [];

  const title =
    typeof obj.title === "string" && obj.title.trim().length > 0
      ? obj.title.trim().slice(0, 60)
      : existingTopicId
        ? topicLabel(existingTopicId)
        : "Untitled topic";

  return {
    title,
    existingTopicId,
    reasoning: typeof obj.reasoning === "string" ? obj.reasoning.trim() : "",
    prereqs,
    body: stripFences(obj.body),
  };
}

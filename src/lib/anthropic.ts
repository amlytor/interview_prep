import Anthropic from "@anthropic-ai/sdk";
import type { Question, Verdict, WhyMissedTag } from "../types";
import { WHY_MISSED_TAGS } from "../types";

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

function buildClient(apiKey: string): Anthropic {
  // This is a local, single-user app — the key never leaves the browser
  // except in requests directly to api.anthropic.com.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

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
  return `Question (${question.difficulty}, topics: ${question.topics.join(", ")}):
${question.prompt}

Canonical answer: ${question.canonicalAnswer}

Full worked explanation (for your reference when judging and writing feedback — do not just paste this back verbatim):
${question.explanation}

Candidate's answer:
${userAnswer || "(left blank)"}`;
}

function parseGradingResponse(raw: string): GradingResult {
  // Strip markdown code fences in case the model wraps the JSON despite instructions.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new GradingError(
      "Claude's response wasn't valid JSON, so it couldn't be graded automatically. Raw response:\n\n" + raw,
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new GradingError("Unexpected response shape from Claude.");
  }
  const obj = parsed as Record<string, unknown>;

  const verdict = obj.verdict;
  if (verdict !== "correct" && verdict !== "partial" && verdict !== "incorrect") {
    throw new GradingError("Unexpected verdict in Claude's response: " + JSON.stringify(obj.verdict));
  }

  const feedback = typeof obj.feedback === "string" ? obj.feedback : "";

  let whyMissed: WhyMissedTag | null = null;
  if (typeof obj.whyMissed === "string" && (WHY_MISSED_TAGS as string[]).includes(obj.whyMissed)) {
    whyMissed = obj.whyMissed as WhyMissedTag;
  }

  return { verdict, feedback, whyMissed };
}

function describeApiError(err: unknown, model: string): string {
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
  if (err instanceof Error) {
    return err.message;
  }
  return "Unknown error while contacting the Anthropic API.";
}

export async function gradeFreeTextAnswer(
  question: Question,
  userAnswer: string,
  apiKey: string,
  model: string,
): Promise<GradingResult> {
  if (!apiKey) {
    throw new GradingError("No Anthropic API key set. Add one in Settings before drilling free-text questions.");
  }

  const client = buildClient(apiKey);
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(question, userAnswer) }],
    });

    if (response.stop_reason === "refusal") {
      throw new GradingError("Claude declined to grade this response. Try rephrasing your answer and retry.");
    }

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new GradingError("Claude's response had no text content to grade.");
    }
    return parseGradingResponse(textBlock.text);
  } catch (err) {
    if (err instanceof GradingError) throw err;
    throw new GradingError(describeApiError(err, model), err);
  }
}

/** Minimal round-trip used by the Settings page "Test connection" button. */
export async function testConnection(apiKey: string, model: string): Promise<void> {
  if (!apiKey) {
    throw new GradingError("Enter an API key first.");
  }
  const client = buildClient(apiKey);
  try {
    await client.messages.create({
      model,
      max_tokens: 8,
      messages: [{ role: "user", content: "Reply with the single word OK." }],
    });
  } catch (err) {
    throw new GradingError(describeApiError(err, model), err);
  }
}

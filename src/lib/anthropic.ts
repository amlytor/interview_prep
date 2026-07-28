import Anthropic from "@anthropic-ai/sdk";
import type { Choice, Difficulty, Question, StudyNote, Verdict, WhyMissedTag } from "../types";
import { WHY_MISSED_TAGS } from "../types";
import { topicLabel } from "./topics";

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
  return `Question (${question.difficulty}, topics: ${question.topics.map(topicLabel).join(", ")}):
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

// ---------------------------------------------------------------------------
// AI content generation (quizzes from notes, note drafting)
// ---------------------------------------------------------------------------

/** A question ready to be staged: everything but the store-assigned id/createdAt. */
export type QuizDraft = Omit<Question, "id" | "createdAt">;

const CHOICE_IDS = ["a", "b", "c", "d", "e", "f"];

function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json|markdown|md)?/i, "")
    .replace(/```$/, "")
    .trim();
}

const QUIZ_SYSTEM_PROMPT = `You are an expert quant interview coach writing practice questions from a student's study note.

Produce a mix of:
(a) 2-3 simple recall/fact questions checking the note's key formulas, triggers, and pitfalls (difficulty "easy", a mix of multiple_choice and free_text), and
(b) 2-3 understanding/application questions that apply the technique to a NOVEL setup not appearing in the note or in the "existing questions" list (difficulty "medium" or "hard", mostly free_text).

Rules:
- Do NOT duplicate or trivially reword the existing questions you are shown.
- Every question must be self-contained and precisely worded, with a single defensible answer.
- canonicalAnswer is the short final answer; explanation is a complete worked solution teaching the technique.
- For multiple_choice: 4 plausible options, exactly one correct, correctOption is the 0-based index into options.

Respond with ONLY a JSON object — no markdown code fences, no prose — of exactly this shape:
{"questions": [{"topicId": "<the topic id you were given>", "difficulty": "easy" | "medium" | "hard", "type": "free_text" | "multiple_choice", "prompt": "...", "canonicalAnswer": "...", "explanation": "...", "options": ["..."], "correctOption": 0}]}
(options/correctOption only on multiple_choice questions.)`;

function validateQuizPayload(raw: string, note: StudyNote): QuizDraft[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    throw new GradingError(
      "Claude's quiz response wasn't valid JSON. Retry the generation.\n\nRaw response:\n" + raw,
    );
  }

  // Accept either {questions: [...]} or a bare array.
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).questions)
      ? ((parsed as Record<string, unknown>).questions as unknown[])
      : null;
  if (!list || list.length === 0) {
    throw new GradingError("Claude's quiz response had no questions array. Retry the generation.");
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
  apiKey: string,
  model: string,
): Promise<QuizDraft[]> {
  if (!apiKey) {
    throw new GradingError("No Anthropic API key set. Add one in Settings first.");
  }
  const client = buildClient(apiKey);

  const existing =
    existingPrompts.length > 0
      ? `Existing questions for this topic (do NOT duplicate these):\n${existingPrompts
          .map((p, i) => `${i + 1}. ${p}`)
          .join("\n")}`
      : "There are no existing questions for this topic yet.";

  const userPrompt = `Topic id: ${note.topicId}
Topic: ${topicLabel(note.topicId)}

Study note (markdown):
${note.body}

${existing}`;

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 3000,
      system: QUIZ_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });
    if (response.stop_reason === "refusal") {
      throw new GradingError("Claude declined to generate this quiz. Retry.");
    }
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new GradingError("Claude's response had no text content.");
    }
    return validateQuizPayload(textBlock.text, note);
  } catch (err) {
    if (err instanceof GradingError) throw err;
    throw new GradingError(describeApiError(err, model), err);
  }
}

const NOTE_SYSTEM_PROMPT = `You are an expert quant interview coach writing a study note for interview prep.

Write the note as markdown with exactly these sections, in this order:
## Core idea
## When to use (trigger)
## Key formulas  (use $...$ inline math and $$...$$ display math, LaTeX syntax)
## Worked example
## Common mistakes

Keep it tight and practical — interview-focused intuition, not a textbook chapter. Respond with ONLY the markdown note body: no preamble, no code fences, and do not include a top-level title heading (the app renders the title separately).`;

/**
 * Draft a new note body, or extend an existing one, for a topic. Returns
 * markdown only; the caller decides whether/how to apply it (authored notes
 * are never overwritten without explicit confirmation in the UI).
 */
export async function generateNoteMarkdown(
  topicTitle: string,
  currentBody: string | null,
  apiKey: string,
  model: string,
): Promise<string> {
  if (!apiKey) {
    throw new GradingError("No Anthropic API key set. Add one in Settings first.");
  }
  const client = buildClient(apiKey);

  const userPrompt = currentBody
    ? `Topic: ${topicTitle}

Here is the current note. Produce an improved, expanded version that keeps everything correct and useful from it (especially any personal reminders), deepens the weakest sections, and stays in the same section structure:

${currentBody}`
    : `Topic: ${topicTitle}

There is no note for this topic yet — write one from scratch.`;

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 2500,
      system: NOTE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });
    if (response.stop_reason === "refusal") {
      throw new GradingError("Claude declined to draft this note. Retry.");
    }
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new GradingError("Claude's response had no text content.");
    }
    const body = stripFences(textBlock.text);
    if (body.length < 40) {
      throw new GradingError("Claude returned an implausibly short note draft. Retry.");
    }
    return body;
  } catch (err) {
    if (err instanceof GradingError) throw err;
    throw new GradingError(describeApiError(err, model), err);
  }
}

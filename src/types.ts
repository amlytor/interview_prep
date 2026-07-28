import type { TopicId } from "./lib/topics";

export type Difficulty = "easy" | "medium" | "hard";

export type AnswerMode = "free-text" | "multiple-choice";

export interface Choice {
  id: string;
  text: string;
}

/** Automated well-formedness check run on generated questions before staging. */
export interface QuestionValidation {
  status: "clean" | "suspect";
  issues: string[]; // empty when clean
}

export interface Question {
  id: string;
  prompt: string;
  topics: TopicId[];
  difficulty: Difficulty;
  answerMode: AnswerMode;
  // Free-text questions always have a canonical answer + explanation.
  canonicalAnswer: string;
  explanation: string;
  // Only present when answerMode === "multiple-choice"
  choices?: Choice[];
  correctChoiceId?: string;
  createdAt: number;
  custom: boolean; // true if user-authored or AI-generated, false if seeded
  origin?: "seed" | "user" | "ai"; // where the question came from (v2)
  // --- v3 ---
  // True once the answer has been shown — revealed while reviewing a staged
  // question, or seen after answering it. Practice prefers unseen questions, so
  // a generated question isn't burned before you ever attempt it.
  answerSeen?: boolean;
  technique?: string; // the named method the question tests (generator-declared)
  difficultyRationale?: string; // why it sits at its claimed difficulty
  validation?: QuestionValidation;
}

export type Verdict = "correct" | "partial" | "incorrect";

// The miss-reason taxonomy. The first five keep their original v2 string values
// so existing attempts need no migration; "missing prerequisite knowledge" is
// the v3 addition, and is the only tag that carries recommended topics.
export type WhyMissedTag =
  | "didn't recognize technique"
  | "misread problem"
  | "knew technique but couldn't execute"
  | "arithmetic slip"
  | "ran out of time"
  | "missing prerequisite knowledge";

export const WHY_MISSED_TAGS: WhyMissedTag[] = [
  "didn't recognize technique",
  "misread problem",
  "knew technique but couldn't execute",
  "arithmetic slip",
  "ran out of time",
  "missing prerequisite knowledge",
];

export const MISSING_PREREQ_TAG: WhyMissedTag = "missing prerequisite knowledge";

/** Short, actionable advice shown alongside a tag on the dashboard. */
export const WHY_MISSED_ADVICE: Record<WhyMissedTag, string> = {
  "didn't recognize technique":
    "Pattern recognition, not ability. Re-read the 'when to use' section of the relevant notes and drill mixed topics so you practise choosing the method, not just applying it.",
  "misread problem":
    "Slow down on the setup. Restate the question in your own words before solving — in an interview, say it out loud.",
  "knew technique but couldn't execute":
    "The idea is there but the mechanics aren't automatic. Work the same technique several times in a row rather than moving on.",
  "arithmetic slip":
    "Technique is fine — this is care, not knowledge. Keep numbers symbolic as long as possible and sanity-check the magnitude at the end.",
  "ran out of time":
    "Get to a defensible approach faster. Say the framework first, then compute; a stated method beats a silent computation.",
  "missing prerequisite knowledge":
    "The gap is underneath this topic. Spend an hour on the prerequisite before grinding more questions here.",
};

/** One turn of the diagnostic chat. */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  at: number;
}

/**
 * The conclusion of a diagnostic chat about a missed question — the considered
 * root cause, as opposed to the grader's snap `whyMissed` guess.
 */
export interface MissDiagnosis {
  tag: WhyMissedTag;
  summary: string; // one line, AI-written, user-editable
  // Only meaningful for "missing prerequisite knowledge". Always validated
  // against the question's actual prerequisite closure before being stored.
  recommendedTopics: TopicId[];
  transcript: ChatTurn[];
  concludedAt: number;
  edited: boolean; // true once the user rewrites the summary
}

/** One-tap post-answer difficulty feedback. */
export type DifficultyRating = "too-easy" | "about-right" | "too-hard";

export const DIFFICULTY_RATINGS: DifficultyRating[] = ["too-easy", "about-right", "too-hard"];

export type AttemptSource = "drill" | "review" | "mock" | "learn";

export interface Attempt {
  id: string;
  questionId: string;
  timestamp: number;
  source: AttemptSource;
  answerMode: AnswerMode;
  userAnswer: string;
  verdict: Verdict;
  feedback?: string; // AI Socratic feedback / explanation
  // The grader's snap judgement at grading time. Kept separate from `diagnosis`
  // so a later chat never rewrites what the grader originally thought.
  whyMissed?: WhyMissedTag;
  timeSpentSec?: number;
  // --- v3 ---
  diagnosis?: MissDiagnosis; // set by the "why did I get this wrong?" chat
  difficultyRating?: DifficultyRating;
}

/** The authoritative miss reason: the chat's conclusion, else the grader's guess. */
export function missReason(attempt: Attempt): WhyMissedTag | null {
  return attempt.diagnosis?.tag ?? attempt.whyMissed ?? null;
}

// Spaced-repetition state, one entry per question that has ever been missed.
export interface SrsState {
  questionId: string;
  stage: number; // index into REVIEW_INTERVALS_DAYS; -1 means mastered/out of rotation
  nextReviewAt: number | null; // epoch ms; null = not currently scheduled
  lastResult: Verdict;
  updatedAt: number;
  // "Encompassing" credit trickled down from correct answers on dependent
  // (more advanced) topics. When it reaches 1.0 it is consumed as one passed
  // review, advancing the 2/7/21 ladder without a direct re-drill.
  trickleCredit: number;
}

// One study note per topic. Seeded from src/data/studyNotes.json, or created
// by the user ("user") for their own topics.
export interface StudyNote {
  topicId: TopicId;
  title: string;
  prereqs: TopicId[]; // the knowledge graph: direct prerequisite topic ids
  source: "authored" | "ai" | "user"; // authored notes are never overwritten without confirmation
  body: string; // markdown (with $...$ / $$...$$ LaTeX math)
  lastEdited: number | null; // epoch ms of the last in-app edit; null = untouched seed
  modified: boolean; // true once the user has edited the seeded body
}

/**
 * The kinds of work sent to a model. They have genuinely different needs:
 * grading and chat run constantly and only have to compare an answer against a
 * rubric that's already in the prompt, so they want cheap and fast; generation
 * and validation run rarely but must actually solve the problem correctly, and
 * a wrong answer there persists in the question bank.
 */
export type AiTask = "grading" | "generation" | "validation" | "chat";

export const AI_TASKS: AiTask[] = ["grading", "generation", "validation", "chat"];

export const AI_TASK_LABELS: Record<AiTask, string> = {
  grading: "Grading answers",
  generation: "Generating questions & notes",
  validation: "Checking generated questions",
  chat: "Diagnostic chat",
};

export const AI_TASK_HINTS: Record<AiTask, string> = {
  grading:
    "Runs on every free-text answer, and you wait on it. The canonical answer is already in the prompt, so this is a comparison job — a fast, cheap chat model is the right fit, not a reasoning one.",
  generation:
    "Runs rarely, and has to invent a question and solve it correctly. A wrong answer here sits in your bank permanently, so this is where a stronger (or reasoning) model actually pays.",
  validation:
    "The pass that lets you bank questions unseen. Worth pointing at a DIFFERENT model from generation — a second opinion catches far more than a model reviewing its own work.",
  chat: "Several calls per diagnosis. Same reasoning as grading: fast and cheap beats deep.",
};

export interface Settings {
  provider: string; // id from lib/providers.ts
  model: string;
  // One key per provider, so switching back and forth doesn't lose them.
  apiKeys: Record<string, string>;
  // Per-provider base-URL overrides (regional endpoints, self-hosted gateways).
  baseUrls: Record<string, string>;
  // Optional per-task model overrides, keyed by provider then task. Kept
  // per-provider for the same reason keys are: a model id is meaningless on a
  // different provider, and silently sending one would just fail.
  taskModels: Record<string, Partial<Record<AiTask, string>>>;
  spendNote: string; // free-text reminder the user sets for themselves
  // Attempts needed on a calendar day for it to count toward the daily streak.
  dailyGoal: number;
  /** @deprecated v2 field — migrated into apiKeys.anthropic on load. */
  apiKey?: string;
}

export interface AppData {
  version: number;
  questions: Question[];
  attempts: Attempt[];
  srs: SrsState[];
  settings: Settings;
  studyNotes: StudyNote[];
  // AI-generated questions awaiting user approval. They only enter the live
  // bank (and the mastery signal) once explicitly approved.
  stagedQuestions: Question[];
  // User-created topics, on top of the 24 seeded ones. Each has exactly one
  // study note, same as a seeded topic, so the whole knowledge tree / mastery
  // / Learn-mode machinery works on them unchanged.
  customTopics: { id: TopicId; label: string }[];
}

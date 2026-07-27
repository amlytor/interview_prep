import type { Topic } from "./lib/topics";

export type Difficulty = "easy" | "medium" | "hard";

export type AnswerMode = "free-text" | "multiple-choice";

export interface Choice {
  id: string;
  text: string;
}

export interface Question {
  id: string;
  prompt: string;
  topics: Topic[];
  difficulty: Difficulty;
  answerMode: AnswerMode;
  // Free-text questions always have a canonical answer + explanation.
  canonicalAnswer: string;
  explanation: string;
  // Only present when answerMode === "multiple-choice"
  choices?: Choice[];
  correctChoiceId?: string;
  createdAt: number;
  custom: boolean; // true if user-authored, false if seeded starter question
}

export type Verdict = "correct" | "partial" | "incorrect";

export type WhyMissedTag =
  | "didn't recognize technique"
  | "misread problem"
  | "knew technique but couldn't execute"
  | "arithmetic slip"
  | "ran out of time";

export const WHY_MISSED_TAGS: WhyMissedTag[] = [
  "didn't recognize technique",
  "misread problem",
  "knew technique but couldn't execute",
  "arithmetic slip",
  "ran out of time",
];

export type AttemptSource = "drill" | "review" | "mock";

export interface Attempt {
  id: string;
  questionId: string;
  timestamp: number;
  source: AttemptSource;
  answerMode: AnswerMode;
  userAnswer: string;
  verdict: Verdict;
  feedback?: string; // AI Socratic feedback / explanation
  whyMissed?: WhyMissedTag;
  timeSpentSec?: number;
}

// Spaced-repetition state, one entry per question that has ever been missed.
export interface SrsState {
  questionId: string;
  stage: number; // index into REVIEW_INTERVALS_DAYS; -1 means mastered/out of rotation
  nextReviewAt: number | null; // epoch ms; null = not currently scheduled
  lastResult: Verdict;
  updatedAt: number;
}

export interface Settings {
  apiKey: string;
  model: string;
  spendNote: string; // free-text reminder the user sets for themselves
}

export interface AppData {
  version: number;
  questions: Question[];
  attempts: Attempt[];
  srs: SrsState[];
  settings: Settings;
}

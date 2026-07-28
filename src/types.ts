import type { TopicId } from "./lib/topics";

export type Difficulty = "easy" | "medium" | "hard";

export type AnswerMode = "free-text" | "multiple-choice";

export interface Choice {
  id: string;
  text: string;
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
  // "Encompassing" credit trickled down from correct answers on dependent
  // (more advanced) topics. When it reaches 1.0 it is consumed as one passed
  // review, advancing the 2/7/21 ladder without a direct re-drill.
  trickleCredit: number;
}

// One study note per topic. Seeded from src/data/studyNotes.json.
export interface StudyNote {
  topicId: TopicId;
  title: string;
  prereqs: TopicId[]; // the knowledge graph: direct prerequisite topic ids
  source: "authored" | "ai"; // authored notes are never overwritten without confirmation
  body: string; // markdown (with $...$ / $$...$$ LaTeX math)
  lastEdited: number | null; // epoch ms of the last in-app edit; null = untouched seed
  modified: boolean; // true once the user has edited the seeded body
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
  studyNotes: StudyNote[];
  // AI-generated questions awaiting user approval. They only enter the live
  // bank (and the mastery signal) once explicitly approved.
  stagedQuestions: Question[];
}

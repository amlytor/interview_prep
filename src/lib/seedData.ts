// Import adapter for the two human-authored seed files in src/data/.
// Those JSON files are the source of truth for initial content — this module
// only converts their shape into the app's internal types; it never edits
// their substance.
import rawNotes from "../data/studyNotes.json";
import rawQuestions from "../data/seedQuestions.json";
import type { Question, StudyNote, Difficulty } from "../types";
import type { TopicId } from "./topics";
import { isTopicId } from "./topics";

// ---------- Raw file shapes (as authored in src/data/*.json) ----------

interface RawNote {
  topicId: string;
  title: string;
  prereqs: string[];
  source: string;
  body: string;
}

interface RawQuestion {
  topicId: string;
  difficulty: string;
  type: string; // "free_text" | "multiple_choice"
  prompt: string;
  canonicalAnswer?: string;
  explanation: string;
  options?: string[];
  correctOption?: number;
}

// One approved amendment to the authored prerequisite graph: the
// without-replacement shortcut's own intuition section argues via symmetry
// ("k successes split the items into k+1 equal gaps"), so
// symmetry-condition-first was added as a prerequisite alongside the
// authored enumerate-scenarios edge.
const EXTRA_PREREQS: Partial<Record<TopicId, TopicId[]>> = {
  "without-replacement-shortcut": ["symmetry-condition-first"],
};

function asTopicId(value: string, context: string): TopicId {
  if (!isTopicId(value)) {
    // A typo in the seed files should fail loudly at startup, not corrupt data.
    throw new Error(`Unknown topic id "${value}" in ${context}`);
  }
  return value;
}

/** All 19 study notes from studyNotes.json, verbatim plus approved graph edits. */
export function seedStudyNotes(): StudyNote[] {
  return (rawNotes.notes as RawNote[]).map((n) => {
    const topicId = asTopicId(n.topicId, "studyNotes.json");
    const prereqs = n.prereqs.map((p) => asTopicId(p, `prereqs of ${n.topicId}`));
    for (const extra of EXTRA_PREREQS[topicId] ?? []) {
      if (!prereqs.includes(extra)) prereqs.push(extra);
    }
    return {
      topicId,
      title: n.title,
      prereqs,
      source: n.source === "ai" ? "ai" : "authored",
      body: n.body,
      lastEdited: null,
      modified: false,
    };
  });
}

const CHOICE_IDS = ["a", "b", "c", "d", "e", "f"];

/**
 * The 35 questions from seedQuestions.json, adapted to the internal Question
 * shape. Ids are deterministic (sq-<topic>-<n>) so migrations and re-imports
 * never duplicate them.
 */
export function seedQuestionBank(): Question[] {
  const counters = new Map<string, number>();
  const createdAt = Date.now();

  return (rawQuestions.questions as RawQuestion[]).map((q) => {
    const topicId = asTopicId(q.topicId, "seedQuestions.json");
    const n = (counters.get(topicId) ?? 0) + 1;
    counters.set(topicId, n);

    const base: Question = {
      id: `sq-${topicId}-${n}`,
      prompt: q.prompt,
      topics: [topicId],
      difficulty: (["easy", "medium", "hard"].includes(q.difficulty) ? q.difficulty : "medium") as Difficulty,
      answerMode: q.type === "multiple_choice" ? "multiple-choice" : "free-text",
      canonicalAnswer: q.canonicalAnswer ?? "",
      explanation: q.explanation,
      createdAt,
      custom: false,
      origin: "seed",
    };

    if (q.type === "multiple_choice" && q.options && q.correctOption !== undefined) {
      base.choices = q.options.map((text, i) => ({ id: CHOICE_IDS[i], text }));
      base.correctChoiceId = CHOICE_IDS[q.correctOption];
      // MC questions grade locally; keep canonicalAnswer filled for the debrief view.
      if (!base.canonicalAnswer) base.canonicalAnswer = q.options[q.correctOption];
    }

    return base;
  });
}

// v1 seed questions superseded by near-identical entries in seedQuestions.json
// (same problem, the new file's version preferred). Their attempt history is
// kept; the questions themselves are removed from the bank on migration.
export const DROPPED_V1_SEED_IDS = new Set<string>([
  "seed-1", // coin until first heads (E = 2)
  "seed-7", // random hats, expected own-hat matches
  "seed-12", // birthday problem, 30 people
  "seed-15", // coupon collector with 6 types
  "seed-16", // expected flips to HH
  "seed-18", // two burning ropes, 45 minutes
]);
// Note: seed-17 (exactly 2 heads in 3 flips) is a near-dupe of a new
// combinatorics question but is deliberately KEPT — it is the only question
// tagged enumerate-scenarios, and dropping it would leave that topic empty.

// Topic tags of dropped questions, so their historical attempts still count
// toward topic mastery even though the questions are gone from the bank.
export const DROPPED_V1_QUESTION_TOPICS: Record<string, TopicId[]> = {
  "seed-1": ["geometric-distribution"],
  "seed-7": ["linearity-of-expectation"],
  "seed-12": ["complementary-counting"],
  "seed-15": ["coupon-collector"],
  "seed-16": ["recursive-states"],
  "seed-18": ["out-of-the-box"],
};

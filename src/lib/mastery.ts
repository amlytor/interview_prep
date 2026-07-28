// Per-topic mastery model. Mastery is always DERIVED from attempt history at
// render time — never stored — so it can't drift, and it round-trips through
// export/import for free.
//
// score = 100 × recency-weighted accuracy × confidence
//   - accuracy: attempts newest-first, weight 0.85^i, correct=1 partial=0.5
//   - confidence: min(1, n/5) — few attempts cap the score
// Mastered:   score >= 80 with >= 5 attempts (the "gold ring")
// Proficient: score >= 60 with >= 3 attempts (unlocks dependent topics)
import type { Attempt, Question, StudyNote } from "../types";
import type { TopicId } from "./topics";
import { topicLabel } from "./topics";
import { DROPPED_V1_QUESTION_TOPICS } from "./seedData";

export const RECENCY_DECAY = 0.85;
export const ATTEMPT_WINDOW = 20; // only the most recent N attempts count
export const CONFIDENCE_FULL_AT = 5; // attempts needed for full confidence
export const MASTERED_SCORE = 80;
export const MASTERED_MIN_ATTEMPTS = 5;
export const PROFICIENT_SCORE = 60;
export const PROFICIENT_MIN_ATTEMPTS = 3;

export interface TopicMastery {
  topicId: TopicId;
  score: number; // 0-100
  attempts: number; // total attempts on this topic (before windowing)
  mastered: boolean;
  proficient: boolean;
}

const VERDICT_VALUE = { correct: 1, partial: 0.5, incorrect: 0 } as const;

/**
 * Topic tags for a question id, including "tombstone" lookups for v1 seed
 * questions that were dropped in the v2 migration — their historical attempts
 * still count toward mastery.
 */
export function topicsForQuestion(
  questionId: string,
  questionsById: Map<string, Question>,
): TopicId[] {
  const q = questionsById.get(questionId);
  if (q) return q.topics;
  return DROPPED_V1_QUESTION_TOPICS[questionId] ?? [];
}

export function computeAllMastery(
  questions: Question[],
  attempts: Attempt[],
): Map<TopicId, TopicMastery> {
  const questionsById = new Map(questions.map((q) => [q.id, q]));

  // Bucket attempts by topic, newest first.
  const byTopic = new Map<TopicId, Attempt[]>();
  const sorted = [...attempts].sort((a, b) => b.timestamp - a.timestamp);
  for (const a of sorted) {
    for (const t of topicsForQuestion(a.questionId, questionsById)) {
      const list = byTopic.get(t) ?? [];
      list.push(a);
      byTopic.set(t, list);
    }
  }

  const result = new Map<TopicId, TopicMastery>();
  for (const [topicId, topicAttempts] of byTopic) {
    const n = topicAttempts.length;
    const window = topicAttempts.slice(0, ATTEMPT_WINDOW);

    let weightedSum = 0;
    let weightTotal = 0;
    window.forEach((a, i) => {
      const w = Math.pow(RECENCY_DECAY, i); // i=0 is the newest attempt
      weightedSum += w * VERDICT_VALUE[a.verdict];
      weightTotal += w;
    });
    const accuracy = weightTotal > 0 ? weightedSum / weightTotal : 0;
    const confidence = Math.min(1, n / CONFIDENCE_FULL_AT);
    const score = Math.round(100 * accuracy * confidence);

    result.set(topicId, {
      topicId,
      score,
      attempts: n,
      mastered: score >= MASTERED_SCORE && n >= MASTERED_MIN_ATTEMPTS,
      proficient: score >= PROFICIENT_SCORE && n >= PROFICIENT_MIN_ATTEMPTS,
    });
  }
  return result;
}

function emptyMastery(topicId: TopicId): TopicMastery {
  return { topicId, score: 0, attempts: 0, mastered: false, proficient: false };
}

export function masteryFor(topicId: TopicId, mastery: Map<TopicId, TopicMastery>): TopicMastery {
  return mastery.get(topicId) ?? emptyMastery(topicId);
}

/**
 * A topic is unlocked when every direct prerequisite is proficient. A prereq
 * with zero questions in the bank can't be practised yet, so it never blocks
 * unlocking (generate a quiz for it to give it real coverage).
 */
export function isUnlocked(
  topicId: TopicId,
  notesById: Map<TopicId, StudyNote>,
  mastery: Map<TopicId, TopicMastery>,
  topicsWithQuestions: Set<TopicId>,
): boolean {
  const note = notesById.get(topicId);
  if (!note || note.prereqs.length === 0) return true;
  return note.prereqs.every(
    (p) => masteryFor(p, mastery).proficient || !topicsWithQuestions.has(p),
  );
}

/** Names of the prereqs currently blocking a locked topic (for the UI). */
export function blockingPrereqs(
  topicId: TopicId,
  notesById: Map<TopicId, StudyNote>,
  mastery: Map<TopicId, TopicMastery>,
  topicsWithQuestions: Set<TopicId>,
): string[] {
  const note = notesById.get(topicId);
  if (!note) return [];
  return note.prereqs
    .filter((p) => !masteryFor(p, mastery).proficient && topicsWithQuestions.has(p))
    .map((p) => topicLabel(p));
}

/**
 * Every topic upstream of `topicIds` in the prerequisite DAG, transitively.
 *
 * This is what constrains the diagnostic chat: the model may only name a
 * "missing prerequisite" from inside this set, so it can't invent a topic or
 * point at something that isn't actually upstream. Every id in here is
 * guaranteed to have a study note, and therefore a Learn mode to click into.
 */
export function prereqClosure(topicIds: TopicId[], notes: StudyNote[]): TopicId[] {
  const notesById = new Map(notes.map((n) => [n.topicId, n]));
  const seen = new Set<TopicId>();
  const queue = [...topicIds];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const prereq of notesById.get(current)?.prereqs ?? []) {
      // The seen-set doubles as the cycle guard.
      if (seen.has(prereq)) continue;
      seen.add(prereq);
      queue.push(prereq);
    }
  }
  // A topic is never its own prerequisite, even via a malformed cycle.
  for (const t of topicIds) seen.delete(t);
  return Array.from(seen);
}

/** Set of topic ids that have at least one question in the live bank. */
export function topicsWithQuestionsSet(questions: Question[]): Set<TopicId> {
  const set = new Set<TopicId>();
  for (const q of questions) for (const t of q.topics) set.add(t);
  return set;
}

/**
 * Depth of each topic in the prerequisite DAG (longest path from a root).
 * Used to lay the knowledge tree out in tiers. The seed graph is validated
 * acyclic; the visited set guards against a cycle introduced by bad data.
 */
export function topicDepths(notes: StudyNote[]): Map<TopicId, number> {
  const notesById = new Map(notes.map((n) => [n.topicId, n]));
  const depths = new Map<TopicId, number>();

  function depthOf(id: TopicId, visiting: Set<TopicId>): number {
    const cached = depths.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // cycle guard
    visiting.add(id);
    const note = notesById.get(id);
    const d =
      !note || note.prereqs.length === 0
        ? 0
        : 1 + Math.max(...note.prereqs.map((p) => depthOf(p, visiting)));
    visiting.delete(id);
    depths.set(id, d);
    return d;
  }

  for (const n of notes) depthOf(n.topicId, new Set());
  return depths;
}

/**
 * "Next topic to study": the knowledge frontier — unlocked, not yet mastered.
 * Foundations first (shallowest tier), then lowest score.
 */
export function recommendNextTopic(
  notes: StudyNote[],
  questions: Question[],
  attempts: Attempt[],
): TopicId | null {
  const mastery = computeAllMastery(questions, attempts);
  const notesById = new Map(notes.map((n) => [n.topicId, n]));
  const withQuestions = topicsWithQuestionsSet(questions);
  const depths = topicDepths(notes);

  const candidates = notes
    .map((n) => n.topicId)
    .filter(
      (id) =>
        !masteryFor(id, mastery).mastered &&
        isUnlocked(id, notesById, mastery, withQuestions),
    )
    .sort((a, b) => {
      const da = depths.get(a) ?? 0;
      const db = depths.get(b) ?? 0;
      if (da !== db) return da - db;
      return masteryFor(a, mastery).score - masteryFor(b, mastery).score;
    });

  return candidates[0] ?? null;
}

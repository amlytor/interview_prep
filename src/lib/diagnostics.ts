// "Why I'm getting things wrong" — turning miss reasons into a pattern, and a
// pattern into a recommendation to go study something specific.
//
// The whole point is to catch when the real problem sits UNDERNEATH what you're
// drilling, so you spend an hour building the mental model there instead of
// grinding questions you aren't ready for.
import type { Attempt, Question, StudyNote, WhyMissedTag } from "../types";
import { WHY_MISSED_ADVICE, WHY_MISSED_TAGS, missReason } from "../types";
import type { TopicId } from "./topics";
import { topicLabel } from "./topics";
import { computeAllMastery, masteryFor, topicsForQuestion, PROFICIENT_SCORE } from "./mastery";
import { computeTopicStats } from "./stats";

// Thresholds live here so they're tunable in one place rather than buried in
// the render. All of them are deliberately conservative: a recommendation you
// don't trust is worse than no recommendation.
export const PREREQ_WINDOW = 20; // recent tagged misses scanned for a prereq cluster
export const PREREQ_MIN_HITS = 3; // times a topic must recur to be called a pattern
export const REASON_WINDOW = 10; // recent tagged misses scanned for a reason cluster
export const REASON_MIN_HITS = 4;
export const REASON_MIN_SHARE = 0.4;
export const WEAK_TOPIC_MIN_ATTEMPTS = 4;
export const WEAK_TOPIC_MAX_HIT_RATE = 0.5;
export const MAX_RECOMMENDATIONS = 3;

export interface ReasonCount {
  tag: WhyMissedTag;
  count: number;
  share: number; // of all tagged misses in scope
}

export interface ReasonBreakdown {
  counts: ReasonCount[];
  taggedMisses: number;
  untaggedMisses: number;
}

/** True for any attempt that wasn't a clean pass. */
function isMiss(a: Attempt): boolean {
  return a.verdict !== "correct";
}

/**
 * Pivot miss reasons, optionally scoped to one topic. Uses the chat's
 * conclusion where there is one, else the grader's snap tag.
 */
export function computeReasonBreakdown(
  questions: Question[],
  attempts: Attempt[],
  topicFilter: TopicId | null = null,
): ReasonBreakdown {
  const byId = new Map(questions.map((q) => [q.id, q]));

  const misses = attempts.filter((a) => {
    if (!isMiss(a)) return false;
    if (!topicFilter) return true;
    return topicsForQuestion(a.questionId, byId).includes(topicFilter);
  });

  const tallies = new Map<WhyMissedTag, number>();
  let untagged = 0;
  for (const a of misses) {
    const reason = missReason(a);
    if (reason) tallies.set(reason, (tallies.get(reason) ?? 0) + 1);
    else untagged += 1;
  }

  const tagged = misses.length - untagged;
  const counts = WHY_MISSED_TAGS.filter((t) => (tallies.get(t) ?? 0) > 0)
    .map((tag) => ({
      tag,
      count: tallies.get(tag)!,
      share: tagged > 0 ? tallies.get(tag)! / tagged : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return { counts, taggedMisses: tagged, untaggedMisses: untagged };
}

export type RecommendationKind = "prereq-cluster" | "topic-vs-prereq" | "reason-cluster";

export interface Recommendation {
  kind: RecommendationKind;
  headline: string;
  detail: string;
  /** The topic to go study, when there is a specific one. */
  topicId: TopicId | null;
}

/**
 * Actionable "study this next" suggestions, strongest first.
 *
 * R1 · prereq cluster   — your own diagnoses keep naming the same upstream topic.
 * R2 · topic vs prereq  — you're grinding a topic whose prerequisite isn't solid.
 *                         Runs off mastery + the graph alone, so it fires even
 *                         if you never open the diagnostic chat.
 * R3 · reason cluster   — one failure mode dominates, regardless of topic.
 *
 * R1 beats R2 beats R3: a specific named prerequisite you diagnosed yourself is
 * better evidence than an inference, which is better than generic advice.
 */
export function computeRecommendations(
  questions: Question[],
  attempts: Attempt[],
  notes: StudyNote[],
): Recommendation[] {
  const recommendations: Recommendation[] = [];

  const taggedMisses = attempts
    .filter((a) => isMiss(a) && missReason(a) !== null)
    .sort((a, b) => b.timestamp - a.timestamp);

  // --- R1: the same prerequisite keeps coming up in your own diagnoses -------
  const prereqWindow = taggedMisses.slice(0, PREREQ_WINDOW);
  const prereqHits = new Map<TopicId, number>();
  for (const a of prereqWindow) {
    for (const t of a.diagnosis?.recommendedTopics ?? []) {
      prereqHits.set(t, (prereqHits.get(t) ?? 0) + 1);
    }
  }
  const topPrereqs = Array.from(prereqHits.entries())
    .filter(([, n]) => n >= PREREQ_MIN_HITS)
    .sort((a, b) => b[1] - a[1]);

  for (const [topicId, hits] of topPrereqs) {
    recommendations.push({
      kind: "prereq-cluster",
      headline: `${hits} of your last ${prereqWindow.length} diagnosed misses point at ${topicLabel(topicId)}`,
      detail: `That's a pattern, not bad luck. An hour on ${topicLabel(topicId)} will do more than another round of questions that depend on it.`,
      topicId,
    });
  }

  // --- R2: grinding a topic whose prerequisite isn't solid -------------------
  const mastery = computeAllMastery(questions, attempts);
  const topicStats = computeTopicStats(questions, attempts);
  const notesById = new Map(notes.map((n) => [n.topicId, n]));

  for (const stat of topicStats) {
    if (stat.attempts < WEAK_TOPIC_MIN_ATTEMPTS || stat.hitRate > WEAK_TOPIC_MAX_HIT_RATE) continue;
    const note = notesById.get(stat.topic);
    if (!note) continue;

    // The weakest direct prerequisite that isn't yet proficient.
    const shaky = note.prereqs
      .map((p) => ({ id: p, score: masteryFor(p, mastery).score }))
      .filter((p) => p.score < PROFICIENT_SCORE)
      .sort((a, b) => a.score - b.score)[0];
    if (!shaky) continue;

    // Don't repeat a topic R1 already named.
    if (recommendations.some((r) => r.topicId === shaky.id)) continue;

    recommendations.push({
      kind: "topic-vs-prereq",
      headline: `You're at ${Math.round(stat.hitRate * 100)}% on ${topicLabel(stat.topic)}, but ${topicLabel(shaky.id)} underneath it is at ${shaky.score}/100`,
      detail: `${topicLabel(stat.topic)} builds directly on ${topicLabel(shaky.id)}. Dropping down is likely faster than pushing on.`,
      topicId: shaky.id,
    });
  }

  // --- R3: one failure mode dominates ---------------------------------------
  const reasonWindow = taggedMisses.slice(0, REASON_WINDOW);
  if (reasonWindow.length >= REASON_MIN_HITS) {
    const tallies = new Map<WhyMissedTag, number>();
    for (const a of reasonWindow) {
      const r = missReason(a)!;
      tallies.set(r, (tallies.get(r) ?? 0) + 1);
    }
    const [tag, count] = Array.from(tallies.entries()).sort((a, b) => b[1] - a[1])[0];
    if (count >= REASON_MIN_HITS && count / reasonWindow.length >= REASON_MIN_SHARE) {
      recommendations.push({
        kind: "reason-cluster",
        headline: `${count} of your last ${reasonWindow.length} misses were "${tag}"`,
        detail: WHY_MISSED_ADVICE[tag],
        topicId: null,
      });
    }
  }

  return recommendations.slice(0, MAX_RECOMMENDATIONS);
}

// Choosing which questions to serve.
//
// Centralised because "prefer unseen" has to hold everywhere practice is
// served — Drill, Mock, and Learn all used to roll their own selection, which
// is exactly how a rule like this rots. (Review is exempt: it serves whatever
// the spaced-repetition schedule says is due, by definition already seen.)
import type { Attempt, Question } from "../types";

/**
 * A question is "fresh" when its answer hasn't been revealed and it has never
 * been attempted. Those are worth the most as practice, so they go first.
 */
function isFresh(q: Question, attemptedIds: Set<string>): boolean {
  return !q.answerSeen && !attemptedIds.has(q.id);
}

export function attemptedIdSet(attempts: Attempt[]): Set<string> {
  return new Set(attempts.map((a) => a.questionId));
}

/**
 * Order a pool for practice: unseen-and-unattempted first (shuffled among
 * themselves so it isn't the same order every session), then everything else
 * by least-recently-attempted.
 */
export function orderForPractice(pool: Question[], attempts: Attempt[]): Question[] {
  const attemptedIds = attemptedIdSet(attempts);

  const lastSeen = new Map<string, number>();
  for (const a of attempts) {
    lastSeen.set(a.questionId, Math.max(lastSeen.get(a.questionId) ?? 0, a.timestamp));
  }

  const fresh: Question[] = [];
  const rest: Question[] = [];
  for (const q of pool) (isFresh(q, attemptedIds) ? fresh : rest).push(q);

  shuffleInPlace(fresh);
  rest.sort((a, b) => (lastSeen.get(a.id) ?? 0) - (lastSeen.get(b.id) ?? 0));

  return [...fresh, ...rest];
}

/**
 * Pick one question for practice, preferring fresh ones. `excludeId` avoids
 * serving the same question twice in a row when the pool allows it.
 */
export function pickPractice(
  pool: Question[],
  attempts: Attempt[],
  excludeId: string | null,
): Question | null {
  if (pool.length === 0) return null;
  const candidates = pool.length > 1 ? pool.filter((q) => q.id !== excludeId) : pool;
  if (candidates.length === 0) return null;

  const ordered = orderForPractice(candidates, attempts);
  const attemptedIds = attemptedIdSet(attempts);
  const freshCount = ordered.filter((q) => isFresh(q, attemptedIds)).length;

  // Random among the fresh ones if there are any, so drilling doesn't march
  // through the bank in a fixed order; otherwise fall back to the staleest.
  if (freshCount > 0) return ordered[Math.floor(Math.random() * freshCount)];
  return ordered[0];
}

export function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

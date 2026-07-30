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

/** easy before medium before hard, so first exposure to a topic ramps. */
const DIFFICULTY_RANK: Record<string, number> = { easy: 0, medium: 1, hard: 2 };

function rank(q: Question): number {
  return DIFFICULTY_RANK[q.difficulty] ?? 1;
}

/**
 * Order a pool for practice: unseen-and-unattempted first, then everything else
 * by least-recently-attempted.
 *
 * Fresh questions are ordered EASY FIRST, shuffled only within a difficulty
 * band. Without this, someone meeting a topic for the first time could be
 * handed its hardest question — Ito's lemma as your opening move in stochastic
 * calculus is a wall, not a ramp. Shuffling within the band keeps sessions from
 * being identical while preserving the ramp.
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
  // Stable sort after shuffling: bands stay in easy → medium → hard order while
  // membership within each band stays randomised.
  fresh.sort((a, b) => rank(a) - rank(b));
  rest.sort((a, b) => (lastSeen.get(a.id) ?? 0) - (lastSeen.get(b.id) ?? 0));

  return [...fresh, ...rest];
}

/**
 * Pick one question for practice, preferring fresh ones. `excludeId` avoids
 * serving the same question twice in a row when the pool allows it.
 *
 * Among fresh questions the choice is random within the EASIEST band available,
 * so a topic is worked through easy → medium → hard rather than at random. Once
 * nothing fresh is left it falls back to the least-recently-attempted.
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
  const fresh = ordered.filter((q) => isFresh(q, attemptedIds));

  if (fresh.length > 0) {
    // orderForPractice has already banded them, so the easiest band is the run
    // of leading questions sharing the first one's difficulty.
    const easiest = rank(fresh[0]);
    const band = fresh.filter((q) => rank(q) === easiest);
    return band[Math.floor(Math.random() * band.length)];
  }
  return ordered[0];
}

export function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

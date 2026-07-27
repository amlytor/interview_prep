import type { SrsState, Verdict } from "../types";

// A wrong question resurfaces in 2 days, then 7, then 21 if passed each time.
// After passing the 21-day review, the question is considered mastered and
// drops out of the review rotation (stage = -1, nextReviewAt = null).
export const REVIEW_INTERVALS_DAYS = [2, 7, 21];

const DAY_MS = 24 * 60 * 60 * 1000;

function daysFromNow(days: number): number {
  return Date.now() + days * DAY_MS;
}

/**
 * Compute the next SRS state for a question given its previous state (if any)
 * and the verdict of the attempt that was just recorded. "partial" is treated
 * like "incorrect" for scheduling — it means the technique isn't solid yet.
 */
export function scheduleAfterAttempt(
  questionId: string,
  prev: SrsState | undefined,
  verdict: Verdict,
): SrsState {
  const now = Date.now();
  const passed = verdict === "correct";

  if (!passed) {
    // Wrong (or partial): (re)start the review ladder at stage 0 → due in 2 days.
    return {
      questionId,
      stage: 0,
      nextReviewAt: daysFromNow(REVIEW_INTERVALS_DAYS[0]),
      lastResult: verdict,
      updatedAt: now,
    };
  }

  // Passed. If this question was never in the review rotation, a correct
  // first-pass answer doesn't need scheduling at all.
  if (!prev || prev.stage < 0) {
    return {
      questionId,
      stage: -1,
      nextReviewAt: null,
      lastResult: verdict,
      updatedAt: now,
    };
  }

  const nextStage = prev.stage + 1;
  if (nextStage >= REVIEW_INTERVALS_DAYS.length) {
    // Passed the final (21-day) review — mastered, out of rotation.
    return {
      questionId,
      stage: -1,
      nextReviewAt: null,
      lastResult: verdict,
      updatedAt: now,
    };
  }

  return {
    questionId,
    stage: nextStage,
    nextReviewAt: daysFromNow(REVIEW_INTERVALS_DAYS[nextStage]),
    lastResult: verdict,
    updatedAt: now,
  };
}

export function isDue(state: SrsState | undefined): boolean {
  if (!state || state.nextReviewAt === null) return false;
  return state.nextReviewAt <= Date.now();
}

export function dueCount(srs: SrsState[]): number {
  return srs.filter(isDue).length;
}

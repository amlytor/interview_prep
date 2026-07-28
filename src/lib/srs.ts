import type { SrsState, Verdict } from "../types";

// A wrong question resurfaces in 2 days, then 7, then 21 if passed each time.
// After passing the 21-day review, the question is considered mastered and
// drops out of the review rotation (stage = -1, nextReviewAt = null).
export const REVIEW_INTERVALS_DAYS = [2, 7, 21];

// "Encompassing" credit: a correct answer on a question whose topic DEPENDS on
// this question's topic counts as half a review of it. Two such answers (1.0
// credit) are consumed as one passed review, advancing the ladder without a
// direct re-drill — practising gambler's ruin implicitly exercises
// recursive-states, so you don't have to review the basics separately.
export const TRICKLE_CREDIT_PER_CORRECT = 0.5;

const DAY_MS = 24 * 60 * 60 * 1000;

function daysFromNow(days: number): number {
  return Date.now() + days * DAY_MS;
}

/** Advance a scheduled entry one rung up the 2/7/21 ladder (a passed review). */
function advanceAfterPass(prev: SrsState): SrsState {
  const now = Date.now();
  const nextStage = prev.stage + 1;
  if (nextStage >= REVIEW_INTERVALS_DAYS.length) {
    // Passed the final (21-day) review — mastered, out of rotation.
    return { ...prev, stage: -1, nextReviewAt: null, lastResult: "correct", updatedAt: now };
  }
  return {
    ...prev,
    stage: nextStage,
    nextReviewAt: daysFromNow(REVIEW_INTERVALS_DAYS[nextStage]),
    lastResult: "correct",
    updatedAt: now,
  };
}

/**
 * Compute the next SRS state for a question given its previous state (if any)
 * and the verdict of the attempt that was just recorded. "partial" is treated
 * like "incorrect" for scheduling — it means the technique isn't solid yet.
 * A direct attempt always resets any accumulated trickle credit.
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
      trickleCredit: 0,
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
      trickleCredit: 0,
    };
  }

  return { ...advanceAfterPass(prev), trickleCredit: 0 };
}

/**
 * Add trickle-down review credit to a prerequisite-topic question's schedule.
 * Only meaningful for entries that are actively scheduled; when accumulated
 * credit reaches 1.0 it is consumed as one passed review.
 */
export function applyTrickleCredit(state: SrsState): SrsState {
  if (state.nextReviewAt === null) return state; // not in rotation — nothing to credit
  const credit = (state.trickleCredit ?? 0) + TRICKLE_CREDIT_PER_CORRECT;
  if (credit < 1) {
    return { ...state, trickleCredit: credit, updatedAt: Date.now() };
  }
  return { ...advanceAfterPass(state), trickleCredit: credit - 1 };
}

export function isDue(state: SrsState | undefined): boolean {
  if (!state || state.nextReviewAt === null) return false;
  return state.nextReviewAt <= Date.now();
}

export function dueCount(srs: SrsState[]): number {
  return srs.filter(isDue).length;
}

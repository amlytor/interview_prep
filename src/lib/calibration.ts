// Per-topic difficulty calibration, derived from one-tap post-answer ratings.
//
// Derived at render time from attempts rather than stored, for the same reason
// mastery is: a stored aggregate drifts out of sync with the history it came
// from, and this way it round-trips through export/import for free.
//
//   too-easy = +1, about-right = 0, too-hard = -1
//   calibration = Σ(wᵢ·sᵢ) / Σ(wᵢ) over the last RATING_WINDOW rated attempts,
//   weighted 0.8^i so recent ratings dominate.
//
// Positive means "generate harder"; negative means "back off".
import type { Attempt, DifficultyRating, Question } from "../types";
import type { TopicId } from "./topics";
import { topicsForQuestion } from "./mastery";

export const RATING_WINDOW = 8; // ratings considered per topic
export const RATING_DECAY = 0.8; // weight of each older rating
export const MIN_RATINGS_FOR_SIGNAL = 3; // below this we don't steer generation
export const TOO_EASY_THRESHOLD = 0.4;
export const TOO_HARD_THRESHOLD = -0.4;

const RATING_SCORE: Record<DifficultyRating, number> = {
  "too-easy": 1,
  "about-right": 0,
  "too-hard": -1,
};

export type CalibrationVerdict = "too-easy" | "calibrated" | "too-hard" | "insufficient";

export interface TopicCalibration {
  topicId: TopicId;
  score: number; // -1 … +1
  ratings: number; // how many ratings fed this
  verdict: CalibrationVerdict;
}

function verdictFor(score: number, ratings: number): CalibrationVerdict {
  if (ratings < MIN_RATINGS_FOR_SIGNAL) return "insufficient";
  if (score >= TOO_EASY_THRESHOLD) return "too-easy";
  if (score <= TOO_HARD_THRESHOLD) return "too-hard";
  return "calibrated";
}

/** Calibration for every topic the user has rated at least one question in. */
export function computeAllCalibration(
  questions: Question[],
  attempts: Attempt[],
): Map<TopicId, TopicCalibration> {
  const questionsById = new Map(questions.map((q) => [q.id, q]));

  // Bucket rated attempts by topic, newest first.
  const byTopic = new Map<TopicId, Attempt[]>();
  const rated = attempts
    .filter((a) => a.difficultyRating !== undefined)
    .sort((a, b) => b.timestamp - a.timestamp);

  for (const a of rated) {
    for (const t of topicsForQuestion(a.questionId, questionsById)) {
      const list = byTopic.get(t) ?? [];
      list.push(a);
      byTopic.set(t, list);
    }
  }

  const result = new Map<TopicId, TopicCalibration>();
  for (const [topicId, topicAttempts] of byTopic) {
    const window = topicAttempts.slice(0, RATING_WINDOW);
    let weighted = 0;
    let totalWeight = 0;
    window.forEach((a, i) => {
      const w = Math.pow(RATING_DECAY, i);
      weighted += w * RATING_SCORE[a.difficultyRating!];
      totalWeight += w;
    });
    const score = totalWeight > 0 ? weighted / totalWeight : 0;
    result.set(topicId, {
      topicId,
      score,
      ratings: topicAttempts.length,
      verdict: verdictFor(score, topicAttempts.length),
    });
  }
  return result;
}

export function calibrationFor(
  topicId: TopicId,
  calibration: Map<TopicId, TopicCalibration>,
): TopicCalibration {
  return calibration.get(topicId) ?? { topicId, score: 0, ratings: 0, verdict: "insufficient" };
}

/** Short human label for the Topics UI. */
export function describeCalibration(c: TopicCalibration): string {
  switch (c.verdict) {
    case "too-easy":
      return `Rated too easy (${c.ratings} rating${c.ratings === 1 ? "" : "s"}) — generating harder`;
    case "too-hard":
      return `Rated too hard (${c.ratings} rating${c.ratings === 1 ? "" : "s"}) — generating easier`;
    case "calibrated":
      return `Well pitched (${c.ratings} rating${c.ratings === 1 ? "" : "s"})`;
    default:
      return c.ratings === 0
        ? "No difficulty ratings yet"
        : `${c.ratings} of ${MIN_RATINGS_FOR_SIGNAL} ratings needed to steer generation`;
  }
}

/**
 * The instruction appended to the generation prompt. Returns null when there
 * isn't enough signal — an unsteered prompt beats one steered by one rating.
 */
export function calibrationInstruction(c: TopicCalibration): string | null {
  if (c.verdict === "insufficient" || c.verdict === "calibrated") return null;

  const recent = Math.min(c.ratings, RATING_WINDOW);
  if (c.verdict === "too-easy") {
    return `CALIBRATION FEEDBACK: across their last ${recent} rated questions on this topic the student has been telling you these are TOO EASY (calibration ${c.score.toFixed(2)} on a -1..+1 scale). Your previous output for this topic was under-pitched. Generate at or above the HARD anchors, prefer techniques they have not seen yet, and do not pad difficulty with bigger numbers.`;
  }
  return `CALIBRATION FEEDBACK: across their last ${recent} rated questions on this topic the student has been telling you these are TOO HARD (calibration ${c.score.toFixed(2)} on a -1..+1 scale). Pitch nearer the MEDIUM anchor: one clear technique per question, applied in a setup that does not also hide which technique applies.`;
}

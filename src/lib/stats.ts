import type { Attempt, Question, SrsState } from "../types";
import { dueCount as srsDueCount } from "./srs";
import { topicsForQuestion } from "./mastery";

export interface TopicStat {
  topic: string;
  attempts: number;
  correct: number;
  hitRate: number; // 0..1
}

export interface OverallStats {
  totalAttempted: number; // distinct questions attempted at least once
  totalAttempts: number; // total attempt records
  hitRate: number; // correct / total attempts (0..1)
  currentStreak: number; // consecutive correct answers, most recent first
  dueForReview: number;
  topicStats: TopicStat[];
  weakTopics: TopicStat[]; // lowest hit-rate topics with enough sample size
}

function isCorrect(a: Attempt): boolean {
  return a.verdict === "correct";
}

export function computeTopicStats(questions: Question[], attempts: Attempt[]): TopicStat[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const agg = new Map<string, { attempts: number; correct: number }>();

  for (const a of attempts) {
    // topicsForQuestion also resolves attempts on v1 seed questions that were
    // dropped in the v2 migration, so old history still counts.
    for (const topic of topicsForQuestion(a.questionId, byId)) {
      const entry = agg.get(topic) ?? { attempts: 0, correct: 0 };
      entry.attempts += 1;
      if (isCorrect(a)) entry.correct += 1;
      agg.set(topic, entry);
    }
  }

  return Array.from(agg.entries())
    .map(([topic, v]) => ({
      topic,
      attempts: v.attempts,
      correct: v.correct,
      hitRate: v.attempts > 0 ? v.correct / v.attempts : 0,
    }))
    .sort((a, b) => b.attempts - a.attempts);
}

export function computeStreak(attempts: Attempt[]): number {
  // Most recent attempts first; streak breaks on first incorrect/partial.
  const sorted = [...attempts].sort((a, b) => b.timestamp - a.timestamp);
  let streak = 0;
  for (const a of sorted) {
    if (isCorrect(a)) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

export function computeOverallStats(
  questions: Question[],
  attempts: Attempt[],
  srs: SrsState[],
): OverallStats {
  const totalAttempts = attempts.length;
  const correctAttempts = attempts.filter(isCorrect).length;
  const distinctQuestions = new Set(attempts.map((a) => a.questionId)).size;
  const topicStats = computeTopicStats(questions, attempts);

  const weakTopics = topicStats
    .filter((t) => t.attempts >= 2) // need at least a couple data points to call it "weak"
    .sort((a, b) => a.hitRate - b.hitRate)
    .slice(0, 5);

  return {
    totalAttempted: distinctQuestions,
    totalAttempts,
    hitRate: totalAttempts > 0 ? correctAttempts / totalAttempts : 0,
    currentStreak: computeStreak(attempts),
    dueForReview: srsDueCount(srs),
    topicStats,
    weakTopics,
  };
}

export interface DayPerformance {
  date: string; // YYYY-MM-DD
  attempts: number;
  correct: number;
  hitRate: number;
}

export function computePerformanceOverTime(attempts: Attempt[], days = 30): DayPerformance[] {
  const now = new Date();
  const buckets = new Map<string, { attempts: number; correct: number }>();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, { attempts: 0, correct: 0 });
  }

  for (const a of attempts) {
    const key = new Date(a.timestamp).toISOString().slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) continue; // outside the window
    bucket.attempts += 1;
    if (isCorrect(a)) bucket.correct += 1;
  }

  return Array.from(buckets.entries()).map(([date, v]) => ({
    date,
    attempts: v.attempts,
    correct: v.correct,
    hitRate: v.attempts > 0 ? v.correct / v.attempts : 0,
  }));
}

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
  currentStreak: number; // consecutive correct answers (not the daily streak)
  dailyStreak: DailyStreak;
  dueForReview: number;
  topicStats: TopicStat[];
  weakTopics: TopicStat[]; // lowest hit-rate topics with enough sample size
}

function isCorrect(a: Attempt): boolean {
  return a.verdict === "correct";
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * YYYY-MM-DD in the user's LOCAL timezone.
 *
 * Deliberately not toISOString(), which is UTC: west of Greenwich that rolls
 * over mid-evening, so an 8pm session would land on "tomorrow" and both the
 * streak and the daily chart would be wrong.
 */
export function localDateKey(ts: number | Date): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export interface DailyStreak {
  currentStreak: number; // consecutive qualifying days ending today or yesterday
  longestStreak: number;
  practicedToday: boolean;
  todayCount: number; // attempts logged today
  goal: number; // attempts needed for a day to count
}

/**
 * Consecutive-calendar-day practice streak.
 *
 * A day qualifies when it has at least `goal` attempts. The current streak is
 * counted back from today; if today hasn't qualified yet it starts from
 * yesterday instead, so an unfinished morning shows "6 days, practice to keep
 * it" rather than a demoralising and premature 0.
 */
export function computeDailyStreak(attempts: Attempt[], goal = 1): DailyStreak {
  const threshold = Math.max(1, Math.floor(goal));

  const perDay = new Map<string, number>();
  for (const a of attempts) {
    const key = localDateKey(a.timestamp);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  const qualifies = (key: string) => (perDay.get(key) ?? 0) >= threshold;

  const todayKey = localDateKey(Date.now());
  const todayCount = perDay.get(todayKey) ?? 0;
  const practicedToday = todayCount >= threshold;

  // Walk backwards a day at a time from the most recent day that could still be
  // part of a live streak.
  let cursor = new Date();
  cursor.setHours(12, 0, 0, 0); // midday avoids DST edges shifting the date
  if (!practicedToday) cursor = new Date(cursor.getTime() - DAY_MS);

  let currentStreak = 0;
  while (qualifies(localDateKey(cursor))) {
    currentStreak += 1;
    cursor = new Date(cursor.getTime() - DAY_MS);
  }

  // Longest run across all history: sort the qualifying days and count runs.
  const qualifyingDays = Array.from(perDay.entries())
    .filter(([, count]) => count >= threshold)
    .map(([key]) => key)
    .sort();

  let longestStreak = 0;
  let run = 0;
  let previous: string | null = null;
  for (const key of qualifyingDays) {
    if (previous !== null && localDateKey(new Date(`${previous}T12:00:00`).getTime() + DAY_MS) === key) {
      run += 1;
    } else {
      run = 1;
    }
    previous = key;
    if (run > longestStreak) longestStreak = run;
  }

  return {
    currentStreak,
    longestStreak: Math.max(longestStreak, currentStreak),
    practicedToday,
    todayCount,
    goal: threshold,
  };
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
  dailyGoal = 1,
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
    dailyStreak: computeDailyStreak(attempts, dailyGoal),
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
    // Local, matching the streak — the buckets used to be UTC, which put
    // evening sessions on the following day for anyone west of Greenwich.
    const key = localDateKey(d);
    buckets.set(key, { attempts: 0, correct: 0 });
  }

  for (const a of attempts) {
    const key = localDateKey(a.timestamp);
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

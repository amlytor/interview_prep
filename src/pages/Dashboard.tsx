import { useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useStore } from "../lib/store";
import { computeOverallStats, computePerformanceOverTime } from "../lib/stats";
import { topicLabel } from "../lib/topics";
import type { TopicId } from "../lib/topics";
import { computeReasonBreakdown, computeRecommendations } from "../lib/diagnostics";
import type { Page } from "../App";

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface DashboardProps {
  onNavigate: (page: Page) => void;
  onDrillTopic: (topicId: TopicId) => void;
}

export function Dashboard({ onNavigate, onDrillTopic }: DashboardProps) {
  const { data } = useStore();
  const stats = computeOverallStats(data.questions, data.attempts, data.srs, data.settings.dailyGoal);
  const streak = stats.dailyStreak;
  const perf = computePerformanceOverTime(data.attempts, 30);

  const [reasonTopic, setReasonTopic] = useState<TopicId | null>(null);
  const breakdown = useMemo(
    () => computeReasonBreakdown(data.questions, data.attempts, reasonTopic),
    [data.questions, data.attempts, reasonTopic],
  );
  const recommendations = useMemo(
    () => computeRecommendations(data.questions, data.attempts, data.studyNotes),
    [data.questions, data.attempts, data.studyNotes],
  );
  const chartData = perf.map((d) => ({ ...d, label: formatDateLabel(d.date) }));

  const hasActivity = data.attempts.length > 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="page-subtitle">Your quant interview prep at a glance.</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-secondary" onClick={() => onNavigate("drill")}>
            Start Drilling
          </button>
          <button className="btn btn-gold" onClick={() => onNavigate("mock")}>
            Mock Interview
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4">
        <div className="card stat-tile">
          <span className="stat-label">Questions Attempted</span>
          <span className="stat-value">{stats.totalAttempted}</span>
          <span className="stat-sub">of {data.questions.length} in bank</span>
        </div>
        <div className="card stat-tile">
          <span className="stat-label">Overall Hit Rate</span>
          <span className="stat-value">{stats.totalAttempts > 0 ? pct(stats.hitRate) : "—"}</span>
          <span className="stat-sub">{stats.totalAttempts} total attempts</span>
        </div>
        <div className="card stat-tile">
          <span className="stat-label">Daily Streak</span>
          <span
            className="stat-value"
            style={{ color: streak.currentStreak > 0 ? "var(--green-600)" : undefined }}
          >
            {streak.currentStreak}
            <span style={{ fontSize: "0.5em", fontWeight: 500 }}>
              {" "}
              day{streak.currentStreak === 1 ? "" : "s"}
            </span>
          </span>
          <span className="stat-sub">
            {streak.practicedToday
              ? `practiced today ✓${streak.longestStreak > streak.currentStreak ? ` · best ${streak.longestStreak}` : ""}`
              : streak.currentStreak > 0
                ? `practice today to keep it`
                : streak.longestStreak > 0
                  ? `best ${streak.longestStreak} — start a new one`
                  : "answer one question to start"}
          </span>
        </div>
        <div
          className="card stat-tile"
          style={{ cursor: stats.dueForReview > 0 ? "pointer" : "default" }}
          onClick={() => stats.dueForReview > 0 && onNavigate("review")}
        >
          <span className="stat-label">Due For Review</span>
          <span className="stat-value" style={{ color: stats.dueForReview > 0 ? "var(--red-600)" : undefined }}>
            {stats.dueForReview}
          </span>
          <span className="stat-sub">{stats.dueForReview > 0 ? "click to review" : "all caught up"}</span>
        </div>
      </div>

      <div className="grid grid-cols-2" style={{ marginTop: 18, alignItems: "start" }}>
        <div className="card">
          <div className="card-title">Hit Rate By Topic</div>
          {stats.topicStats.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No attempts yet — head to Drill mode to get started.
            </p>
          ) : (
            stats.topicStats.map((t) => (
              <div className="progress-row" key={t.topic}>
                <span className="progress-label" title={topicLabel(t.topic)}>
                  {topicLabel(t.topic)}
                </span>
                <span className="progress-track">
                  <span
                    className={`progress-fill${t.hitRate < 0.5 ? " weak" : ""}`}
                    style={{ width: `${Math.round(t.hitRate * 100)}%` }}
                  />
                </span>
                <span className="progress-value">
                  {pct(t.hitRate)} ({t.attempts})
                </span>
              </div>
            ))
          )}
        </div>

        <div className="card">
          <div className="card-title">Weak Areas</div>
          {stats.weakTopics.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Attempt at least 2 questions in a topic to surface weak areas here.
            </p>
          ) : (
            <div>
              {stats.weakTopics.map((t) => (
                <div
                  key={t.topic}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 0",
                    borderBottom: "1px solid var(--gray-100)",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{topicLabel(t.topic)}</div>
                    <div className="muted" style={{ fontSize: 12.5 }}>
                      {t.correct}/{t.attempts} correct
                    </div>
                  </div>
                  <span className="badge badge-hard">{pct(t.hitRate)}</span>
                </div>
              ))}
              <button
                className="btn btn-secondary btn-sm"
                style={{ marginTop: 14 }}
                onClick={() => onNavigate("drill")}
              >
                Drill weak topics
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ---------- Why I'm getting things wrong ---------- */}
      <div className="grid grid-cols-2" style={{ marginTop: 18, alignItems: "start" }}>
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>
              Why I'm Getting Things Wrong
            </div>
            <select
              value={reasonTopic ?? ""}
              onChange={(e) => setReasonTopic(e.target.value || null)}
              style={{ maxWidth: 190, fontSize: 12.5, padding: "5px 8px" }}
            >
              <option value="">All topics</option>
              {data.studyNotes.map((n) => (
                <option key={n.topicId} value={n.topicId}>
                  {n.title}
                </option>
              ))}
            </select>
          </div>

          {breakdown.counts.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              {breakdown.untaggedMisses > 0
                ? `${breakdown.untaggedMisses} miss${breakdown.untaggedMisses === 1 ? "" : "es"} with no reason recorded. After a miss, use "Discuss / figure out why" to diagnose it.`
                : "No misses recorded here yet."}
            </p>
          ) : (
            <>
              {breakdown.counts.map((r) => (
                <div className="progress-row" key={r.tag}>
                  <span className="progress-label" title={r.tag}>
                    {r.tag}
                  </span>
                  <span className="progress-track">
                    <span className="progress-fill weak" style={{ width: `${Math.round(r.share * 100)}%` }} />
                  </span>
                  <span className="progress-value">
                    {r.count} ({pct(r.share)})
                  </span>
                </div>
              ))}
              <p className="muted" style={{ fontSize: 12.5, marginTop: 12, marginBottom: 0 }}>
                {breakdown.taggedMisses} diagnosed miss{breakdown.taggedMisses === 1 ? "" : "es"}
                {breakdown.untaggedMisses > 0 && ` · ${breakdown.untaggedMisses} still undiagnosed`}
              </p>
            </>
          )}
        </div>

        <div className="card">
          <div className="card-title">Recommended Focus</div>
          {recommendations.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Nothing to flag. Recommendations appear when your misses cluster on one cause, or when a topic
              you're struggling with sits on a prerequisite that isn't solid yet.
            </p>
          ) : (
            recommendations.map((rec, i) => (
              <div key={i} className={`recommendation rec-${rec.kind}`}>
                <div className="rec-headline">{rec.headline}</div>
                <p className="rec-detail">{rec.detail}</p>
                {rec.topicId && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="btn btn-gold btn-sm" onClick={() => onNavigate("topics")}>
                      Learn {topicLabel(rec.topicId)}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => onDrillTopic(rec.topicId!)}>
                      Drill it
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-title">Hit Rate Over Time (last 30 days)</div>
        {!hasActivity ? (
          <p className="muted" style={{ margin: 0 }}>
            Your performance chart will appear here once you've logged a few attempts.
          </p>
        ) : (
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={4} />
                <YAxis
                  domain={[0, 1]}
                  tickFormatter={(v) => `${Math.round(v * 100)}%`}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  formatter={(value) => [`${Math.round(Number(value) * 100)}%`, "Hit rate"]}
                  labelFormatter={(label) => label}
                />
                <Line
                  type="monotone"
                  dataKey="hitRate"
                  stroke="#2454c9"
                  strokeWidth={2.5}
                  dot={false}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

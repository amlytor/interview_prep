import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useStore } from "../lib/store";
import { computeOverallStats, computePerformanceOverTime } from "../lib/stats";
import { topicLabel } from "../lib/topics";
import type { Page } from "../App";

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function Dashboard({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const { data } = useStore();
  const stats = computeOverallStats(data.questions, data.attempts, data.srs);
  const perf = computePerformanceOverTime(data.attempts, 30);
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
          <span className="stat-label">Current Streak</span>
          <span className="stat-value">{stats.currentStreak}</span>
          <span className="stat-sub">consecutive correct</span>
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

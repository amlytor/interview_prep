import { useMemo, useState } from "react";
import { useStore } from "../lib/store";
import { TOPICS } from "../lib/topics";
import type { Difficulty, Question } from "../types";
import { QuestionAttempt } from "../components/QuestionAttempt";
import { ApiKeyBanner } from "../components/ApiKeyBanner";
import type { Page } from "../App";

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

function pickRandom(pool: Question[], excludeId: string | null): Question | null {
  if (pool.length === 0) return null;
  const candidates = pool.length > 1 ? pool.filter((q) => q.id !== excludeId) : pool;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function Drill({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const { data } = useStore();
  const [topicFilter, setTopicFilter] = useState<string[]>([]);
  const [difficultyFilter, setDifficultyFilter] = useState<Difficulty[]>([]);
  const [attemptCount, setAttemptCount] = useState(0);

  const pool = useMemo(() => {
    return data.questions.filter((q) => {
      const topicOk = topicFilter.length === 0 || q.topics.some((t) => topicFilter.includes(t));
      const diffOk = difficultyFilter.length === 0 || difficultyFilter.includes(q.difficulty);
      return topicOk && diffOk;
    });
  }, [data.questions, topicFilter, difficultyFilter]);

  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(() => pickRandom(pool, null));

  function toggleTopic(topic: string) {
    setTopicFilter((prev) => (prev.includes(topic) ? prev.filter((t) => t !== topic) : [...prev, topic]));
  }

  function toggleDifficulty(d: Difficulty) {
    setDifficultyFilter((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  function applyFiltersAndPick() {
    const filtered = data.questions.filter((q) => {
      const topicOk = topicFilter.length === 0 || q.topics.some((t) => topicFilter.includes(t));
      const diffOk = difficultyFilter.length === 0 || difficultyFilter.includes(q.difficulty);
      return topicOk && diffOk;
    });
    setCurrentQuestion(pickRandom(filtered, currentQuestion?.id ?? null));
  }

  function nextQuestion() {
    setAttemptCount((c) => c + 1);
    setCurrentQuestion(pickRandom(pool, currentQuestion?.id ?? null));
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Drill</h1>
          <p className="page-subtitle">One question at a time. Filter by topic and difficulty.</p>
        </div>
      </div>

      {!data.settings.apiKey && <ApiKeyBanner onNavigate={onNavigate} />}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Filters</div>
        <div className="field">
          <label>Topics {topicFilter.length > 0 && `(${topicFilter.length} selected)`}</label>
          <div className="pill-select">
            {TOPICS.map((t) => (
              <button
                key={t}
                type="button"
                className={`pill-option${topicFilter.includes(t) ? " selected" : ""}`}
                onClick={() => {
                  toggleTopic(t);
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Difficulty</label>
          <div className="pill-select">
            {DIFFICULTIES.map((d) => (
              <button
                key={d}
                type="button"
                className={`pill-option${difficultyFilter.includes(d) ? " selected" : ""}`}
                onClick={() => toggleDifficulty(d)}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center" }}>
          <button className="btn btn-primary btn-sm" onClick={applyFiltersAndPick}>
            Apply filters
          </button>
          <span className="muted" style={{ fontSize: 13 }}>
            {pool.length} question{pool.length === 1 ? "" : "s"} match
          </span>
        </div>
      </div>

      {!currentQuestion ? (
        <div className="card empty-state">
          <h3>No questions match these filters</h3>
          <p>Try loosening your topic or difficulty selection, or add your own questions.</p>
        </div>
      ) : (
        <QuestionAttempt
          key={currentQuestion.id + attemptCount}
          question={currentQuestion}
          source="drill"
          onDone={nextQuestion}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
}

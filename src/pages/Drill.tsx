import { aiConfigured } from "../lib/ai";
import { useMemo, useState } from "react";
import { useStore } from "../lib/store";
import { allTopics } from "../lib/topics";
import type { TopicId } from "../lib/topics";
import type { Difficulty, Question } from "../types";
import { pickPractice } from "../lib/practice";
import { QuestionAttempt } from "../components/QuestionAttempt";
import { ApiKeyBanner } from "../components/ApiKeyBanner";
import type { Page } from "../App";

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

interface DrillProps {
  onNavigate: (page: Page) => void;
  // Pre-selects a topic filter when arriving via "Drill this topic".
  initialTopicId?: TopicId | null;
  onDrillTopic: (topicId: TopicId) => void;
}

export function Drill({ onNavigate, initialTopicId, onDrillTopic }: DrillProps) {
  const { data } = useStore();
  const [topicFilter, setTopicFilter] = useState<TopicId[]>(initialTopicId ? [initialTopicId] : []);
  const [difficultyFilter, setDifficultyFilter] = useState<Difficulty[]>([]);
  const [attemptCount, setAttemptCount] = useState(0);

  const pool = useMemo(() => {
    return data.questions.filter((q) => {
      const topicOk = topicFilter.length === 0 || q.topics.some((t) => topicFilter.includes(t));
      const diffOk = difficultyFilter.length === 0 || difficultyFilter.includes(q.difficulty);
      return topicOk && diffOk;
    });
  }, [data.questions, topicFilter, difficultyFilter]);

  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(() => pickPractice(pool, data.attempts, null));

  function toggleTopic(topic: TopicId) {
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
    setCurrentQuestion(pickPractice(filtered, data.attempts, currentQuestion?.id ?? null));
  }

  function nextQuestion() {
    setAttemptCount((c) => c + 1);
    setCurrentQuestion(pickPractice(pool, data.attempts, currentQuestion?.id ?? null));
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Drill</h1>
          <p className="page-subtitle">One question at a time. Filter by topic and difficulty.</p>
        </div>
      </div>

      {!aiConfigured(data.settings) && <ApiKeyBanner onNavigate={onNavigate} />}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Filters</div>
        <div className="field">
          <label>Topics {topicFilter.length > 0 && `(${topicFilter.length} selected)`}</label>
          <div className="pill-select">
            {allTopics().map((t) => (
              <button
                key={t.id}
                type="button"
                className={`pill-option${topicFilter.includes(t.id) ? " selected" : ""}`}
                onClick={() => toggleTopic(t.id)}
              >
                {t.label}
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
          onDrillTopic={onDrillTopic}
        />
      )}
    </div>
  );
}

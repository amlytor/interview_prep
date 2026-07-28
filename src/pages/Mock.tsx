import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import type { Question, Verdict, WhyMissedTag } from "../types";
import { DifficultyBadge, TopicBadges, VerdictBadge } from "../components/QuestionMeta";
import { TimerBadge } from "../components/Timer";
import { ApiKeyBanner, ErrorBanner } from "../components/ApiKeyBanner";
import { gradeFreeTextAnswer, aiConfigured, GradingError } from "../lib/ai";
import { orderForPractice } from "../lib/practice";
import type { Page } from "../App";

type MockPhase = "setup" | "in-progress" | "grading" | "debrief";

interface AnswerState {
  userAnswer: string;
  selectedChoiceId: string | null;
}

interface ResultState {
  verdict: Verdict | null;
  feedback: string;
  whyMissed: WhyMissedTag | null;
  error: string | null;
  recorded: boolean;
}

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function Mock({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const { data, recordAttempt } = useStore();
  const [phase, setPhase] = useState<MockPhase>("setup");
  const [numQuestions, setNumQuestions] = useState(5);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<AnswerState[]>([]);
  const [elapsedByIndex, setElapsedByIndex] = useState<number[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [results, setResults] = useState<ResultState[]>([]);
  const [gradingProgress, setGradingProgress] = useState(0);

  // Per-question timer: ticks the currently-viewed question's elapsed time.
  useEffect(() => {
    if (phase !== "in-progress") return;
    const interval = setInterval(() => {
      setElapsedByIndex((prev) => {
        const next = [...prev];
        next[currentIndex] = (next[currentIndex] ?? 0) + 1;
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [phase, currentIndex]);

  function startMock() {
    const n = Math.max(1, Math.min(numQuestions, data.questions.length));
    // Prefer questions whose answers haven't been spoiled.
    const picked = orderForPractice(data.questions, data.attempts).slice(0, n);
    setQuestions(picked);
    setAnswers(picked.map(() => ({ userAnswer: "", selectedChoiceId: null })));
    setElapsedByIndex(picked.map(() => 0));
    setResults(picked.map(() => ({ verdict: null, feedback: "", whyMissed: null, error: null, recorded: false })));
    setCurrentIndex(0);
    setPhase("in-progress");
  }

  function updateAnswer(index: number, patch: Partial<AnswerState>) {
    setAnswers((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  }

  async function gradeQuestion(index: number, qs: Question[], ans: AnswerState[], times: number[]) {
    const q = qs[index];
    const a = ans[index];
    const timeSpentSec = times[index] ?? 0;

    if (q.answerMode === "multiple-choice") {
      const verdict: Verdict = a.selectedChoiceId === q.correctChoiceId ? "correct" : "incorrect";
      const chosenText = q.choices?.find((c) => c.id === a.selectedChoiceId)?.text ?? "(no answer selected)";
      recordAttempt({
        questionId: q.id,
        source: "mock",
        answerMode: "multiple-choice",
        userAnswer: chosenText,
        verdict,
        timeSpentSec,
      });
      setResults((prev) =>
        prev.map((r, i) => (i === index ? { verdict, feedback: "", whyMissed: null, error: null, recorded: true } : r)),
      );
      return;
    }

    try {
      const graded = await gradeFreeTextAnswer(q, a.userAnswer, data.settings);
      recordAttempt({
        questionId: q.id,
        source: "mock",
        answerMode: "free-text",
        userAnswer: a.userAnswer,
        verdict: graded.verdict,
        feedback: graded.feedback,
        whyMissed: graded.whyMissed ?? undefined,
        timeSpentSec,
      });
      setResults((prev) =>
        prev.map((r, i) =>
          i === index
            ? { verdict: graded.verdict, feedback: graded.feedback, whyMissed: graded.whyMissed, error: null, recorded: true }
            : r,
        ),
      );
    } catch (err) {
      const message = err instanceof GradingError ? err.message : "Unexpected error while grading.";
      setResults((prev) => prev.map((r, i) => (i === index ? { ...r, error: message, recorded: false } : r)));
    }
  }

  async function finishAndGrade() {
    setPhase("grading");
    setGradingProgress(0);
    for (let i = 0; i < questions.length; i++) {
      await gradeQuestion(i, questions, answers, elapsedByIndex);
      setGradingProgress(i + 1);
    }
    setPhase("debrief");
  }

  async function retryGrade(index: number) {
    await gradeQuestion(index, questions, answers, elapsedByIndex);
  }

  function resetToSetup() {
    setPhase("setup");
    setQuestions([]);
    setAnswers([]);
    setResults([]);
    setElapsedByIndex([]);
    setCurrentIndex(0);
  }

  // ---------- Setup ----------
  if (phase === "setup") {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Mock Interview</h1>
            <p className="page-subtitle">A timed, mixed-topic session that mirrors real interview pressure.</p>
          </div>
        </div>

        {!aiConfigured(data.settings) && <ApiKeyBanner onNavigate={onNavigate} />}

        <div className="card" style={{ maxWidth: 480 }}>
          <div className="card-title">Session Setup</div>
          <div className="field">
            <label htmlFor="numQ">Number of questions</label>
            <input
              id="numQ"
              type="number"
              min={1}
              max={data.questions.length}
              value={numQuestions}
              onChange={(e) => setNumQuestions(Number(e.target.value) || 1)}
            />
            <p className="field-hint">
              Questions are drawn randomly across all topics ({data.questions.length} available). No feedback is
              shown until you finish.
            </p>
          </div>
          <button className="btn btn-gold btn-block" onClick={startMock}>
            Start Mock Interview
          </button>
        </div>
      </div>
    );
  }

  // ---------- In progress ----------
  if (phase === "in-progress") {
    const q = questions[currentIndex];
    const a = answers[currentIndex];
    const elapsed = elapsedByIndex[currentIndex] ?? 0;
    const totalElapsed = elapsedByIndex.reduce((s, x) => s + x, 0);

    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Mock Interview</h1>
            <p className="page-subtitle">
              Question {currentIndex + 1} of {questions.length} · total elapsed {formatTime(totalElapsed)}
            </p>
          </div>
          <TimerBadge seconds={elapsed} urgentAt={180} />
        </div>

        <div className="mock-question-nav">
          {questions.map((_, i) => {
            const answered =
              questions[i].answerMode === "multiple-choice"
                ? answers[i]?.selectedChoiceId !== null
                : (answers[i]?.userAnswer ?? "").trim().length > 0;
            return (
              <button
                key={i}
                className={`mock-question-dot${answered ? " answered" : ""}${i === currentIndex ? " current" : ""}`}
                onClick={() => setCurrentIndex(i)}
                title={`Question ${i + 1}${answered ? " (answered)" : ""}`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>

        <div className="card question-card">
          <div className="question-meta-row">
            <DifficultyBadge difficulty={q.difficulty} />
          </div>
          <TopicBadges topics={q.topics} />
          <div className="question-prompt">{q.prompt}</div>

          {q.answerMode === "multiple-choice" ? (
            <div className="choice-list">
              {q.choices?.map((choice, idx) => (
                <div
                  key={choice.id}
                  className={`choice-option${a.selectedChoiceId === choice.id ? " selected" : ""}`}
                  onClick={() => updateAnswer(currentIndex, { selectedChoiceId: choice.id })}
                >
                  <span className="choice-key">{String.fromCharCode(65 + idx)}</span>
                  <span>{choice.text}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="field">
              <label>Your reasoning</label>
              <textarea
                value={a.userAnswer}
                onChange={(e) => updateAnswer(currentIndex, { userAnswer: e.target.value })}
                placeholder="Walk through your approach and final answer..."
                rows={5}
              />
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <button
              className="btn btn-secondary"
              disabled={currentIndex === 0}
              onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
            >
              Previous
            </button>
            {currentIndex < questions.length - 1 ? (
              <button className="btn btn-primary" onClick={() => setCurrentIndex((i) => i + 1)}>
                Next
              </button>
            ) : (
              <button className="btn btn-gold" onClick={finishAndGrade}>
                Finish &amp; Grade
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---------- Grading ----------
  if (phase === "grading") {
    return (
      <div>
        <div className="page-header">
          <h1>Grading your mock interview...</h1>
        </div>
        <div className="card" style={{ textAlign: "center", padding: 48 }}>
          <span className="spinner dark" style={{ width: 28, height: 28, borderWidth: 3 }} />
          <p style={{ marginTop: 16 }}>
            Grading question {Math.min(gradingProgress + 1, questions.length)} of {questions.length}...
          </p>
        </div>
      </div>
    );
  }

  // ---------- Debrief ----------
  const graded = results.filter((r) => r.verdict !== null);
  const correctCount = results.filter((r) => r.verdict === "correct").length;
  const partialCount = results.filter((r) => r.verdict === "partial").length;
  const incorrectCount = results.filter((r) => r.verdict === "incorrect").length;
  const score = graded.length > 0 ? correctCount / graded.length : 0;

  const topicMisses = new Map<string, number>();
  results.forEach((r, i) => {
    if (r.verdict === "correct" || r.verdict === null) return;
    for (const t of questions[i].topics) {
      topicMisses.set(t, (topicMisses.get(t) ?? 0) + 1);
    }
  });
  const weakTopics = Array.from(topicMisses.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Mock Interview Debrief</h1>
          <p className="page-subtitle">
            {correctCount}/{graded.length} graded correct
            {results.some((r) => r.error) ? " · some questions failed to grade — see below" : ""}
          </p>
        </div>
        <button className="btn btn-secondary" onClick={resetToSetup}>
          New Mock Session
        </button>
      </div>

      <div className="grid grid-cols-3" style={{ marginBottom: 18 }}>
        <div className="card stat-tile">
          <span className="stat-label">Overall Score</span>
          <span className="stat-value">{Math.round(score * 100)}%</span>
          <span className="stat-sub">
            {correctCount} correct · {partialCount} partial · {incorrectCount} incorrect
          </span>
        </div>
        <div className="card stat-tile">
          <span className="stat-label">Total Time</span>
          <span className="stat-value">{formatTime(elapsedByIndex.reduce((s, x) => s + x, 0))}</span>
          <span className="stat-sub">across {questions.length} questions</span>
        </div>
        <div className="card">
          <span className="stat-label">Weak Topics This Session</span>
          {weakTopics.length === 0 ? (
            <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
              None — clean sweep.
            </p>
          ) : (
            <div className="tag-row" style={{ marginTop: 8 }}>
              {weakTopics.map(([t, count]) => (
                <span key={t} className="badge badge-hard">
                  {t} ({count})
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {questions.map((q, i) => {
        const r = results[i];
        const a = answers[i];
        return (
          <div className="card question-card" key={q.id}>
            <div className="question-meta-row">
              <span className="muted" style={{ fontSize: 12.5, fontWeight: 700 }}>
                Q{i + 1}
              </span>
              <DifficultyBadge difficulty={q.difficulty} />
              {r.verdict && <VerdictBadge verdict={r.verdict} />}
              <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>
                {formatTime(elapsedByIndex[i] ?? 0)}
              </span>
            </div>
            <TopicBadges topics={q.topics} />
            <div className="question-prompt" style={{ fontSize: 15.5 }}>
              {q.prompt}
            </div>

            <div style={{ fontSize: 13.5, marginBottom: 10 }}>
              <strong>Your answer:</strong>{" "}
              <span className="muted">
                {q.answerMode === "multiple-choice"
                  ? q.choices?.find((c) => c.id === a.selectedChoiceId)?.text ?? "(no answer)"
                  : a.userAnswer || "(left blank)"}
              </span>
            </div>

            {r.error && <ErrorBanner message={r.error} onRetry={() => retryGrade(i)} />}

            {r.verdict && q.answerMode === "free-text" && (
              <div className={`feedback-box verdict-${r.verdict}`}>
                <p>{r.feedback}</p>
                {r.whyMissed && (
                  <p style={{ marginTop: 8 }}>
                    <strong>Why missed:</strong> {r.whyMissed}
                  </p>
                )}
              </div>
            )}

            {r.verdict && (
              <div className="explanation-box">
                <p>
                  <strong>Canonical answer:</strong> {q.canonicalAnswer}
                </p>
                <p style={{ marginBottom: 0 }}>{q.explanation}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

import { useRef, useState } from "react";
import type {
  Attempt,
  AttemptSource,
  DifficultyRating,
  Question,
  Verdict,
  WhyMissedTag,
} from "../types";
import { DIFFICULTY_RATINGS } from "../types";
import { DifficultyBadge, TopicBadges, VerdictBadge } from "./QuestionMeta";
import { ErrorBanner } from "./ApiKeyBanner";
import { gradeFreeTextAnswer, aiConfigured, GradingError } from "../lib/ai";
import { useStore } from "../lib/store";
import { DiagnosisChat } from "./DiagnosisChat";
import type { TopicId } from "../lib/topics";
import type { Page } from "../App";

type Phase = "answering" | "grading" | "graded";

const RATING_LABELS: Record<DifficultyRating, string> = {
  "too-easy": "Too easy",
  "about-right": "About right",
  "too-hard": "Too hard",
};

interface QuestionAttemptProps {
  question: Question;
  source: AttemptSource;
  onDone: (attempt: Attempt) => void;
  onNavigate: (page: Page) => void;
  // Lets a diagnosed prerequisite gap link straight into drilling that topic.
  onDrillTopic?: (topicId: TopicId) => void;
}

export function QuestionAttempt({
  question,
  source,
  onDone,
  onNavigate,
  onDrillTopic,
}: QuestionAttemptProps) {
  const { data, recordAttempt, rateAttemptDifficulty } = useStore();
  const [phase, setPhase] = useState<Phase>("answering");
  const [freeText, setFreeText] = useState("");
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [result, setResult] = useState<{
    verdict: Verdict;
    feedback: string;
    whyMissed: WhyMissedTag | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState<DifficultyRating | null>(null);
  const [showDiagnosis, setShowDiagnosis] = useState(false);
  const startRef = useRef(Date.now());
  const lastAttemptRef = useRef<Attempt | null>(null);

  const canSubmit =
    question.answerMode === "multiple-choice" ? selectedChoiceId !== null : freeText.trim().length > 0;

  async function submitFreeText() {
    setError(null);
    setPhase("grading");
    try {
      const graded = await gradeFreeTextAnswer(question, freeText, data.settings);
      setResult(graded);
      setPhase("graded");
      const attempt = recordAttempt({
        questionId: question.id,
        source,
        answerMode: "free-text",
        userAnswer: freeText,
        verdict: graded.verdict,
        feedback: graded.feedback,
        whyMissed: graded.whyMissed ?? undefined,
        timeSpentSec: Math.round((Date.now() - startRef.current) / 1000),
      });
      // stash for the "Next" handler via closure — caller re-renders with new question
      lastAttemptRef.current = attempt;
    } catch (err) {
      const message = err instanceof GradingError ? err.message : "Unexpected error while grading.";
      setError(message);
      setPhase("answering");
    }
  }

  function submitChoice() {
    if (!selectedChoiceId) return;
    const verdict: Verdict = selectedChoiceId === question.correctChoiceId ? "correct" : "incorrect";
    const chosenText = question.choices?.find((c) => c.id === selectedChoiceId)?.text ?? "";
    setResult({ verdict, feedback: "", whyMissed: null });
    setPhase("graded");
    const attempt = recordAttempt({
      questionId: question.id,
      source,
      answerMode: "multiple-choice",
      userAnswer: chosenText,
      verdict,
      timeSpentSec: Math.round((Date.now() - startRef.current) / 1000),
    });
    lastAttemptRef.current = attempt;
  }

  function handleSubmit() {
    if (!canSubmit) return;
    if (question.answerMode === "multiple-choice") {
      submitChoice();
    } else {
      void submitFreeText();
    }
  }

  return (
    <div className="card question-card">
      <div className="question-meta-row">
        <DifficultyBadge difficulty={question.difficulty} />
        {phase === "graded" && result && <VerdictBadge verdict={result.verdict} />}
      </div>
      <TopicBadges topics={question.topics} />
      <div className="question-prompt">{question.prompt}</div>

      {question.answerMode === "multiple-choice" ? (
        <div className="choice-list">
          {question.choices?.map((choice, idx) => {
            const isSelected = selectedChoiceId === choice.id;
            const isCorrectChoice = choice.id === question.correctChoiceId;
            let cls = "choice-option";
            if (phase === "graded") {
              if (isCorrectChoice) cls += " correct";
              else if (isSelected) cls += " incorrect";
            } else if (isSelected) {
              cls += " selected";
            }
            return (
              <div
                key={choice.id}
                className={cls}
                onClick={() => phase === "answering" && setSelectedChoiceId(choice.id)}
              >
                <span className="choice-key">{String.fromCharCode(65 + idx)}</span>
                <span>{choice.text}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="field">
          <label htmlFor="answer">Your reasoning</label>
          <textarea
            id="answer"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            placeholder="Walk through your approach and final answer..."
            disabled={phase !== "answering"}
            rows={5}
          />
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={handleSubmit} />}

      {phase !== "graded" && (
        <button className="btn btn-primary" onClick={handleSubmit} disabled={!canSubmit || phase === "grading"}>
          {phase === "grading" ? (
            <>
              <span className="spinner" /> Grading with Claude...
            </>
          ) : (
            "Submit Answer"
          )}
        </button>
      )}

      {phase === "graded" && result && (
        <>
          {question.answerMode === "free-text" && (
            <div className={`feedback-box verdict-${result.verdict}`}>
              <p>{result.feedback}</p>
              {result.whyMissed && (
                <p style={{ marginTop: 8 }}>
                  <strong>Why missed:</strong> {result.whyMissed}
                </p>
              )}
            </div>
          )}
          <div className="explanation-box">
            <p>
              <strong>Canonical answer:</strong> {question.canonicalAnswer}
            </p>
            <p style={{ marginBottom: 0 }}>{question.explanation}</p>
          </div>
          {/* One tap, no form — anything heavier and it wouldn't get used,
              and unused ratings are worse than none for calibration. */}
          <div className="rating-row">
            <span className="rating-label">How was that?</span>
            {DIFFICULTY_RATINGS.map((r) => (
              <button
                key={r}
                type="button"
                className={`rating-option${rating === r ? " selected" : ""}`}
                onClick={() => {
                  if (!lastAttemptRef.current) return;
                  setRating(r);
                  rateAttemptDifficulty(lastAttemptRef.current.id, r);
                }}
              >
                {RATING_LABELS[r]}
              </button>
            ))}
            {rating && <span className="rating-ack">thanks — future questions will adjust</span>}
          </div>

          {/* Diagnosis is offered on anything short of a clean correct — a
              "partial" is exactly the case where the root cause is unclear. */}
          {result.verdict !== "correct" && lastAttemptRef.current && (
            <>
              {showDiagnosis ? (
                <DiagnosisChat
                  question={question}
                  attempt={lastAttemptRef.current}
                  onClose={() => setShowDiagnosis(false)}
                  onNavigate={onNavigate}
                  onDrillTopic={onDrillTopic}
                />
              ) : (
                <button
                  className="btn btn-secondary"
                  style={{ marginTop: 14 }}
                  onClick={() => setShowDiagnosis(true)}
                >
                  Discuss / figure out why →
                </button>
              )}
            </>
          )}

          <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              className="btn btn-primary"
              onClick={() => lastAttemptRef.current && onDone(lastAttemptRef.current)}
            >
              Next Question
            </button>
            {!aiConfigured(data.settings) && question.answerMode === "free-text" && (
              <button className="btn btn-secondary" onClick={() => onNavigate("settings")}>
                Set up API key
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

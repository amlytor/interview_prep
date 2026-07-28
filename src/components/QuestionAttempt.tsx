import { useRef, useState } from "react";
import type { Attempt, AttemptSource, Question, Verdict, WhyMissedTag } from "../types";
import { DifficultyBadge, TopicBadges, VerdictBadge } from "./QuestionMeta";
import { ErrorBanner } from "./ApiKeyBanner";
import { gradeFreeTextAnswer, aiConfigured, GradingError } from "../lib/ai";
import { useStore } from "../lib/store";
import type { Page } from "../App";

type Phase = "answering" | "grading" | "graded";

interface QuestionAttemptProps {
  question: Question;
  source: AttemptSource;
  onDone: (attempt: Attempt) => void;
  onNavigate: (page: Page) => void;
}

export function QuestionAttempt({ question, source, onDone, onNavigate }: QuestionAttemptProps) {
  const { data, recordAttempt } = useStore();
  const [phase, setPhase] = useState<Phase>("answering");
  const [freeText, setFreeText] = useState("");
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [result, setResult] = useState<{
    verdict: Verdict;
    feedback: string;
    whyMissed: WhyMissedTag | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
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
          <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
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

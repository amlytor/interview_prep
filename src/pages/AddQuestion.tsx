import { useState } from "react";
import { useStore } from "../lib/store";
import { allTopics } from "../lib/topics";
import type { TopicId } from "../lib/topics";
import type { AnswerMode, Choice, Difficulty } from "../types";
import type { Page } from "../App";

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

function emptyChoices(): Choice[] {
  return [
    { id: "a", text: "" },
    { id: "b", text: "" },
    { id: "c", text: "" },
    { id: "d", text: "" },
  ];
}

export function AddQuestion({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const { addQuestion } = useStore();

  const [prompt, setPrompt] = useState("");
  const [topics, setTopics] = useState<TopicId[]>([]);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [answerMode, setAnswerMode] = useState<AnswerMode>("free-text");
  const [canonicalAnswer, setCanonicalAnswer] = useState("");
  const [explanation, setExplanation] = useState("");
  const [choices, setChoices] = useState<Choice[]>(emptyChoices());
  const [correctChoiceId, setCorrectChoiceId] = useState<string>("a");
  const [justAdded, setJustAdded] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  function toggleTopic(t: TopicId) {
    setTopics((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  function updateChoiceText(id: string, text: string) {
    setChoices((prev) => prev.map((c) => (c.id === id ? { ...c, text } : c)));
  }

  function resetForm() {
    setPrompt("");
    setTopics([]);
    setDifficulty("medium");
    setAnswerMode("free-text");
    setCanonicalAnswer("");
    setExplanation("");
    setChoices(emptyChoices());
    setCorrectChoiceId("a");
  }

  function validate(): string | null {
    if (prompt.trim().length === 0) return "Enter a question prompt.";
    if (topics.length === 0) return "Select at least one topic.";
    if (canonicalAnswer.trim().length === 0) return "Enter the canonical answer.";
    if (explanation.trim().length === 0) return "Enter a worked explanation.";
    if (answerMode === "multiple-choice") {
      const filled = choices.filter((c) => c.text.trim().length > 0);
      if (filled.length < 2) return "Multiple-choice questions need at least 2 filled-in choices.";
      const correct = choices.find((c) => c.id === correctChoiceId);
      if (!correct || correct.text.trim().length === 0) return "The marked correct choice needs text.";
    }
    return null;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) {
      setValidationError(err);
      setJustAdded(false);
      return;
    }
    setValidationError(null);

    if (answerMode === "multiple-choice") {
      const filledChoices = choices.filter((c) => c.text.trim().length > 0);
      addQuestion({
        prompt: prompt.trim(),
        topics,
        difficulty,
        answerMode,
        canonicalAnswer: canonicalAnswer.trim(),
        explanation: explanation.trim(),
        choices: filledChoices,
        correctChoiceId,
      });
    } else {
      addQuestion({
        prompt: prompt.trim(),
        topics,
        difficulty,
        answerMode,
        canonicalAnswer: canonicalAnswer.trim(),
        explanation: explanation.trim(),
      });
    }

    setJustAdded(true);
    resetForm();
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Add Question</h1>
          <p className="page-subtitle">Grow your bank as you work through Zhou, Crack, and your own notes.</p>
        </div>
      </div>

      {justAdded && (
        <div className="banner banner-success">
          <p>Question added to your bank.</p>
          <button className="btn btn-secondary btn-sm" onClick={() => onNavigate("drill")}>
            Go drill it
          </button>
        </div>
      )}
      {validationError && <div className="banner banner-error">{validationError}</div>}

      <form className="card" onSubmit={handleSubmit} style={{ maxWidth: 720 }}>
        <div className="field">
          <label htmlFor="prompt">Question prompt</label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="State the problem exactly as you'd want it drilled..."
          />
        </div>

        <div className="field">
          <label>Topics</label>
          <div className="pill-select">
            {allTopics().map((t) => (
              <button
                type="button"
                key={t.id}
                className={`pill-option${topics.includes(t.id) ? " selected" : ""}`}
                onClick={() => toggleTopic(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2">
          <div className="field">
            <label htmlFor="difficulty">Difficulty</label>
            <select id="difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="answerMode">Answer mode</label>
            <select
              id="answerMode"
              value={answerMode}
              onChange={(e) => setAnswerMode(e.target.value as AnswerMode)}
            >
              <option value="free-text">Free text (AI graded)</option>
              <option value="multiple-choice">Multiple choice</option>
            </select>
          </div>
        </div>

        {answerMode === "multiple-choice" && (
          <div className="field">
            <label>Choices (mark the correct one)</label>
            {choices.map((c, idx) => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <input
                  type="radio"
                  name="correctChoice"
                  checked={correctChoiceId === c.id}
                  onChange={() => setCorrectChoiceId(c.id)}
                  style={{ width: "auto" }}
                />
                <span className="choice-key">{String.fromCharCode(65 + idx)}</span>
                <input
                  type="text"
                  value={c.text}
                  onChange={(e) => updateChoiceText(c.id, e.target.value)}
                  placeholder={`Choice ${String.fromCharCode(65 + idx)}`}
                />
              </div>
            ))}
            <p className="field-hint">Leave choices blank to only use the first N you fill in.</p>
          </div>
        )}

        <div className="field">
          <label htmlFor="canonicalAnswer">Canonical answer</label>
          <input
            id="canonicalAnswer"
            type="text"
            value={canonicalAnswer}
            onChange={(e) => setCanonicalAnswer(e.target.value)}
            placeholder="e.g. 2/3, or a short final answer"
          />
        </div>

        <div className="field" style={{ marginBottom: 8 }}>
          <label htmlFor="explanation">Worked explanation</label>
          <textarea
            id="explanation"
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            rows={6}
            placeholder="Full derivation / reasoning, shown to you after grading."
          />
        </div>

        <button className="btn btn-primary" type="submit">
          Add Question
        </button>
      </form>
    </div>
  );
}

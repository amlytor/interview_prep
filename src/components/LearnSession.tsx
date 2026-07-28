// Learn mode: after (re)reading a topic's note, serve a short burst of 3-5
// questions on it, then show how the mastery score moved. Minimal reading,
// fast into active recall.
import { useState } from "react";
import type { Question } from "../types";
import type { TopicId } from "../lib/topics";
import { topicLabel } from "../lib/topics";
import { useStore } from "../lib/store";
import { computeAllMastery, masteryFor } from "../lib/mastery";
import { QuestionAttempt } from "./QuestionAttempt";
import { MasteryRing } from "./MasteryRing";
import type { Page } from "../App";

interface LearnSessionProps {
  topicId: TopicId;
  questions: Question[]; // the 3-5 questions picked for this session
  onExit: () => void;
  onNavigate: (page: Page) => void;
}

export function LearnSession({ topicId, questions, onExit, onNavigate }: LearnSessionProps) {
  const { data } = useStore();
  const [index, setIndex] = useState(0);
  // Snapshot the score once at session start so the end screen can show the delta.
  const [scoreBefore] = useState(
    () => masteryFor(topicId, computeAllMastery(data.questions, data.attempts)).score,
  );

  const current = questions[index];

  if (!current) {
    // Session complete — compute mastery from the live (post-attempts) data.
    const after = masteryFor(topicId, computeAllMastery(data.questions, data.attempts));
    const delta = after.score - scoreBefore;
    return (
      <div className="card" style={{ textAlign: "center", padding: 40 }}>
        <h3>Practice burst complete</h3>
        <div style={{ display: "flex", justifyContent: "center", gap: 28, alignItems: "center", margin: "18px 0" }}>
          <MasteryRing score={after.score} size={84} />
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{topicLabel(topicId)}</div>
            <div className="muted" style={{ fontSize: 13.5 }}>
              Mastery {scoreBefore} → {after.score}{" "}
              <span style={{ color: delta >= 0 ? "var(--green-600)" : "var(--red-600)", fontWeight: 700 }}>
                ({delta >= 0 ? "+" : ""}
                {delta})
              </span>
            </div>
            {after.mastered && <span className="badge badge-verdict-correct" style={{ marginTop: 6 }}>Mastered</span>}
          </div>
        </div>
        <button className="btn btn-primary" onClick={onExit}>
          Back to topic
        </button>
      </div>
    );
  }

  return (
    <div>
      <p className="muted" style={{ marginBottom: 12, fontSize: 13.5 }}>
        Learn · question {index + 1} of {questions.length}
      </p>
      <QuestionAttempt
        key={current.id}
        question={current}
        source="learn"
        onDone={() => setIndex((i) => i + 1)}
        onNavigate={onNavigate}
      />
    </div>
  );
}

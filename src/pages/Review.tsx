import { aiConfigured } from "../lib/ai";
import { useState } from "react";
import { useStore } from "../lib/store";
import { isDue } from "../lib/srs";
import type { AppData, Question } from "../types";
import { QuestionAttempt } from "../components/QuestionAttempt";
import { ApiKeyBanner } from "../components/ApiKeyBanner";
import type { Page } from "../App";

function buildDueQueue(data: AppData): Question[] {
  const byId = new Map(data.questions.map((q) => [q.id, q]));
  return data.srs
    .filter(isDue)
    .map((s) => byId.get(s.questionId))
    .filter((q): q is Question => q !== undefined);
}

export function Review({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const { data } = useStore();
  const [queue, setQueue] = useState<Question[]>(() => buildDueQueue(data));
  const [index, setIndex] = useState(0);

  function restart() {
    setQueue(buildDueQueue(data));
    setIndex(0);
  }

  const current = queue[index];
  const remaining = queue.length - index;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Review</h1>
          <p className="page-subtitle">
            Questions you missed before, resurfacing on a 2 → 7 → 21 day schedule.
          </p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={restart}>
          Refresh queue
        </button>
      </div>

      {!aiConfigured(data.settings) && <ApiKeyBanner onNavigate={onNavigate} />}

      {queue.length === 0 ? (
        <div className="card empty-state">
          <h3>You're all caught up</h3>
          <p>Nothing is due for review right now. Missed questions from Drill or Mock will appear here on schedule.</p>
          <button className="btn btn-primary" onClick={() => onNavigate("drill")}>
            Go drill some questions
          </button>
        </div>
      ) : !current ? (
        <div className="card empty-state">
          <h3>Review session complete</h3>
          <p>
            You worked through {queue.length} due question{queue.length === 1 ? "" : "s"} this session.
          </p>
          <button className="btn btn-primary" onClick={restart}>
            Check for more
          </button>
        </div>
      ) : (
        <>
          <p className="muted" style={{ marginBottom: 12, fontSize: 13.5 }}>
            {remaining} of {queue.length} due this session
          </p>
          <QuestionAttempt
            key={current.id}
            question={current}
            source="review"
            onDone={() => setIndex((i) => i + 1)}
            onNavigate={onNavigate}
          />
        </>
      )}
    </div>
  );
}

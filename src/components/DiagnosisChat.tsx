// "Why did I get this wrong?" — a short diagnostic conversation about a missed
// question, ending in a stored root cause.
//
// The chat is genuinely multi-turn: you can explain in your own words and the
// coach can ask a follow-up before concluding. Concluding is a separate,
// structured call, so the conversation itself never has to emit JSON.
import { useEffect, useRef, useState } from "react";
import type { Attempt, ChatTurn, MissDiagnosis, Question } from "../types";
import { MISSING_PREREQ_TAG } from "../types";
import { useStore } from "../lib/store";
import { topicLabel } from "../lib/topics";
import type { TopicId } from "../lib/topics";
import { computeAllMastery, masteryFor, prereqClosure } from "../lib/mastery";
import {
  DIAGNOSIS_OPENER,
  concludeDiagnosis,
  diagnosisReply,
  aiConfigured,
  GradingError,
} from "../lib/ai";
import type { DiagnosisContext } from "../lib/ai";
import { ErrorBanner } from "./ApiKeyBanner";
import type { Page } from "../App";

interface DiagnosisChatProps {
  question: Question;
  attempt: Attempt;
  onClose: () => void;
  onNavigate: (page: Page) => void;
  onDrillTopic?: (topicId: TopicId) => void;
}

export function DiagnosisChat({ question, attempt, onClose, onNavigate, onDrillTopic }: DiagnosisChatProps) {
  const { data, saveDiagnosis, updateDiagnosisSummary } = useStore();

  const [turns, setTurns] = useState<ChatTurn[]>(attempt.diagnosis?.transcript ?? []);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"replying" | "concluding" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const [diagnosis, setDiagnosis] = useState<MissDiagnosis | null>(attempt.diagnosis ?? null);
  const [summaryDraft, setSummaryDraft] = useState(attempt.diagnosis?.summary ?? "");
  const [editingSummary, setEditingSummary] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // The prerequisite closure is the ONLY set the model may name as a missing
  // prerequisite, so it's computed here and passed in rather than trusted back.
  const mastery = computeAllMastery(data.questions, data.attempts);
  const prereqOptions = prereqClosure(question.topics, data.studyNotes).map((id) => ({
    id,
    label: topicLabel(id),
    mastery: masteryFor(id, mastery).score,
  }));

  const ctx: DiagnosisContext = {
    prompt: question.prompt,
    userAnswer: attempt.userAnswer,
    canonicalAnswer: question.canonicalAnswer,
    explanation: question.explanation,
    topicLabels: question.topics.map(topicLabel),
    verdict: attempt.verdict,
    prereqOptions,
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  function run(action: () => Promise<void>) {
    setError(null);
    setRetry(() => () => run(action));
    void action().catch((err: unknown) => {
      setError(err instanceof GradingError ? err.message : "Unexpected error.");
      setBusy(null);
    });
  }

  /** Send `next` (already appended locally) and append the coach's reply. */
  function exchange(next: ChatTurn[]) {
    run(async () => {
      setBusy("replying");
      const reply = await diagnosisReply(ctx, next, data.settings);
      setTurns([...next, { role: "assistant", content: reply, at: Date.now() }]);
      setBusy(null);
    });
  }

  function start() {
    exchange([{ role: "user", content: DIAGNOSIS_OPENER, at: Date.now() }]);
  }

  function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    exchange([...turns, { role: "user", content: text, at: Date.now() }]);
  }

  function conclude() {
    run(async () => {
      setBusy("concluding");
      const result = await concludeDiagnosis(ctx, turns, data.settings);
      const full: MissDiagnosis = { ...result, transcript: turns, concludedAt: Date.now(), edited: false };
      saveDiagnosis(attempt.id, full);
      setDiagnosis(full);
      setSummaryDraft(full.summary);
      setBusy(null);
    });
  }

  // The opener is hidden — it's an instruction to the model, not something the
  // user typed, and showing it would read as words put in their mouth.
  const visibleTurns = turns.filter((t, i) => !(i === 0 && t.role === "user"));
  const ready = aiConfigured(data.settings);

  return (
    <div className="diagnosis-panel">
      <div className="diagnosis-header">
        <strong>Why did I get this wrong?</strong>
        <button className="btn btn-secondary btn-sm" onClick={onClose}>
          Close
        </button>
      </div>

      {!ready && (
        <div className="banner banner-warn">
          <p>This needs an AI provider set up.</p>
          <button className="btn btn-secondary btn-sm" onClick={() => onNavigate("settings")}>
            Go to Settings
          </button>
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={retry ?? undefined} />}

      {turns.length === 0 ? (
        <div>
          <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
            A short back-and-forth to work out the real reason — often not the obvious one. The conclusion is
            saved against this attempt and feeds the patterns on your dashboard.
          </p>
          <button className="btn btn-primary" onClick={start} disabled={!ready || busy !== null}>
            {busy ? (
              <>
                <span className="spinner" /> Thinking...
              </>
            ) : (
              "Start the diagnosis"
            )}
          </button>
        </div>
      ) : (
        <>
          <div className="diagnosis-transcript" ref={scrollRef}>
            {visibleTurns.map((t, i) => (
              <div key={i} className={`chat-turn chat-${t.role}`}>
                {t.content}
              </div>
            ))}
            {busy === "replying" && (
              <div className="chat-turn chat-assistant chat-pending">
                <span className="spinner dark" /> thinking...
              </div>
            )}
          </div>

          {!diagnosis && (
            <>
              <div className="diagnosis-composer">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter sends, shift+Enter newlines — this is a chat box.
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder="Explain what you were thinking..."
                  rows={2}
                  disabled={busy !== null}
                />
                <button className="btn btn-primary btn-sm" onClick={send} disabled={busy !== null || !draft.trim()}>
                  Send
                </button>
              </div>
              <button
                className="btn btn-gold btn-sm"
                style={{ marginTop: 10 }}
                onClick={conclude}
                disabled={busy !== null || turns.length < 2}
              >
                {busy === "concluding" ? (
                  <>
                    <span className="spinner" /> Concluding...
                  </>
                ) : (
                  "Save the diagnosis"
                )}
              </button>
            </>
          )}
        </>
      )}

      {diagnosis && (
        <div className="diagnosis-result">
          <div className="tag-row" style={{ marginBottom: 8 }}>
            <span className="badge badge-verdict-partial">{diagnosis.tag}</span>
            {diagnosis.edited && <span className="badge badge-topic">edited</span>}
          </div>

          {editingSummary ? (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <textarea
                value={summaryDraft}
                onChange={(e) => setSummaryDraft(e.target.value)}
                rows={2}
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  updateDiagnosisSummary(attempt.id, summaryDraft);
                  setDiagnosis({ ...diagnosis, summary: summaryDraft, edited: true });
                  setEditingSummary(false);
                }}
              >
                Save
              </button>
            </div>
          ) : (
            <p style={{ marginTop: 0 }}>
              {diagnosis.summary}{" "}
              <button className="link-button" onClick={() => setEditingSummary(true)}>
                edit
              </button>
            </p>
          )}

          {diagnosis.tag === MISSING_PREREQ_TAG && (
            <div style={{ marginTop: 10 }}>
              {diagnosis.recommendedTopics.length > 0 ? (
                <>
                  <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
                    Shore these up first:
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {diagnosis.recommendedTopics.map((t) => (
                      <button
                        key={t}
                        className="btn btn-secondary btn-sm"
                        onClick={() => onDrillTopic?.(t)}
                        disabled={!onDrillTopic}
                      >
                        Drill {topicLabel(t)}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                  Prerequisite unclear — no specific upstream topic was identified.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

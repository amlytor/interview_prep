// Detail view for one topic: rendered study note (editable, with AI drafting),
// mastery + question stats, Learn mode, quiz generation, and the staging queue
// for AI-generated questions.
import { useMemo, useState } from "react";
import type { Attempt, Question } from "../types";
import type { TopicId } from "../lib/topics";
import { allTopics, topicLabel } from "../lib/topics";
import { useStore } from "../lib/store";
import {
  computeAllMastery,
  masteryFor,
  isUnlocked,
  blockingPrereqs,
  topicsWithQuestionsSet,
} from "../lib/mastery";
import {
  generateNoteMarkdown,
  generateQuizFromNote,
  validateQuizDrafts,
  aiConfigured,
  GradingError,
} from "../lib/ai";
import { Markdown } from "./Markdown";
import { MasteryRing } from "./MasteryRing";
import { LearnSession } from "./LearnSession";
import { orderForPractice } from "../lib/practice";
import {
  computeAllCalibration,
  calibrationFor,
  calibrationInstruction,
  describeCalibration,
} from "../lib/calibration";
import { DifficultyBadge } from "./QuestionMeta";
import { ErrorBanner } from "./ApiKeyBanner";
import type { Page } from "../App";

const LEARN_SESSION_SIZE = 5;

/**
 * Pick the questions for a Learn burst: never-attempted questions first, then
 * the ones not seen for longest.
 */
function pickLearnQuestions(questions: Question[], attempts: Attempt[], topicId: TopicId): Question[] {
  const topicQuestions = questions.filter((q) => q.topics.includes(topicId));
  return orderForPractice(topicQuestions, attempts).slice(0, LEARN_SESSION_SIZE);
}

interface TopicDetailProps {
  topicId: TopicId;
  onBack: () => void;
  onNavigate: (page: Page) => void;
  onDrillTopic: (topicId: TopicId) => void;
}

export function TopicDetail({ topicId, onBack, onNavigate, onDrillTopic }: TopicDetailProps) {
  const {
    data,
    setNoteBody,
    stageQuestions,
    approveStagedQuestion,
    rejectStagedQuestion,
    approveCleanStaged,
    markStagedRevealed,
    setTopicPrereqs,
    deleteCustomTopic,
    topicDeletionImpact,
  } = useStore();

  const note = data.studyNotes.find((n) => n.topicId === topicId);
  const isCustom = data.customTopics.some((t) => t.id === topicId);

  const [mode, setMode] = useState<"view" | "edit" | "learn">("view");
  const [editingPrereqs, setEditingPrereqs] = useState(false);
  // Reveals are per-session UI state as well as persisted, so the card updates
  // instantly without waiting on a store round-trip.
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [editorText, setEditorText] = useState("");
  const [learnQuestions, setLearnQuestions] = useState<Question[]>([]);
  const [aiDraft, setAiDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState<"quiz" | "validating" | "note" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<(() => void) | null>(null);

  const mastery = useMemo(() => computeAllMastery(data.questions, data.attempts), [data.questions, data.attempts]);
  const notesById = useMemo(() => new Map(data.studyNotes.map((n) => [n.topicId, n])), [data.studyNotes]);
  const withQuestions = useMemo(() => topicsWithQuestionsSet(data.questions), [data.questions]);
  const allCalibration = useMemo(
    () => computeAllCalibration(data.questions, data.attempts),
    [data.questions, data.attempts],
  );

  if (!note) return null; // one note per topic is guaranteed by seeding

  const m = masteryFor(topicId, mastery);
  const unlocked = isUnlocked(topicId, notesById, mastery, withQuestions);
  const blockers = blockingPrereqs(topicId, notesById, mastery, withQuestions);
  const topicQuestions = data.questions.filter((q) => q.topics.includes(topicId));
  const staged = data.stagedQuestions.filter((q) => q.topics.includes(topicId));
  const cleanStaged = staged.filter((q) => q.validation?.status === "clean" && !q.answerSeen);
  const suspectStaged = staged.filter((q) => q.validation?.status === "suspect");
  const calib = calibrationFor(topicId, allCalibration);
  const calibration = calibrationInstruction(calib);

  function runAction(action: () => Promise<void>) {
    setError(null);
    setLastAction(() => () => runAction(action));
    void action().catch((err: unknown) => {
      setError(err instanceof GradingError ? err.message : "Unexpected error.");
      setBusy(null);
    });
  }

  function handleGenerateQuiz() {
    runAction(async () => {
      setBusy("quiz");
      const existingPrompts = [...topicQuestions, ...staged].map((q) => q.prompt);
      const drafts = await generateQuizFromNote(note!, existingPrompts, data.settings, calibration);
      // Check the batch before staging, so clean ones can be banked unseen.
      // validateQuizDrafts never throws — a failed check marks everything
      // suspect, which means "inspect it yourself", not "silently trust it".
      setBusy("validating");
      const verdicts = await validateQuizDrafts(drafts, data.settings);
      stageQuestions(drafts.map((d, i) => ({ ...d, validation: verdicts[i] })));
      setBulkMessage(null);
      setBusy(null);
    });
  }

  function handleGenerateNote() {
    runAction(async () => {
      setBusy("note");
      const draft = await generateNoteMarkdown(
        note!.title,
        note!.body.trim().length > 0 ? note!.body : null,
        data.settings,
      );
      setAiDraft(draft);
      setBusy(null);
    });
  }

  // Replacing an authored note's body always requires explicit confirmation.
  function applyDraft() {
    if (!aiDraft) return;
    if (note!.source === "authored") {
      const ok = confirm(
        "This note is human-authored. Replace its entire body with the AI draft?\n\n(Choose Cancel and use 'Append' to keep your text.)",
      );
      if (!ok) return;
    }
    setNoteBody(topicId, aiDraft, "ai");
    setAiDraft(null);
  }

  function appendDraft() {
    if (!aiDraft) return;
    setNoteBody(topicId, `${note!.body}\n\n---\n\n## AI additions\n\n${aiDraft}`, note!.source);
    setAiDraft(null);
  }

  function startLearn() {
    setLearnQuestions(pickLearnQuestions(data.questions, data.attempts, topicId));
    setMode("learn");
  }

  // Spell out exactly what goes, since questions are unrecoverable afterwards.
  function handleDelete() {
    const impact = topicDeletionImpact(topicId);
    const losses = [
      `the "${note!.title}" study note`,
      impact.questions > 0 && `${impact.questions} question${impact.questions === 1 ? "" : "s"}`,
      impact.staged > 0 && `${impact.staged} staged question${impact.staged === 1 ? "" : "s"}`,
    ].filter(Boolean);
    const dependentWarning =
      impact.dependents.length > 0
        ? `\n\n${impact.dependents.join(", ")} list${impact.dependents.length === 1 ? "s" : ""} this as a prerequisite; ` +
          `that link will be dropped and those topics may unlock earlier.`
        : "";

    if (
      confirm(
        `Delete this topic?\n\nThis removes ${losses.join(", ")}.` +
          `${dependentWarning}\n\nYour attempt history is kept. This cannot be undone.`,
      )
    ) {
      deleteCustomTopic(topicId);
      onBack();
    }
  }

  if (mode === "learn") {
    return (
      <div>
        <button className="btn btn-secondary btn-sm" style={{ marginBottom: 16 }} onClick={() => setMode("view")}>
          ← Exit learn mode
        </button>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">{note.title} — quick reference</div>
          <details>
            <summary style={{ cursor: "pointer", fontSize: 13.5, color: "var(--blue-600)" }}>
              Peek at the note
            </summary>
            <Markdown source={note.body} />
          </details>
        </div>
        <LearnSession
          topicId={topicId}
          questions={learnQuestions}
          onExit={() => setMode("view")}
          onNavigate={onNavigate}
        />
      </div>
    );
  }

  return (
    <div>
      <button className="btn btn-secondary btn-sm" style={{ marginBottom: 16 }} onClick={onBack}>
        ← All topics
      </button>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
          <MasteryRing score={m.score} size={72} locked={!unlocked} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2 style={{ marginBottom: 2 }}>{note.title}</h2>
            <div className="muted" style={{ fontSize: 13 }}>
              {m.attempts} attempt{m.attempts === 1 ? "" : "s"} · {topicQuestions.length} question
              {topicQuestions.length === 1 ? "" : "s"} in bank
              {note.prereqs.length > 0 && <> · builds on {note.prereqs.map(topicLabel).join(", ")}</>}
            </div>
            <div className={`calibration-line calibration-${calib.verdict}`}>
              Difficulty: {describeCalibration(calib)}
            </div>
            <div className="tag-row" style={{ marginTop: 8 }}>
              {m.mastered && <span className="badge badge-verdict-correct">Mastered</span>}
              {!m.mastered && m.proficient && <span className="badge badge-topic">Proficient</span>}
              {!unlocked && (
                <span className="badge badge-verdict-partial">Locked — needs {blockers.join(", ")}</span>
              )}
              {note.modified && <span className="badge badge-topic">Edited</span>}
              {note.source === "ai" && <span className="badge badge-verdict-partial">AI-drafted</span>}
              {isCustom && <span className="badge badge-topic">Your topic</span>}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              className="btn btn-gold"
              onClick={startLearn}
              disabled={!unlocked || topicQuestions.length === 0}
              title={
                !unlocked
                  ? `Locked — get proficient at ${blockers.join(", ")} first`
                  : topicQuestions.length === 0
                    ? "No questions for this topic yet — generate a quiz first"
                    : undefined
              }
            >
              Learn ({Math.min(LEARN_SESSION_SIZE, topicQuestions.length)} questions)
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => onDrillTopic(topicId)}
              disabled={topicQuestions.length === 0}
            >
              Drill this topic
            </button>
          </div>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={lastAction ?? undefined} />}
      {!aiConfigured(data.settings) && (
        <div className="banner banner-warn">
          <p>AI quiz generation and note drafting need an Anthropic API key.</p>
          <button className="btn btn-secondary btn-sm" onClick={() => onNavigate("settings")}>
            Go to Settings
          </button>
        </div>
      )}

      {/* ---------- Staging queue: AI questions awaiting approval ----------
          Answers stay hidden by default. Reading one burns the question as
          practice, so "bank it unseen" is the primary action and revealing is
          the deliberate exception. */}
      {staged.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Staged questions — {staged.length} awaiting approval</div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
            {cleanStaged.length > 0 && (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  const n = approveCleanStaged(topicId);
                  setBulkMessage(`Banked ${n} checked question${n === 1 ? "" : "s"} unseen.`);
                }}
              >
                Bank {cleanStaged.length} checked question{cleanStaged.length === 1 ? "" : "s"} unseen
              </button>
            )}
            <span className="muted" style={{ fontSize: 13 }}>
              {suspectStaged.length > 0
                ? `${suspectStaged.length} flagged for a look.`
                : cleanStaged.length > 0
                  ? "All passed the automatic check."
                  : "Not automatically checked — review before approving."}
            </span>
          </div>
          {bulkMessage && (
            <div className="banner banner-success" style={{ marginBottom: 14 }}>
              <p>{bulkMessage}</p>
            </div>
          )}

          {staged.map((q) => {
            const revealed = revealedIds.has(q.id) || q.answerSeen === true;
            const flagged = q.validation?.status === "suspect";
            return (
              <div key={q.id} className={`staged-item${flagged ? " flagged" : ""}`}>
                <div className="question-meta-row" style={{ marginBottom: 6 }}>
                  <DifficultyBadge difficulty={q.difficulty} />
                  <span className="badge badge-topic">{q.answerMode}</span>
                  {q.validation?.status === "clean" && <span className="badge badge-verdict-correct">checked</span>}
                  {flagged && <span className="badge badge-verdict-partial">needs a look</span>}
                  {revealed && <span className="badge badge-topic">answer seen</span>}
                </div>

                <p style={{ fontWeight: 600, marginBottom: 6 }}>{q.prompt}</p>
                {q.technique && (
                  <p className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
                    Tests: {q.technique}
                    {q.difficultyRationale && ` · ${q.difficultyRationale}`}
                  </p>
                )}

                {flagged && q.validation!.issues.length > 0 && (
                  <ul className="staged-issues">
                    {q.validation!.issues.map((issue, i) => (
                      <li key={i}>{issue}</li>
                    ))}
                  </ul>
                )}

                {/* Multiple-choice options are part of the question, but which
                    one is correct is not — so options show, the tick doesn't. */}
                {q.choices && (
                  <ul style={{ margin: "0 0 8px", paddingLeft: 20, fontSize: 13.5 }}>
                    {q.choices.map((c) => (
                      <li key={c.id} style={{ color: revealed && c.id === q.correctChoiceId ? "var(--green-600)" : undefined }}>
                        {c.text}
                        {revealed && c.id === q.correctChoiceId && " ✓"}
                      </li>
                    ))}
                  </ul>
                )}

                {revealed ? (
                  <div className="staged-answer">
                    <p style={{ fontSize: 13.5, marginBottom: 4 }}>
                      <strong>Answer:</strong> {q.canonicalAnswer}
                    </p>
                    <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
                      {q.explanation}
                    </p>
                  </div>
                ) : (
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ marginBottom: 10 }}
                    onClick={() => {
                      setRevealedIds((prev) => new Set(prev).add(q.id));
                      markStagedRevealed(q.id);
                    }}
                  >
                    Reveal answer (burns it as practice)
                  </button>
                )}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => approveStagedQuestion(q.id, revealed)}
                  >
                    {revealed ? "Add to bank" : "Bank it unseen"}
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => rejectStagedQuestion(q.id)}>
                    Reject
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ---------- The study note ---------- */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>
            Study note
            {note.lastEdited && (
              <span className="muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                {" "}
                · edited {new Date(note.lastEdited).toLocaleDateString()}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {mode === "view" && (
              <>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setEditorText(note.body);
                    setMode("edit");
                  }}
                >
                  Edit
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleGenerateNote}
                  disabled={busy !== null || !aiConfigured(data.settings)}
                >
                  {busy === "note" ? (
                    <>
                      <span className="spinner dark" /> Drafting...
                    </>
                  ) : (
                    "Expand with AI"
                  )}
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleGenerateQuiz}
                  disabled={busy !== null || !aiConfigured(data.settings)}
                >
                  {busy === "quiz" || busy === "validating" ? (
                    <>
                      <span className="spinner" /> {busy === "quiz" ? "Generating..." : "Checking..."}
                    </>
                  ) : (
                    "Generate quiz from note"
                  )}
                </button>
              </>
            )}
          </div>
        </div>

        {/* AI draft preview — never applied without an explicit click. */}
        {aiDraft && (
          <div className="ai-draft-panel">
            <div className="card-title">AI draft — review before applying</div>
            <Markdown source={aiDraft} />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn btn-primary btn-sm" onClick={applyDraft}>
                Replace note body
              </button>
              <button className="btn btn-secondary btn-sm" onClick={appendDraft}>
                Append to note
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => setAiDraft(null)}>
                Discard
              </button>
            </div>
          </div>
        )}

        {mode === "edit" ? (
          <>
            <div className="note-editor-grid">
              <div>
                <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--gray-600)" }}>
                  Markdown ($...$ and $$...$$ for math)
                </label>
                <textarea
                  value={editorText}
                  onChange={(e) => setEditorText(e.target.value)}
                  rows={24}
                  style={{ fontFamily: "ui-monospace, Consolas, monospace", fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--gray-600)" }}>Live preview</label>
                <div className="note-preview">
                  <Markdown source={editorText} />
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                className="btn btn-primary"
                onClick={() => {
                  // Manual edits keep the authored provenance; only a full AI
                  // replacement flips source to "ai".
                  setNoteBody(topicId, editorText, note.source);
                  setMode("view");
                }}
              >
                Save note
              </button>
              <button className="btn btn-secondary" onClick={() => setMode("view")}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <Markdown source={note.body} />
        )}
      </div>

      {/* ---------- Prerequisites + deletion, for user-created topics ---------- */}
      {isCustom && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>
              Topic settings
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => setEditingPrereqs((v) => !v)}>
              {editingPrereqs ? "Done" : "Edit prerequisites"}
            </button>
          </div>

          <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
            Prerequisites decide where this topic sits in the knowledge tree, when it unlocks, and which topics
            get spaced-repetition credit when you answer it correctly.
          </p>

          {editingPrereqs ? (
            <div className="prereq-picker">
              {allTopics()
                .filter((t) => t.id !== topicId)
                .map((t) => {
                  const checked = note.prereqs.includes(t.id);
                  return (
                    <label key={t.id} className={`prereq-option${checked ? " checked" : ""}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setTopicPrereqs(
                            topicId,
                            checked ? note.prereqs.filter((p) => p !== t.id) : [...note.prereqs, t.id],
                          )
                        }
                      />
                      {t.label}
                    </label>
                  );
                })}
            </div>
          ) : (
            <div className="tag-row">
              {note.prereqs.length === 0 ? (
                <span className="muted" style={{ fontSize: 13.5 }}>
                  No prerequisites — this sits in the Foundation tier.
                </span>
              ) : (
                note.prereqs.map((p) => (
                  <span key={p} className="prereq-chip met">
                    {topicLabel(p)}
                  </span>
                ))
              )}
            </div>
          )}

          <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--gray-200)" }}>
            <button className="btn btn-danger btn-sm" onClick={handleDelete}>
              Delete this topic
            </button>
            <p className="field-hint" style={{ marginTop: 8 }}>
              Removes the topic, its note, and its questions. Your attempt history is kept — only seeded topics
              are undeletable.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

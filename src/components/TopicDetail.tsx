// Detail view for one topic: rendered study note (editable, with AI drafting),
// mastery + question stats, Learn mode, quiz generation, and the staging queue
// for AI-generated questions.
import { useMemo, useState } from "react";
import type { Attempt, Question } from "../types";
import type { TopicId } from "../lib/topics";
import { topicLabel } from "../lib/topics";
import { useStore } from "../lib/store";
import {
  computeAllMastery,
  masteryFor,
  isUnlocked,
  blockingPrereqs,
  topicsWithQuestionsSet,
} from "../lib/mastery";
import { generateNoteMarkdown, generateQuizFromNote, GradingError } from "../lib/anthropic";
import { Markdown } from "./Markdown";
import { MasteryRing } from "./MasteryRing";
import { LearnSession } from "./LearnSession";
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
  const lastAttempt = new Map<string, number>();
  for (const a of attempts) {
    lastAttempt.set(a.questionId, Math.max(lastAttempt.get(a.questionId) ?? 0, a.timestamp));
  }
  return [...topicQuestions]
    .sort((a, b) => (lastAttempt.get(a.id) ?? 0) - (lastAttempt.get(b.id) ?? 0))
    .slice(0, LEARN_SESSION_SIZE);
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
  } = useStore();

  const note = data.studyNotes.find((n) => n.topicId === topicId);

  const [mode, setMode] = useState<"view" | "edit" | "learn">("view");
  const [editorText, setEditorText] = useState("");
  const [learnQuestions, setLearnQuestions] = useState<Question[]>([]);
  const [aiDraft, setAiDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState<"quiz" | "note" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<(() => void) | null>(null);

  const mastery = useMemo(() => computeAllMastery(data.questions, data.attempts), [data.questions, data.attempts]);
  const notesById = useMemo(() => new Map(data.studyNotes.map((n) => [n.topicId, n])), [data.studyNotes]);
  const withQuestions = useMemo(() => topicsWithQuestionsSet(data.questions), [data.questions]);

  if (!note) return null; // one note per topic is guaranteed by seeding

  const m = masteryFor(topicId, mastery);
  const unlocked = isUnlocked(topicId, notesById, mastery, withQuestions);
  const blockers = blockingPrereqs(topicId, notesById, mastery, withQuestions);
  const topicQuestions = data.questions.filter((q) => q.topics.includes(topicId));
  const staged = data.stagedQuestions.filter((q) => q.topics.includes(topicId));

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
      const drafts = await generateQuizFromNote(note!, existingPrompts, data.settings.apiKey, data.settings.model);
      stageQuestions(drafts);
      setBusy(null);
    });
  }

  function handleGenerateNote() {
    runAction(async () => {
      setBusy("note");
      const draft = await generateNoteMarkdown(
        note!.title,
        note!.body.trim().length > 0 ? note!.body : null,
        data.settings.apiKey,
        data.settings.model,
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
            <div className="tag-row" style={{ marginTop: 8 }}>
              {m.mastered && <span className="badge badge-verdict-correct">Mastered</span>}
              {!m.mastered && m.proficient && <span className="badge badge-topic">Proficient</span>}
              {!unlocked && (
                <span className="badge badge-verdict-partial">Locked — needs {blockers.join(", ")}</span>
              )}
              {note.modified && <span className="badge badge-topic">Edited</span>}
              {note.source === "ai" && <span className="badge badge-verdict-partial">AI-drafted</span>}
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
      {!data.settings.apiKey && (
        <div className="banner banner-warn">
          <p>AI quiz generation and note drafting need an Anthropic API key.</p>
          <button className="btn btn-secondary btn-sm" onClick={() => onNavigate("settings")}>
            Go to Settings
          </button>
        </div>
      )}

      {/* ---------- Staging queue: AI questions awaiting approval ---------- */}
      {staged.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Staged AI questions — review before they enter the bank ({staged.length})</div>
          {staged.map((q) => (
            <div key={q.id} className="staged-item">
              <div className="question-meta-row" style={{ marginBottom: 6 }}>
                <DifficultyBadge difficulty={q.difficulty} />
                <span className="badge badge-topic">{q.answerMode}</span>
              </div>
              <p style={{ fontWeight: 600, marginBottom: 6 }}>{q.prompt}</p>
              {q.choices && (
                <ul style={{ margin: "0 0 8px", paddingLeft: 20, fontSize: 13.5 }}>
                  {q.choices.map((c) => (
                    <li key={c.id} style={{ color: c.id === q.correctChoiceId ? "var(--green-600)" : undefined }}>
                      {c.text}
                      {c.id === q.correctChoiceId && " ✓"}
                    </li>
                  ))}
                </ul>
              )}
              <p style={{ fontSize: 13.5, marginBottom: 4 }}>
                <strong>Answer:</strong> {q.canonicalAnswer}
              </p>
              <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
                {q.explanation}
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={() => approveStagedQuestion(q.id)}>
                  Approve → add to bank
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => rejectStagedQuestion(q.id)}>
                  Reject
                </button>
              </div>
            </div>
          ))}
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
                  disabled={busy !== null || !data.settings.apiKey}
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
                  disabled={busy !== null || !data.settings.apiKey}
                >
                  {busy === "quiz" ? (
                    <>
                      <span className="spinner" /> Generating...
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
    </div>
  );
}

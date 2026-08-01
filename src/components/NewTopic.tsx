// Add a topic of your own: paste raw notes, optionally let the model file them
// into the existing taxonomy and rewrite them into the app's note format, then
// approve. Nothing is saved until you press a button — the AI step only ever
// produces a suggestion.
import { useState } from "react";
import { useStore } from "../lib/store";
import type { TopicId } from "../lib/topics";
import { allTopics, topicLabel } from "../lib/topics";
import { classifyNotes, aiConfigured, GradingError } from "../lib/ai";
import type { ClassifiedNote } from "../lib/ai";
import { Markdown } from "./Markdown";
import { ErrorBanner } from "./ApiKeyBanner";
import type { Page } from "../App";

const BLANK_TEMPLATE = `## Core idea

## When to use (trigger)

## Key formulas

## Worked example

## Common mistakes
`;

interface NewTopicProps {
  onCreated: (topicId: TopicId) => void;
  onCancel: () => void;
  onNavigate: (page: Page) => void;
}

export function NewTopic({ onCreated, onCancel, onNavigate }: NewTopicProps) {
  const { data, addCustomTopic, setNoteBody } = useStore();

  const [rawNotes, setRawNotes] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState(BLANK_TEMPLATE);
  const [prereqs, setPrereqs] = useState<TopicId[]>([]);
  const [suggestion, setSuggestion] = useState<ClassifiedNote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // Not memoized: allTopics() reads a module registry the store refreshes, so a
  // memo keyed on anything visible here would go stale.
  const topics = allTopics();
  const aiReady = aiConfigured(data.settings);

  function handleAnalyze() {
    setError(null);
    setBusy(true);
    void classifyNotes(rawNotes, topics, data.settings)
      .then((result) => {
        setSuggestion(result);
        setBusy(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof GradingError ? err.message : "Unexpected error while analyzing your notes.");
        setBusy(false);
      });
  }

  /** Pull the suggestion into the form as a new topic, leaving it fully editable. */
  function acceptAsNew() {
    if (!suggestion) return;
    setTitle(suggestion.title);
    setBody(suggestion.body);
    setPrereqs(suggestion.prereqs);
    setSuggestion(null);
  }

  /** File the suggestion under a topic that already exists, appending to its note. */
  function acceptIntoExisting(existingId: TopicId) {
    if (!suggestion) return;
    const existing = data.studyNotes.find((n) => n.topicId === existingId);
    if (!existing) return;
    const heading = title.trim() || suggestion.title;
    setNoteBody(
      existingId,
      `${existing.body}\n\n---\n\n## From my notes — ${heading}\n\n${suggestion.body}`,
      existing.source,
    );
    onCreated(existingId);
  }

  async function handleCreate() {
    const finalTitle = title.trim();
    if (!finalTitle) {
      setError("Give the topic a title before creating it.");
      return;
    }
    // The id is assigned inside the commit, so it only exists once the write
    // has landed — which is also the only point at which navigating to it is
    // meaningful.
    const topicId = await addCustomTopic({ title: finalTitle, prereqs, body });
    if (!topicId) {
      setError("Couldn't save the new topic — this browser is refusing to store data.");
      return;
    }
    onCreated(topicId);
  }

  return (
    <div>
      <button className="btn btn-secondary btn-sm" style={{ marginBottom: 16 }} onClick={onCancel}>
        ← All topics
      </button>

      <div className="page-header">
        <div>
          <h1>New topic</h1>
          <p className="page-subtitle">
            Your own topics work exactly like the seeded ones — mastery ring, unlock rules, Learn mode, quiz
            generation, and spaced-repetition credit all apply.
          </p>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* ---------- Paste raw notes and let the model file them ---------- */}
      <div className="card">
        <div className="card-title">Start from your own notes (optional)</div>
        <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
          Paste anything — scribbles from Zhou, a half-remembered trick, a bullet list. The model decides whether
          it belongs under a topic you already have or deserves its own, suggests prerequisites, and rewrites it
          into the standard note format. You review everything before it's saved.
        </p>
        <div className="field">
          <textarea
            value={rawNotes}
            onChange={(e) => setRawNotes(e.target.value)}
            rows={8}
            placeholder={
              "e.g. Reflection principle for random walks — count paths that touch a level by reflecting the ones that cross it. Use for 'probability the walk ever hits +k' and ballot-problem style questions. Careful: only works for symmetric walks."
            }
          />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            className="btn btn-primary"
            onClick={handleAnalyze}
            disabled={busy || !aiReady || rawNotes.trim().length < 20}
            title={
              !aiReady
                ? "Set up an AI provider in Settings first"
                : rawNotes.trim().length < 20
                  ? "Paste a bit more for the model to work with"
                  : undefined
            }
          >
            {busy ? (
              <>
                <span className="spinner" /> Organizing...
              </>
            ) : (
              "Organize with AI"
            )}
          </button>
          {!aiReady && (
            <button className="btn btn-secondary btn-sm" onClick={() => onNavigate("settings")}>
              Set up a provider
            </button>
          )}
        </div>
      </div>

      {/* ---------- The model's proposal, pending approval ---------- */}
      {suggestion && (
        <div className="ai-draft-panel">
          <div className="card-title">Suggestion — nothing is saved yet</div>
          {suggestion.existingTopicId ? (
            <p style={{ marginTop: 0 }}>
              This looks like it belongs under <strong>{topicLabel(suggestion.existingTopicId)}</strong>, which you
              already have.
              {suggestion.reasoning && <> {suggestion.reasoning}</>}
            </p>
          ) : (
            <p style={{ marginTop: 0 }}>
              No existing topic covers this — suggested as a new topic called <strong>{suggestion.title}</strong>.
              {suggestion.reasoning && <> {suggestion.reasoning}</>}
            </p>
          )}
          {suggestion.prereqs.length > 0 && (
            <div className="tag-row" style={{ marginBottom: 10 }}>
              <span className="muted" style={{ fontSize: 13 }}>
                Suggested prerequisites:
              </span>
              {suggestion.prereqs.map((p) => (
                <span key={p} className="prereq-chip met">
                  {topicLabel(p)}
                </span>
              ))}
            </div>
          )}

          <Markdown source={suggestion.body} />

          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            {suggestion.existingTopicId && (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => acceptIntoExisting(suggestion.existingTopicId!)}
              >
                Append to {topicLabel(suggestion.existingTopicId)}
              </button>
            )}
            <button
              className={`btn btn-sm ${suggestion.existingTopicId ? "btn-secondary" : "btn-primary"}`}
              onClick={acceptAsNew}
            >
              {suggestion.existingTopicId ? "Make it a new topic anyway" : "Use this"}
            </button>
            <button className="btn btn-danger btn-sm" onClick={() => setSuggestion(null)}>
              Discard
            </button>
          </div>
        </div>
      )}

      {/* ---------- The topic itself ---------- */}
      <div className="card">
        <div className="card-title">Topic details</div>

        <div className="field">
          <label htmlFor="topicTitle">Title</label>
          <input
            id="topicTitle"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Reflection principle"
          />
          <p className="field-hint">Short and technique-shaped, like the seeded topics.</p>
        </div>

        <div className="field">
          <label>Prerequisites</label>
          <div className="prereq-picker">
            {topics.map((t) => {
              const checked = prereqs.includes(t.id);
              return (
                <label key={t.id} className={`prereq-option${checked ? " checked" : ""}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setPrereqs((prev) => (checked ? prev.filter((p) => p !== t.id) : [...prev, t.id]))
                    }
                  />
                  {t.label}
                </label>
              );
            })}
          </div>
          <p className="field-hint">
            What you'd need to understand first. This places the topic in the knowledge tree and decides when it
            unlocks — leave it empty and it lands in the Foundation tier.
          </p>
        </div>

        <div className="field">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label htmlFor="topicBody">Note ($...$ and $$...$$ for math)</label>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowPreview((v) => !v)}>
              {showPreview ? "Hide preview" : "Preview"}
            </button>
          </div>
          {showPreview ? (
            <div className="note-preview">
              <Markdown source={body} />
            </div>
          ) : (
            <textarea
              id="topicBody"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={18}
              style={{ fontFamily: "ui-monospace, Consolas, monospace", fontSize: 13 }}
            />
          )}
          <p className="field-hint">
            You can leave this as the empty template and fill it in later, or use "Expand with AI" on the topic
            page once it exists.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" onClick={handleCreate}>
            Create topic
          </button>
          <button className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

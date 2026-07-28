// The knowledge tree: every topic laid out in prerequisite tiers, with a
// mastery ring, locked/unlocked state, and a recommended next topic. Clicking
// a topic opens its detail view (note, editor, Learn mode, quiz generation).
import { useMemo, useState } from "react";
import { useStore } from "../lib/store";
import type { TopicId } from "../lib/topics";
import { topicLabel } from "../lib/topics";
import {
  computeAllMastery,
  masteryFor,
  isUnlocked,
  blockingPrereqs,
  topicsWithQuestionsSet,
  topicDepths,
  recommendNextTopic,
} from "../lib/mastery";
import { MasteryRing } from "../components/MasteryRing";
import { TopicDetail } from "../components/TopicDetail";
import { NewTopic } from "../components/NewTopic";
import type { Page } from "../App";

const TIER_NAMES = ["Foundation", "Core techniques", "Composite techniques", "Advanced"];

interface TopicsProps {
  onNavigate: (page: Page) => void;
  onDrillTopic: (topicId: TopicId) => void;
}

export function Topics({ onNavigate, onDrillTopic }: TopicsProps) {
  const { data } = useStore();
  const [selected, setSelected] = useState<TopicId | null>(null);
  const [creating, setCreating] = useState(false);

  const mastery = useMemo(() => computeAllMastery(data.questions, data.attempts), [data.questions, data.attempts]);
  const notesById = useMemo(() => new Map(data.studyNotes.map((n) => [n.topicId, n])), [data.studyNotes]);
  const withQuestions = useMemo(() => topicsWithQuestionsSet(data.questions), [data.questions]);
  const depths = useMemo(() => topicDepths(data.studyNotes), [data.studyNotes]);
  const recommended = useMemo(
    () => recommendNextTopic(data.studyNotes, data.questions, data.attempts),
    [data.studyNotes, data.questions, data.attempts],
  );

  if (creating) {
    return (
      <NewTopic
        onCreated={(topicId) => {
          setCreating(false);
          setSelected(topicId);
        }}
        onCancel={() => setCreating(false)}
        onNavigate={onNavigate}
      />
    );
  }

  if (selected) {
    return (
      <TopicDetail
        topicId={selected}
        onBack={() => setSelected(null)}
        onNavigate={onNavigate}
        onDrillTopic={onDrillTopic}
      />
    );
  }

  // Group topics into tiers by their depth in the prerequisite DAG.
  const maxDepth = Math.max(...Array.from(depths.values()), 0);
  const tiers: TopicId[][] = [];
  for (let d = 0; d <= maxDepth; d++) {
    const tier = data.studyNotes
      .filter((n) => (depths.get(n.topicId) ?? 0) === d)
      .map((n) => n.topicId)
      .sort((a, b) => topicLabel(a).localeCompare(topicLabel(b)));
    if (tier.length > 0) tiers.push(tier);
  }

  const masteredCount = data.studyNotes.filter((n) => masteryFor(n.topicId, mastery).mastered).length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Topics</h1>
          <p className="page-subtitle">
            Your knowledge tree — {masteredCount} of {data.studyNotes.length} topics mastered. Proficiency (60+)
            unlocks dependent topics; 80+ with 5 attempts counts as mastered.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          + New topic
        </button>
      </div>

      {recommended && (
        <div className="banner banner-info">
          <p>
            <strong>Next up:</strong> {topicLabel(recommended)} — prerequisites met, score{" "}
            {masteryFor(recommended, mastery).score}/100.
          </p>
          <button className="btn btn-primary btn-sm" onClick={() => setSelected(recommended)}>
            Study now
          </button>
        </div>
      )}

      {tiers.map((tier, d) => (
        <div key={d} style={{ marginBottom: 26 }}>
          <h3 className="tier-heading">{TIER_NAMES[d] ?? `Tier ${d + 1}`}</h3>
          <div className="topic-grid">
            {tier.map((topicId) => {
              const m = masteryFor(topicId, mastery);
              const unlocked = isUnlocked(topicId, notesById, mastery, withQuestions);
              const blockers = blockingPrereqs(topicId, notesById, mastery, withQuestions);
              const note = notesById.get(topicId);
              const questionCount = data.questions.filter((q) => q.topics.includes(topicId)).length;
              const stagedCount = data.stagedQuestions.filter((q) => q.topics.includes(topicId)).length;

              return (
                <button
                  key={topicId}
                  className={`topic-card${unlocked ? "" : " locked"}`}
                  onClick={() => setSelected(topicId)}
                >
                  <MasteryRing score={m.score} size={52} locked={!unlocked} />
                  <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                    <div className="topic-card-title">{topicLabel(topicId)}</div>
                    <div className="topic-card-sub">
                      {unlocked ? (
                        <>
                          {m.mastered
                            ? "Mastered"
                            : m.proficient
                              ? "Proficient"
                              : m.attempts > 0
                                ? `${m.attempts} attempt${m.attempts === 1 ? "" : "s"}`
                                : "Not started"}
                          {questionCount === 0 && " · no questions yet"}
                          {stagedCount > 0 && ` · ${stagedCount} staged`}
                        </>
                      ) : (
                        <>Locked — needs {blockers.join(", ")}</>
                      )}
                    </div>
                    {note && note.prereqs.length > 0 && (
                      <div className="topic-card-prereqs">
                        {note.prereqs.map((p) => (
                          <span
                            key={p}
                            className={`prereq-chip${masteryFor(p, mastery).proficient || !withQuestions.has(p) ? " met" : ""}`}
                          >
                            {topicLabel(p)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

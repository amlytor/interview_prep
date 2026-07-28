import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AppData, Attempt, AttemptSource, Question, Settings, StudyNote, Verdict } from "../types";
import type { TopicId } from "./topics";
import { registerCustomTopics, slugifyTopic } from "./topics";
import { exportToFile, importFromFile, loadData, saveData } from "./storage";
import { applyTrickleCredit, scheduleAfterAttempt } from "./srs";

interface RecordAttemptInput {
  questionId: string;
  source: AttemptSource;
  answerMode: Attempt["answerMode"];
  userAnswer: string;
  verdict: Verdict;
  feedback?: string;
  whyMissed?: Attempt["whyMissed"];
  timeSpentSec?: number;
}

export type NewQuestion = Omit<Question, "id" | "createdAt">;

export interface NewTopicInput {
  title: string;
  prereqs: TopicId[];
  body: string;
}

/** What deleting a custom topic would remove, for the confirmation prompt. */
export interface TopicDeletionImpact {
  questions: number;
  staged: number;
  dependents: string[];
}

interface StoreValue {
  data: AppData;
  addQuestion: (q: Omit<Question, "id" | "createdAt" | "custom" | "origin">) => Question;
  recordAttempt: (input: RecordAttemptInput) => Attempt;
  updateSettings: (partial: Partial<Settings>) => void;
  // Custom topics: a user-created topic is a study note plus a taxonomy entry,
  // so it flows through mastery, the knowledge tree, and Learn mode unchanged.
  addCustomTopic: (input: NewTopicInput) => TopicId;
  deleteCustomTopic: (topicId: TopicId) => void;
  setTopicPrereqs: (topicId: TopicId, prereqs: TopicId[]) => void;
  topicDeletionImpact: (topicId: TopicId) => TopicDeletionImpact;
  // Study notes
  setNoteBody: (topicId: TopicId, body: string, source: StudyNote["source"]) => void;
  // AI question staging: generated questions sit in stagedQuestions until
  // explicitly approved into the live bank (or rejected).
  stageQuestions: (drafts: NewQuestion[]) => void;
  approveStagedQuestion: (id: string) => void;
  rejectStagedQuestion: (id: string) => void;
  exportData: () => void;
  importData: (file: File) => Promise<void>;
  resetAllData: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(() => {
    const loaded = loadData();
    // Seed the display-name registry before the first render, so custom topics
    // never flash their raw slug.
    registerCustomTopics(loaded.customTopics);
    return loaded;
  });

  // topicLabel() reads a module-level registry rather than the store, so it can
  // be called from render paths with no context. Keep the two in sync here —
  // useMemo (not useEffect) so it lands before children render.
  useMemo(() => registerCustomTopics(data.customTopics), [data.customTopics]);

  useEffect(() => {
    saveData(data);
  }, [data]);

  const addQuestion = useCallback((q: Omit<Question, "id" | "createdAt" | "custom" | "origin">) => {
    const question: Question = {
      ...q,
      id: makeId(),
      createdAt: Date.now(),
      custom: true,
      origin: "user",
    };
    setData((prev) => ({ ...prev, questions: [...prev.questions, question] }));
    return question;
  }, []);

  const recordAttempt = useCallback((input: RecordAttemptInput) => {
    const attempt: Attempt = {
      id: makeId(),
      timestamp: Date.now(),
      questionId: input.questionId,
      source: input.source,
      answerMode: input.answerMode,
      userAnswer: input.userAnswer,
      verdict: input.verdict,
      feedback: input.feedback,
      whyMissed: input.whyMissed,
      timeSpentSec: input.timeSpentSec,
    };

    setData((prev) => {
      // 1. Schedule (or reschedule) the answered question itself.
      const prevSrs = prev.srs.find((s) => s.questionId === input.questionId);
      const nextSrs = scheduleAfterAttempt(input.questionId, prevSrs, input.verdict);
      let srs = prevSrs
        ? prev.srs.map((s) => (s.questionId === input.questionId ? nextSrs : s))
        : [...prev.srs, nextSrs];

      // 2. Trickle-down credit: a correct answer on an advanced topic gives
      //    partial review credit to questions of its DIRECT prerequisite
      //    topics that are waiting in the review queue.
      if (input.verdict === "correct") {
        const question = prev.questions.find((q) => q.id === input.questionId);
        const prereqTopics = new Set<TopicId>();
        for (const t of question?.topics ?? []) {
          const note = prev.studyNotes.find((n) => n.topicId === t);
          for (const p of note?.prereqs ?? []) prereqTopics.add(p);
        }
        if (prereqTopics.size > 0) {
          const topicsById = new Map(prev.questions.map((q) => [q.id, q.topics]));
          srs = srs.map((s) => {
            if (s.questionId === input.questionId || s.nextReviewAt === null) return s;
            const topics = topicsById.get(s.questionId) ?? [];
            return topics.some((t) => prereqTopics.has(t)) ? applyTrickleCredit(s) : s;
          });
        }
      }

      return { ...prev, attempts: [...prev.attempts, attempt], srs };
    });

    return attempt;
  }, []);

  const updateSettings = useCallback((partial: Partial<Settings>) => {
    setData((prev) => ({ ...prev, settings: { ...prev.settings, ...partial } }));
  }, []);

  const addCustomTopic = useCallback(
    (input: NewTopicInput): TopicId => {
    const title = input.title.trim() || "Untitled topic";
    // Computed outside the updater so it can be returned to the caller, which
    // navigates straight to the new topic.
    const topicId = slugifyTopic(title, data.customTopics.map((t) => t.id));
    const note: StudyNote = {
      topicId,
      title,
      prereqs: input.prereqs,
      source: "user",
      body: input.body,
      lastEdited: Date.now(),
      modified: false,
    };
    setData((prev) => ({
      ...prev,
      customTopics: [...prev.customTopics, { id: topicId, label: title }],
      studyNotes: [...prev.studyNotes, note],
    }));
    return topicId;
    },
    [data.customTopics],
  );

  /**
   * Remove a user-created topic along with its note and questions. Attempts are
   * deliberately kept: they are historical fact, and mastery simply stops
   * counting them once the questions are gone.
   */
  const deleteCustomTopic = useCallback((topicId: TopicId) => {
    setData((prev) => {
      // Guard: seeded topics have no customTopics entry and are not deletable.
      if (!prev.customTopics.some((t) => t.id === topicId)) return prev;
      return {
        ...prev,
        customTopics: prev.customTopics.filter((t) => t.id !== topicId),
        studyNotes: prev.studyNotes
          .filter((n) => n.topicId !== topicId)
          // Drop dangling prereq edges so the DAG stays well-formed.
          .map((n) =>
            n.prereqs.includes(topicId)
              ? { ...n, prereqs: n.prereqs.filter((p) => p !== topicId) }
              : n,
          ),
        questions: prev.questions.filter((q) => !q.topics.includes(topicId)),
        stagedQuestions: prev.stagedQuestions.filter((q) => !q.topics.includes(topicId)),
      };
    });
  }, []);

  const setTopicPrereqs = useCallback((topicId: TopicId, prereqs: TopicId[]) => {
    setData((prev) => ({
      ...prev,
      studyNotes: prev.studyNotes.map((n) =>
        // Self-edges would make the depth walk meaningless.
        n.topicId === topicId ? { ...n, prereqs: prereqs.filter((p) => p !== topicId) } : n,
      ),
    }));
  }, []);

  const topicDeletionImpact = useCallback(
    (topicId: TopicId): TopicDeletionImpact => ({
      questions: data.questions.filter((q) => q.topics.includes(topicId)).length,
      staged: data.stagedQuestions.filter((q) => q.topics.includes(topicId)).length,
      dependents: data.studyNotes.filter((n) => n.prereqs.includes(topicId)).map((n) => n.title),
    }),
    [data.questions, data.stagedQuestions, data.studyNotes],
  );

  const setNoteBody = useCallback((topicId: TopicId, body: string, source: StudyNote["source"]) => {
    setData((prev) => ({
      ...prev,
      studyNotes: prev.studyNotes.map((n) =>
        n.topicId === topicId
          ? { ...n, body, source, lastEdited: Date.now(), modified: true }
          : n,
      ),
    }));
  }, []);

  const stageQuestions = useCallback((drafts: NewQuestion[]) => {
    const createdAt = Date.now();
    const staged = drafts.map((d) => ({ ...d, id: `staged-${makeId()}`, createdAt }));
    setData((prev) => ({ ...prev, stagedQuestions: [...prev.stagedQuestions, ...staged] }));
  }, []);

  const approveStagedQuestion = useCallback((id: string) => {
    setData((prev) => {
      const staged = prev.stagedQuestions.find((q) => q.id === id);
      if (!staged) return prev;
      return {
        ...prev,
        stagedQuestions: prev.stagedQuestions.filter((q) => q.id !== id),
        questions: [...prev.questions, { ...staged, id: makeId() }],
      };
    });
  }, []);

  const rejectStagedQuestion = useCallback((id: string) => {
    setData((prev) => ({
      ...prev,
      stagedQuestions: prev.stagedQuestions.filter((q) => q.id !== id),
    }));
  }, []);

  const exportData = useCallback(() => {
    exportToFile(data);
  }, [data]);

  const importData = useCallback(async (file: File) => {
    const imported = await importFromFile(file);
    setData(imported);
  }, []);

  const resetAllData = useCallback(() => {
    localStorage.removeItem("quantprep_data_v2");
    localStorage.removeItem("quantprep_data_v1");
    setData(loadData());
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      data,
      addQuestion,
      recordAttempt,
      updateSettings,
      addCustomTopic,
      deleteCustomTopic,
      setTopicPrereqs,
      topicDeletionImpact,
      setNoteBody,
      stageQuestions,
      approveStagedQuestion,
      rejectStagedQuestion,
      exportData,
      importData,
      resetAllData,
    }),
    [
      data,
      addQuestion,
      recordAttempt,
      updateSettings,
      addCustomTopic,
      deleteCustomTopic,
      setTopicPrereqs,
      topicDeletionImpact,
      setNoteBody,
      stageQuestions,
      approveStagedQuestion,
      rejectStagedQuestion,
      exportData,
      importData,
      resetAllData,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within a StoreProvider");
  return ctx;
}

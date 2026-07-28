import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AppData, Attempt, AttemptSource, Question, Settings, StudyNote, Verdict } from "../types";
import type { TopicId } from "./topics";
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

interface StoreValue {
  data: AppData;
  addQuestion: (q: Omit<Question, "id" | "createdAt" | "custom" | "origin">) => Question;
  recordAttempt: (input: RecordAttemptInput) => Attempt;
  updateSettings: (partial: Partial<Settings>) => void;
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
  const [data, setData] = useState<AppData>(() => loadData());

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

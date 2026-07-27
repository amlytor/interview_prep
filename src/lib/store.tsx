import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AppData, Attempt, AttemptSource, Question, Settings, Verdict } from "../types";
import { exportToFile, importFromFile, loadData, saveData } from "./storage";
import { scheduleAfterAttempt } from "./srs";

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

interface StoreValue {
  data: AppData;
  addQuestion: (q: Omit<Question, "id" | "createdAt" | "custom">) => Question;
  recordAttempt: (input: RecordAttemptInput) => Attempt;
  updateSettings: (partial: Partial<Settings>) => void;
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

  const addQuestion = useCallback((q: Omit<Question, "id" | "createdAt" | "custom">) => {
    const question: Question = {
      ...q,
      id: makeId(),
      createdAt: Date.now(),
      custom: true,
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
      const prevSrs = prev.srs.find((s) => s.questionId === input.questionId);
      const nextSrs = scheduleAfterAttempt(input.questionId, prevSrs, input.verdict);
      const srs = prevSrs
        ? prev.srs.map((s) => (s.questionId === input.questionId ? nextSrs : s))
        : [...prev.srs, nextSrs];
      return { ...prev, attempts: [...prev.attempts, attempt], srs };
    });

    return attempt;
  }, []);

  const updateSettings = useCallback((partial: Partial<Settings>) => {
    setData((prev) => ({ ...prev, settings: { ...prev.settings, ...partial } }));
  }, []);

  const exportData = useCallback(() => {
    exportToFile(data);
  }, [data]);

  const importData = useCallback(async (file: File) => {
    const imported = await importFromFile(file);
    setData(imported);
  }, []);

  const resetAllData = useCallback(() => {
    localStorage.removeItem("quantprep_data_v1");
    setData(loadData());
  }, []);

  const value = useMemo<StoreValue>(
    () => ({ data, addQuestion, recordAttempt, updateSettings, exportData, importData, resetAllData }),
    [data, addQuestion, recordAttempt, updateSettings, exportData, importData, resetAllData],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within a StoreProvider");
  return ctx;
}

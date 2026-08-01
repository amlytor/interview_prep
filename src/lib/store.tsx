import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  AppData,
  Attempt,
  AttemptSource,
  DifficultyRating,
  MissDiagnosis,
  Question,
  Settings,
  StudyNote,
  Verdict,
} from "../types";
import type { TopicId } from "./topics";
import { registerCustomTopics, slugifyTopic } from "./topics";
import {
  clearStoredData, commitData, exportToFile, freshData, importFromFile, loadData, readStoredState,
} from "./storage";
import type { LoadResult, StoredState } from "./storage";
import { announceCommit, onRemoteCommit } from "./sync";
import { applyTrickleCredit, scheduleAfterAttempt } from "./srs";
import { useAutoBackup } from "./backup";
import type { AutoBackup } from "./backup";

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
  /** One-tap post-answer difficulty feedback; feeds per-topic calibration. */
  rateAttemptDifficulty: (attemptId: string, rating: DifficultyRating) => void;
  /** Store the conclusion of a "why did I get this wrong?" chat. */
  saveDiagnosis: (attemptId: string, diagnosis: MissDiagnosis) => void;
  /** Rewrite a diagnosis summary in your own words. */
  updateDiagnosisSummary: (attemptId: string, summary: string) => void;
  // Custom topics: a user-created topic is a study note plus a taxonomy entry,
  // so it flows through mastery, the knowledge tree, and Learn mode unchanged.
  /** Async: the slug is assigned inside the commit. Null if the save failed. */
  addCustomTopic: (input: NewTopicInput) => Promise<TopicId | null>;
  deleteCustomTopic: (topicId: TopicId) => void;
  setTopicPrereqs: (topicId: TopicId, prereqs: TopicId[]) => void;
  topicDeletionImpact: (topicId: TopicId) => TopicDeletionImpact;
  // Study notes
  setNoteBody: (topicId: TopicId, body: string, source: StudyNote["source"]) => void;
  // AI question staging: generated questions sit in stagedQuestions until
  // explicitly approved into the live bank (or rejected).
  stageQuestions: (drafts: NewQuestion[]) => void;
  /** Approve one staged question. `revealed` records whether you read the answer. */
  approveStagedQuestion: (id: string, revealed?: boolean) => void;
  /** Bulk-approve every staged question that passed validation, unseen. */
  approveCleanStaged: (topicId?: TopicId) => Promise<number | null>;
  rejectStagedQuestion: (id: string) => void;
  /** Mark a staged question's answer as read, so approving it can't claim otherwise. */
  markStagedRevealed: (id: string) => void;
  exportData: () => void;
  importData: (file: File) => Promise<void>;
  resetAllData: () => void;
  // Continuous backup to a file on disk. Lives here rather than in the Settings
  // page so auto-saving keeps running wherever you are in the app.
  backup: AutoBackup;
  /**
   * True once a save has failed — the browser is refusing to store anything,
   * so this session is memory-only. Surfaced as a banner rather than left in
   * the console: silently not saving is the worst way for this app to fail.
   */
  saveFailed: boolean;
}

const StoreContext = createContext<StoreValue | null>(null);

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Loads the saved state, then hands it to the real provider.
 *
 * IndexedDB is asynchronous, so the data can't be read in a useState
 * initialiser the way localStorage was. Splitting the load out keeps the inner
 * provider's hooks unconditional — it only ever mounts with data in hand — and
 * gives the app a single, honest loading state instead of a flash of empty
 * dashboards while the bank is read.
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const [initial, setInitial] = useState<LoadResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadData()
      // A rejection here would leave the loading screen up forever with nothing
      // on it to explain why. loadData guards the failures it knows about; this
      // catches the ones it doesn't, and starts the app on a fresh bank rather
      // than a permanent spinner. Whatever was stored is untouched — nothing
      // overwrites it until a save succeeds.
      .catch((err) => {
        console.error("QuantPrep couldn't load your saved data; starting fresh.", err);
        return { data: freshData(), revision: 0, persisted: false };
      })
      .then((loaded) => {
        if (cancelled) return;
        // Seed the display-name registry before the first render, so custom
        // topics never flash their raw slug.
        registerCustomTopics(loaded.data.customTopics);
        setInitial(loaded);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!initial) return <div className="app-loading">Loading your bank…</div>;
  return <StoreInner initial={initial}>{children}</StoreInner>;
}

function StoreInner({ initial, children }: { initial: LoadResult; children: ReactNode }) {
  const [data, setData] = useState<AppData>(initial.data);
  const [saveFailed, setSaveFailed] = useState(!initial.persisted);

  // topicLabel() reads a module-level registry rather than the store, so it can
  // be called from render paths with no context. Keep the two in sync here —
  // useMemo (not useEffect) so it lands before children render.
  useMemo(() => registerCustomTopics(data.customTopics), [data.customTopics]);

  // The revision this tab has seen. Used only to ignore its own echo and any
  // notification that has already been overtaken.
  const revision = useRef(initial.revision);
  // The latest state, readable from a callback without making every action
  // depend on `data` and re-create itself on each change.
  const dataRef = useRef(data);
  dataRef.current = data;

  /** Take a committed result as the new truth, and tell the other tabs. */
  const adopt = useCallback((result: StoredState | null): AppData | null => {
    setSaveFailed(result === null);
    if (!result) return null;
    revision.current = result.revision;
    registerCustomTopics(result.data.customTopics);
    setData(result.data);
    announceCommit(result.revision);
    return result.data;
  }, []);

  /**
   * The single write path.
   *
   * Applies the change locally at once so the UI never waits on a disk write,
   * then commits it — and the commit is what decides the real outcome, because
   * it re-applies the same transform to whatever is actually stored. If another
   * tab has written in between, this returns THEIR state with our change on top
   * rather than our stale snapshot, and we adopt it. That is why the transform
   * must be a pure function of the previous state: it runs twice, and the
   * second run is the one that counts.
   */
  const mutate = useCallback(
    (apply: (prev: AppData) => AppData) => {
      setData(apply);
      void commitData((stored) => apply(stored ?? dataRef.current)).then(adopt);
    },
    [adopt],
  );

  /**
   * A write whose transform must run EXACTLY ONCE, because it decides something
   * the caller needs back — an assigned id, a count of what it touched.
   *
   * mutate() runs its transform twice by design, which is fine when the only
   * output is the next state but not when the transform is also choosing a
   * value. Here there is no optimistic pass: the caller waits for the commit,
   * which for a deliberate one-off action costs a few milliseconds and buys an
   * answer computed against the real stored state.
   */
  const commitOnce = useCallback(
    async <T,>(apply: (prev: AppData) => [AppData, T]): Promise<T | null> => {
      let output: T | undefined;
      const result = await commitData((stored) => {
        const [next, value] = apply(stored ?? dataRef.current);
        output = value;
        return next;
      });
      return adopt(result) ? (output as T) : null;
    },
    [adopt],
  );

  // Adopt writes made in other tabs, so a second window isn't showing a
  // snapshot frozen at the moment it loaded.
  useEffect(
    () =>
      onRemoteCommit((remote) => {
        if (remote <= revision.current) return; // already seen, or our own echo
        void readStoredState().then((stored) => {
          if (!stored || stored.revision <= revision.current) return;
          revision.current = stored.revision;
          registerCustomTopics(stored.data.customTopics);
          setData(stored.data);
        });
      }),
    [],
  );

  const backup = useAutoBackup(data);

  const addQuestion = useCallback((q: Omit<Question, "id" | "createdAt" | "custom" | "origin">) => {
    const question: Question = {
      ...q,
      id: makeId(),
      createdAt: Date.now(),
      custom: true,
      origin: "user",
    };
    mutate((prev) => ({ ...prev, questions: [...prev.questions, question] }));
    return question;
  }, [mutate]);

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

    mutate((prev) => {
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

      // 3. Answering a question shows its explanation, so it is no longer
      //    unseen — it stops being preferred as fresh practice from here on.
      const questions = prev.questions.map((q) =>
        q.id === input.questionId && !q.answerSeen ? { ...q, answerSeen: true } : q,
      );

      return { ...prev, questions, attempts: [...prev.attempts, attempt], srs };
    });

    return attempt;
  }, [mutate]);

  const updateSettings = useCallback((partial: Partial<Settings>) => {
    mutate((prev) => ({ ...prev, settings: { ...prev.settings, ...partial } }));
  }, [mutate]);

  const rateAttemptDifficulty = useCallback((attemptId: string, rating: DifficultyRating) => {
    mutate((prev) => ({
      ...prev,
      attempts: prev.attempts.map((a) => (a.id === attemptId ? { ...a, difficultyRating: rating } : a)),
    }));
  }, [mutate]);

  const saveDiagnosis = useCallback((attemptId: string, diagnosis: MissDiagnosis) => {
    mutate((prev) => ({
      ...prev,
      attempts: prev.attempts.map((a) => (a.id === attemptId ? { ...a, diagnosis } : a)),
    }));
  }, [mutate]);

  const updateDiagnosisSummary = useCallback((attemptId: string, summary: string) => {
    mutate((prev) => ({
      ...prev,
      attempts: prev.attempts.map((a) =>
        a.id === attemptId && a.diagnosis
          ? { ...a, diagnosis: { ...a.diagnosis, summary: summary.trim(), edited: true } }
          : a,
      ),
    }));
  }, [mutate]);

  const addCustomTopic = useCallback(
    (input: NewTopicInput): Promise<TopicId | null> => {
      const title = input.title.trim() || "Untitled topic";
      // The slug is chosen INSIDE the commit, against the ids that are actually
      // stored. Picking it from render-time state instead meant two tabs — or
      // two fast clicks — creating the same title could settle on the same id,
      // and a duplicate topic id silently merges two topics' questions.
      return commitOnce((prev) => {
        const topicId = slugifyTopic(title, prev.customTopics.map((t) => t.id));
        const note: StudyNote = {
          topicId,
          title,
          prereqs: input.prereqs,
          source: "user",
          body: input.body,
          lastEdited: Date.now(),
          modified: false,
        };
        return [
          {
            ...prev,
            customTopics: [...prev.customTopics, { id: topicId, label: title }],
            studyNotes: [...prev.studyNotes, note],
          },
          topicId,
        ];
      });
    },
    [commitOnce],
  );

  /**
   * Remove a user-created topic along with its note and questions. Attempts are
   * deliberately kept: they are historical fact, and mastery simply stops
   * counting them once the questions are gone.
   */
  const deleteCustomTopic = useCallback((topicId: TopicId) => {
    mutate((prev) => {
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
  }, [mutate]);

  const setTopicPrereqs = useCallback((topicId: TopicId, prereqs: TopicId[]) => {
    mutate((prev) => ({
      ...prev,
      studyNotes: prev.studyNotes.map((n) =>
        // Self-edges would make the depth walk meaningless.
        n.topicId === topicId ? { ...n, prereqs: prereqs.filter((p) => p !== topicId) } : n,
      ),
    }));
  }, [mutate]);

  const topicDeletionImpact = useCallback(
    (topicId: TopicId): TopicDeletionImpact => ({
      questions: data.questions.filter((q) => q.topics.includes(topicId)).length,
      staged: data.stagedQuestions.filter((q) => q.topics.includes(topicId)).length,
      dependents: data.studyNotes.filter((n) => n.prereqs.includes(topicId)).map((n) => n.title),
    }),
    [data.questions, data.stagedQuestions, data.studyNotes],
  );

  const setNoteBody = useCallback((topicId: TopicId, body: string, source: StudyNote["source"]) => {
    mutate((prev) => ({
      ...prev,
      studyNotes: prev.studyNotes.map((n) =>
        n.topicId === topicId
          ? { ...n, body, source, lastEdited: Date.now(), modified: true }
          : n,
      ),
    }));
  }, [mutate]);

  const stageQuestions = useCallback((drafts: NewQuestion[]) => {
    const createdAt = Date.now();
    const staged = drafts.map((d) => ({ ...d, id: `staged-${makeId()}`, createdAt }));
    mutate((prev) => ({ ...prev, stagedQuestions: [...prev.stagedQuestions, ...staged] }));
  }, [mutate]);

  const approveStagedQuestion = useCallback((id: string, revealed = false) => {
    mutate((prev) => {
      const staged = prev.stagedQuestions.find((q) => q.id === id);
      if (!staged) return prev;
      return {
        ...prev,
        stagedQuestions: prev.stagedQuestions.filter((q) => q.id !== id),
        questions: [
          ...prev.questions,
          // answerSeen sticks if it was already revealed during review — you
          // can't un-see an answer by clicking "bank it unseen" afterwards.
          { ...staged, id: makeId(), answerSeen: staged.answerSeen || revealed },
        ],
      };
    });
  }, [mutate]);

  /** Approve everything the validation pass cleared, without revealing answers. */
  const approveCleanStaged = useCallback(
    (topicId?: TopicId): Promise<number | null> =>
      // Which questions are "clean" is decided inside the commit too, so the
      // count reported back is what was actually banked rather than what this
      // tab last saw staged.
      commitOnce((prev) => {
        const clean = prev.stagedQuestions.filter(
          (q) =>
            q.validation?.status === "clean" &&
            !q.answerSeen &&
            (topicId === undefined || q.topics.includes(topicId)),
        );
        if (clean.length === 0) return [prev, 0];
        const ids = new Set(clean.map((q) => q.id));
        return [
          {
            ...prev,
            stagedQuestions: prev.stagedQuestions.filter((q) => !ids.has(q.id)),
            questions: [
              ...prev.questions,
              ...clean.map((q) => ({ ...q, id: makeId(), answerSeen: false })),
            ],
          },
          clean.length,
        ];
      }),
    [commitOnce],
  );

  const markStagedRevealed = useCallback((id: string) => {
    mutate((prev) => ({
      ...prev,
      stagedQuestions: prev.stagedQuestions.map((q) => (q.id === id ? { ...q, answerSeen: true } : q)),
    }));
  }, [mutate]);

  const rejectStagedQuestion = useCallback((id: string) => {
    mutate((prev) => ({
      ...prev,
      stagedQuestions: prev.stagedQuestions.filter((q) => q.id !== id),
    }));
  }, [mutate]);

  const exportData = useCallback(() => {
    exportToFile(data);
  }, [data]);

  const importData = useCallback(
    async (file: File) => {
      const imported = await importFromFile(file);
      // An import REPLACES the state rather than deriving from it — that is the
      // one mutation whose transform ignores what came before.
      mutate(() => imported);
    },
    [mutate],
  );

  const resetAllData = useCallback(() => {
    // Kept fire-and-forget so the Settings button stays a plain click handler;
    // loadData() re-seeds a fresh install and saves it on the way back.
    void clearStoredData()
      .then(loadData)
      .then((loaded) => {
        revision.current = loaded.revision;
        setSaveFailed(!loaded.persisted);
        registerCustomTopics(loaded.data.customTopics);
        setData(loaded.data);
        announceCommit(loaded.revision);
      });
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      data,
      addQuestion,
      recordAttempt,
      updateSettings,
      rateAttemptDifficulty,
      saveDiagnosis,
      updateDiagnosisSummary,
      addCustomTopic,
      deleteCustomTopic,
      setTopicPrereqs,
      topicDeletionImpact,
      setNoteBody,
      stageQuestions,
      approveStagedQuestion,
      approveCleanStaged,
      rejectStagedQuestion,
      markStagedRevealed,
      exportData,
      importData,
      resetAllData,
      backup,
      saveFailed,
    }),
    [
      data,
      addQuestion,
      recordAttempt,
      updateSettings,
      rateAttemptDifficulty,
      saveDiagnosis,
      updateDiagnosisSummary,
      addCustomTopic,
      deleteCustomTopic,
      setTopicPrereqs,
      topicDeletionImpact,
      setNoteBody,
      stageQuestions,
      approveStagedQuestion,
      approveCleanStaged,
      rejectStagedQuestion,
      markStagedRevealed,
      exportData,
      importData,
      resetAllData,
      backup,
      saveFailed,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within a StoreProvider");
  return ctx;
}

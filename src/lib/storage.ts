import type { AppData, Question, SrsState } from "../types";
import { SEED_QUESTIONS } from "./seedQuestions";
import { seedQuestionBank, seedStudyNotes, DROPPED_V1_SEED_IDS } from "./seedData";
import { V1_LABEL_TO_ID, isTopicId } from "./topics";
import type { TopicId } from "./topics";

// v2 is the live key. v1 is read once for migration and then left untouched
// as a permanent rollback backup — it is never deleted or rewritten.
const STORAGE_KEY_V2 = "quantprep_data_v2";
const STORAGE_KEY_V1 = "quantprep_data_v1";
const CURRENT_VERSION = 2;

function defaultSettings() {
  return { apiKey: "", model: "claude-sonnet-4-6", spendNote: "" };
}

/** The full seeded bank: trimmed v1 starter questions + the 35 authored ones. */
function mergedSeedBank(): Question[] {
  return [...SEED_QUESTIONS, ...seedQuestionBank()];
}

function defaultData(): AppData {
  return {
    version: CURRENT_VERSION,
    questions: mergedSeedBank(),
    attempts: [],
    srs: [],
    settings: defaultSettings(),
    studyNotes: seedStudyNotes(),
    stagedQuestions: [],
  };
}

/** Map a v1 topic array (display labels) to v2 topic ids, dropping unknowns. */
function migrateTopics(topics: unknown): TopicId[] {
  if (!Array.isArray(topics)) return [];
  const ids: TopicId[] = [];
  for (const t of topics) {
    if (typeof t !== "string") continue;
    const id = V1_LABEL_TO_ID[t] ?? (isTopicId(t) ? t : null);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * v1 -> v2 migration. Used both for the live localStorage key and for
 * importing old JSON backups.
 * - question topics: display labels -> canonical ids
 * - six v1 seed questions superseded by the authored bank are dropped
 *   (their attempts are kept; mastery counts them via tombstone topic tags)
 * - the 35 authored questions and 19 study notes are seeded in
 * - SRS entries gain trickleCredit; entries for dropped questions are removed
 */
function migrateV1toV2(v1: Record<string, unknown>): AppData {
  const oldQuestions = Array.isArray(v1.questions) ? (v1.questions as Question[]) : [];
  const oldAttempts = Array.isArray(v1.attempts) ? (v1.attempts as AppData["attempts"]) : [];
  const oldSrs = Array.isArray(v1.srs) ? (v1.srs as SrsState[]) : [];
  const oldSettings =
    v1.settings && typeof v1.settings === "object"
      ? { ...defaultSettings(), ...(v1.settings as AppData["settings"]) }
      : defaultSettings();

  const keptQuestions: Question[] = oldQuestions
    .filter((q) => !DROPPED_V1_SEED_IDS.has(q.id))
    .map((q) => ({
      ...q,
      topics: migrateTopics(q.topics),
      origin: q.origin ?? (q.custom ? "user" : "seed"),
    }));

  // Merge in the authored bank, skipping any ids already present (defensive —
  // matters if a half-migrated export is re-imported).
  const presentIds = new Set(keptQuestions.map((q) => q.id));
  const questions = [
    ...keptQuestions,
    ...seedQuestionBank().filter((q) => !presentIds.has(q.id)),
  ];

  const srs = oldSrs
    .filter((s) => !DROPPED_V1_SEED_IDS.has(s.questionId))
    .map((s) => ({ ...s, trickleCredit: s.trickleCredit ?? 0 }));

  return {
    version: CURRENT_VERSION,
    questions,
    attempts: oldAttempts,
    srs,
    settings: oldSettings,
    studyNotes: seedStudyNotes(),
    stagedQuestions: [],
  };
}

/** Shape-guard + backfill for parsed v2 data (from storage or an import). */
function normalizeV2(parsed: AppData): AppData {
  if (!Array.isArray(parsed.questions) || !Array.isArray(parsed.attempts)) {
    throw new Error("malformed data");
  }
  if (!parsed.settings) parsed.settings = defaultSettings();
  if (!Array.isArray(parsed.srs)) parsed.srs = [];
  parsed.srs = parsed.srs.map((s) => ({ ...s, trickleCredit: s.trickleCredit ?? 0 }));
  if (!Array.isArray(parsed.studyNotes) || parsed.studyNotes.length === 0) {
    parsed.studyNotes = seedStudyNotes();
  }
  if (!Array.isArray(parsed.stagedQuestions)) parsed.stagedQuestions = [];
  parsed.version = CURRENT_VERSION;
  return parsed;
}

export function loadData(): AppData {
  // 1. Live v2 data.
  const rawV2 = localStorage.getItem(STORAGE_KEY_V2);
  if (rawV2) {
    try {
      return normalizeV2(JSON.parse(rawV2) as AppData);
    } catch {
      // Don't clobber whatever bad data is there — back it up before resetting.
      localStorage.setItem(`${STORAGE_KEY_V2}_corrupt_backup_${Date.now()}`, rawV2);
    }
  }

  // 2. v1 data present → migrate it forward (v1 key is left in place as backup).
  const rawV1 = localStorage.getItem(STORAGE_KEY_V1);
  if (rawV1 && !rawV2) {
    try {
      const migrated = migrateV1toV2(JSON.parse(rawV1) as Record<string, unknown>);
      saveData(migrated);
      return migrated;
    } catch {
      // Fall through to a fresh install; the v1 key remains untouched.
    }
  }

  // 3. Fresh install.
  const fresh = defaultData();
  saveData(fresh);
  return fresh;
}

export function saveData(data: AppData): void {
  localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(data));
}

export function exportToFile(data: AppData): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `quantprep-backup-${date}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function importFromFile(file: File): Promise<AppData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string) as AppData;
        if (!parsed || !Array.isArray(parsed.questions) || !Array.isArray(parsed.attempts)) {
          throw new Error("File doesn't look like a QuantPrep export.");
        }
        // Old v1 backups are welcome — run them through the same migration.
        if (!parsed.version || parsed.version < 2) {
          resolve(migrateV1toV2(parsed as unknown as Record<string, unknown>));
          return;
        }
        resolve(normalizeV2(parsed));
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Failed to parse import file."));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsText(file);
  });
}

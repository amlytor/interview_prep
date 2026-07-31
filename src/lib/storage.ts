import type { AppData, Question, Settings, SrsState, StudyNote } from "../types";
import { SEED_QUESTIONS } from "./seedQuestions";
import { seedQuestionBank, seedStudyNotes, DROPPED_V1_SEED_IDS } from "./seedData";
import { V1_LABEL_TO_ID, isKnownTopicId } from "./topics";
import type { TopicId } from "./topics";
import { DEFAULT_PROVIDER_ID, DEFAULT_MODEL, LEGACY_PROVIDER_ID } from "./providers";
import { keyValueStore } from "./db";

// WHERE the data lives is separate from WHAT SHAPE it is in.
//
// Home: IndexedDB, since the seeded bank grew past 3.7 MB and localStorage
// caps out around 5 MB per origin (UTF-16, so every character costs two
// bytes). IndexedDB's budget is a share of free disk — gigabytes rather than
// megabytes — and it stores structured clones, so there is no stringify on the
// hot path either. The two localStorage keys below are now only ever READ, as
// migration sources for installs that predate the move.
//
// Shape: the v2 schema. Later additions (multi-provider settings, custom
// topics, v3's diagnoses and ratings) are purely additive and backfilled by
// normalizeCurrent(), so the schema version is what tracks them — the payload
// an existing user has on disk is loaded and upgraded, never discarded.
const IDB_NAME = "quantprep";
const IDB_STORE = "app";
const IDB_KEY = "data";
const store = keyValueStore(IDB_NAME, IDB_STORE);

// v1 is read once for migration and then left untouched as a permanent
// rollback backup — it is never deleted or rewritten.
const STORAGE_KEY_V2 = "quantprep_data_v2";
const STORAGE_KEY_V1 = "quantprep_data_v1";
// v3 adds miss diagnoses, difficulty ratings, answer-seen tracking and the
// daily goal. Every v3 field is optional, so the upgrade is pure backfill —
// hence the storage KEY stays at _v2. The version field below is what tracks
// the schema; renaming the key would strand existing progress.
const CURRENT_VERSION = 3;

export const DEFAULT_DAILY_GOAL = 1;

function defaultSettings(): Settings {
  return {
    provider: DEFAULT_PROVIDER_ID,
    model: DEFAULT_MODEL,
    apiKeys: {},
    baseUrls: {},
    taskModels: {},
    spendNote: "",
    dailyGoal: DEFAULT_DAILY_GOAL,
  };
}

/**
 * Bring a settings object up to the current shape. Handles the original
 * single-provider form, where the key lived in a flat `apiKey` field.
 */
function normalizeSettings(raw: unknown): Settings {
  const defaults = defaultSettings();
  if (!raw || typeof raw !== "object") return defaults;
  const s = raw as Partial<Settings> & { apiKey?: string };

  const apiKeys = { ...(s.apiKeys ?? {}) };
  // The pre-multi-provider key was always an Anthropic one.
  if (typeof s.apiKey === "string" && s.apiKey && !apiKeys.anthropic) {
    apiKeys.anthropic = s.apiKey;
  }

  return {
    // No `provider` means this payload predates multi-provider support, so it
    // was an Anthropic install. Sending it to the *current* default would strand
    // the user on a provider they have no key for, with an incompatible model
    // ID — so legacy data migrates to Anthropic and keeps working untouched.
    provider: typeof s.provider === "string" && s.provider ? s.provider : LEGACY_PROVIDER_ID,
    model: typeof s.model === "string" && s.model ? s.model : defaults.model,
    apiKeys,
    baseUrls: { ...(s.baseUrls ?? {}) },
    taskModels: { ...(s.taskModels ?? {}) },
    spendNote: typeof s.spendNote === "string" ? s.spendNote : "",
    // v3: a goal below 1 would make every day qualify, including empty ones.
    dailyGoal:
      typeof s.dailyGoal === "number" && Number.isFinite(s.dailyGoal) && s.dailyGoal >= 1
        ? Math.floor(s.dailyGoal)
        : defaults.dailyGoal,
  };
}

/** The full seeded bank: trimmed v1 starter questions + the authored ones. */
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
    customTopics: [],
  };
}

/** A brand-new bank, for callers that need to start over. */
export function freshData(): AppData {
  return defaultData();
}

/** Map a v1 topic array (display labels) to v2 topic ids, dropping unknowns. */
function migrateTopics(topics: unknown): TopicId[] {
  if (!Array.isArray(topics)) return [];
  const ids: TopicId[] = [];
  for (const t of topics) {
    if (typeof t !== "string") continue;
    const id = V1_LABEL_TO_ID[t] ?? (isKnownTopicId(t) ? t : null);
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
  const oldSettings = normalizeSettings(v1.settings);

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
    customTopics: [],
  };
}

/**
 * Shape-guard + backfill for parsed v2 data (from storage or an import).
 * Every field added after the original v2 release is backfilled here, so an
 * older export imports cleanly and an older localStorage payload loads without
 * a migration step.
 */
function normalizeCurrent(parsed: AppData): AppData {
  if (!Array.isArray(parsed.questions) || !Array.isArray(parsed.attempts)) {
    throw new Error("malformed data");
  }
  parsed.settings = normalizeSettings(parsed.settings);
  if (!Array.isArray(parsed.srs)) parsed.srs = [];
  parsed.srs = parsed.srs.map((s) => ({ ...s, trickleCredit: s.trickleCredit ?? 0 }));
  if (!Array.isArray(parsed.studyNotes) || parsed.studyNotes.length === 0) {
    parsed.studyNotes = seedStudyNotes();
  } else {
    parsed.studyNotes = refreshSeedNotes(parsed.studyNotes);
  }
  if (!Array.isArray(parsed.stagedQuestions)) parsed.stagedQuestions = [];
  if (!Array.isArray(parsed.customTopics)) parsed.customTopics = [];
  parsed.questions = withNewSeedQuestions(parsed.questions);
  parsed.version = CURRENT_VERSION;
  return parsed;
}

/**
 * Append seed-bank questions the stored data doesn't have yet.
 *
 * Without this, questions added to seedQuestions.json would only ever reach
 * fresh installs — an existing user pulling the update would see nothing new,
 * because loadData() returns their stored bank untouched. Matching is by id, so
 * this is idempotent, and nothing already present is modified: edits, attempt
 * history and answerSeen flags all survive.
 *
 * Safe against resurrection: there is no way to delete a seeded question in the
 * app (deleteCustomTopic only reaches user-created topics), so an absent seed id
 * always means "never had it", never "deliberately removed".
 */
function withNewSeedQuestions(questions: Question[]): Question[] {
  const present = new Set(questions.map((q) => q.id));
  const missing = seedQuestionBank().filter((q) => !present.has(q.id));
  return missing.length ? [...questions, ...missing] : questions;
}

/**
 * Pull authored note bodies forward when the seed file's copy has been revised.
 *
 * Only notes the user has never touched are refreshed — `modified` is set by
 * every edit path, and an AI-drafted body sets source to "ai" — so a rewrite of
 * a seeded note can't overwrite anyone's own work. Notes for topics added to the
 * seed file since the user's data was written are appended.
 */
function refreshSeedNotes(stored: StudyNote[]): StudyNote[] {
  const seeds = new Map(seedStudyNotes().map((n) => [n.topicId, n]));
  const refreshed = stored.map((note) => {
    const seed = seeds.get(note.topicId);
    if (!seed || note.modified || note.source !== "authored") return note;
    return note.body === seed.body ? note : { ...note, body: seed.body, prereqs: seed.prereqs };
  });

  const present = new Set(stored.map((n) => n.topicId));
  const added = [...seeds.values()].filter((n) => !present.has(n.topicId));
  return added.length ? [...refreshed, ...added] : refreshed;
}

/** Read the stored payload, treating any IndexedDB failure as "nothing there". */
async function readStored(): Promise<AppData | null> {
  try {
    const stored = await store.get<AppData>(IDB_KEY);
    return stored && typeof stored === "object" ? stored : null;
  } catch (err) {
    // Private-browsing modes and a few locked-down configurations refuse
    // IndexedDB outright. The app still runs; it just won't remember anything.
    console.error("QuantPrep couldn't read from IndexedDB.", err);
    return null;
  }
}

// localStorage is only touched to migrate off it, but every access has to be
// guarded: when a browser is set to block site data for an origin, the property
// itself throws SecurityError rather than returning an empty store. Unguarded,
// that rejected loadData() and left the app on its loading screen forever —
// a hang with nothing on screen to explain it. Storage being unavailable should
// cost you persistence, not the app.
function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Nothing to fall back to; the caller is already on a failure path.
  }
}

function removeLocal(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ditto — if it can't be read it can't mislead us later either.
  }
}

/**
 * Move a localStorage payload into IndexedDB, then reclaim the space.
 *
 * The v1 key is kept forever because the v1→v2 migration is lossy — questions
 * were dropped and topic labels rewritten, so the original is the only record.
 * This move is not: the same object goes in the same shape into a different
 * container. A duplicate would carry no information while pinning ~4 MB of the
 * ~5 MB localStorage budget, and a stale snapshot sitting in the fallback slot
 * is worse than useless — if IndexedDB were ever cleared on its own it would
 * silently reinstate months-old progress. So the copy goes, but only after the
 * new one has been written AND read back.
 */
async function retireLocalCopy(migrated: AppData): Promise<void> {
  const written = await saveData(migrated);
  if (written && (await readStored()) !== null) removeLocal(STORAGE_KEY_V2);
}

export async function loadData(): Promise<AppData> {
  // 1. Live data, already in IndexedDB.
  const stored = await readStored();
  if (stored) {
    try {
      return normalizeCurrent(stored);
    } catch (err) {
      // Don't clobber whatever bad data is there — set it aside before resetting.
      console.error("QuantPrep couldn't read its saved data; setting it aside.", err);
      try {
        await store.put(`${IDB_KEY}_corrupt_${Date.now()}`, stored);
      } catch {
        // If even that fails there is nothing useful left to do about it.
      }
    }
  }

  // 2. A pre-IndexedDB install: v2 data still sitting in localStorage.
  const rawV2 = readLocal(STORAGE_KEY_V2);
  if (rawV2) {
    try {
      const migrated = normalizeCurrent(JSON.parse(rawV2) as AppData);
      await retireLocalCopy(migrated);
      return migrated;
    } catch {
      writeLocal(`${STORAGE_KEY_V2}_corrupt_backup_${Date.now()}`, rawV2);
    }
  }

  // 3. v1 data present → migrate it forward (v1 key is left in place as backup).
  const rawV1 = readLocal(STORAGE_KEY_V1);
  if (rawV1 && !rawV2) {
    try {
      const migrated = migrateV1toV2(JSON.parse(rawV1) as Record<string, unknown>);
      await saveData(migrated);
      return migrated;
    } catch {
      // Fall through to a fresh install; the v1 key remains untouched.
    }
  }

  // 4. Fresh install.
  const fresh = defaultData();
  await saveData(fresh);
  return fresh;
}

/**
 * Persist to IndexedDB. A failed write must not take the app down mid-drill,
 * so quota/permission errors are reported rather than thrown — the in-memory
 * state stays usable and the user can still export.
 *
 * Writes are not debounced. IndexedDB serialises transactions on a store in
 * the order they are created, so a burst of edits lands in order and the last
 * one wins; no read-modify-write race is possible.
 */
export async function saveData(data: AppData): Promise<boolean> {
  try {
    await store.put(IDB_KEY, data);
    void requestPersistence();
    return true;
  } catch (err) {
    console.error(
      "QuantPrep couldn't save to IndexedDB — your progress this session is in memory only. " +
        "Export to JSON from Settings to avoid losing it.",
      err,
    );
    return false;
  }
}

/** Erase everything the app has stored, including the pre-IndexedDB keys. */
export async function clearStoredData(): Promise<void> {
  try {
    await store.remove(IDB_KEY);
  } catch (err) {
    console.error("QuantPrep couldn't clear its saved data.", err);
  }
  removeLocal(STORAGE_KEY_V2);
  removeLocal(STORAGE_KEY_V1);
}

// ---------------------------------------------------------------------------
// Eviction protection
// ---------------------------------------------------------------------------

let persistenceAsked = false;

/**
 * Ask the browser not to evict this origin's storage when disk runs low.
 *
 * Without it, IndexedDB is "best effort" and a browser under storage pressure
 * may clear it — the one failure mode that is genuinely worse than the 5 MB
 * ceiling we just escaped. Chromium grants this silently once a site has been
 * used a few times, so it is requested from the save path rather than on load:
 * by the time anything is being saved the app has been used for real.
 *
 * Firefox shows a permission prompt instead, which is why the Settings panel
 * offers the same request behind an explicit button — see storageReport().
 */
async function requestPersistence(): Promise<void> {
  if (persistenceAsked || !navigator.storage?.persist) return;
  persistenceAsked = true;
  try {
    if (!(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    // Not supported, or refused. Nothing to do — storage still works.
  }
}

export interface StorageReport {
  /** Bytes this origin is using, per the browser's own accounting. */
  usage: number | null;
  /** Bytes it is allowed, typically a share of free disk. */
  quota: number | null;
  /** True once the browser has agreed not to evict this origin. */
  persisted: boolean;
}

/** What Settings shows: how much room there is, and whether it's protected. */
export async function storageReport(): Promise<StorageReport> {
  try {
    const estimate = (await navigator.storage?.estimate?.()) ?? {};
    return {
      usage: estimate.usage ?? null,
      quota: estimate.quota ?? null,
      persisted: (await navigator.storage?.persisted?.()) ?? false,
    };
  } catch {
    return { usage: null, quota: null, persisted: false };
  }
}

/** Request eviction protection from a user gesture (may prompt in Firefox). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
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
        resolve(normalizeCurrent(parsed));
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Failed to parse import file."));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsText(file);
  });
}

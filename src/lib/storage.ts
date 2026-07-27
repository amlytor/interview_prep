import type { AppData } from "../types";
import { SEED_QUESTIONS } from "./seedQuestions";

const STORAGE_KEY = "quantprep_data_v1";
const CURRENT_VERSION = 1;

function defaultData(): AppData {
  return {
    version: CURRENT_VERSION,
    questions: SEED_QUESTIONS,
    attempts: [],
    srs: [],
    settings: {
      apiKey: "",
      model: "claude-sonnet-4-6",
      spendNote: "",
    },
  };
}

export function loadData(): AppData {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const fresh = defaultData();
    saveData(fresh);
    return fresh;
  }
  try {
    const parsed = JSON.parse(raw) as AppData;
    // Basic shape guard — fall back to defaults if corrupted.
    if (!parsed || !Array.isArray(parsed.questions) || !Array.isArray(parsed.attempts)) {
      throw new Error("malformed data");
    }
    if (!parsed.settings) {
      parsed.settings = defaultData().settings;
    }
    if (!parsed.srs) {
      parsed.srs = [];
    }
    return parsed;
  } catch {
    // Don't clobber whatever bad data is there — back it up before resetting.
    localStorage.setItem(`${STORAGE_KEY}_corrupt_backup_${Date.now()}`, raw);
    const fresh = defaultData();
    saveData(fresh);
    return fresh;
  }
}

export function saveData(data: AppData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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
        if (!parsed.srs) parsed.srs = [];
        if (!parsed.settings) parsed.settings = defaultData().settings;
        resolve(parsed);
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Failed to parse import file."));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsText(file);
  });
}

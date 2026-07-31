// Continuous backup to a real file on disk.
//
// The File System Access API lets the user grant write access to one file once;
// the browser hands back a handle that survives reloads (stored in IndexedDB,
// since handles are structured-cloneable but not JSON-serializable). From then
// on the app writes its whole state to that file whenever anything changes —
// so progress lives somewhere durable instead of only in localStorage.
//
// Chromium-based browsers only. Everywhere else this degrades to the manual
// Export button, which is always available.
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppData } from "../types";
import { keyValueStore } from "./db";

// Minimal structural types for the subset of the API used here, so the code
// compiles regardless of which lib.dom version is in play.
interface WritableStream {
  write(contents: string): Promise<void>;
  close(): Promise<void>;
}
export interface BackupFileHandle {
  name: string;
  createWritable(): Promise<WritableStream>;
  // Optional: some handle flavours (e.g. origin-private filesystem) carry no
  // permission gate at all, in which case access is implicitly granted.
  queryPermission?(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
}

/** Permission state of a handle, treating a missing gate as already granted. */
async function hasWritePermission(handle: BackupFileHandle, request: boolean): Promise<boolean> {
  const check = request ? handle.requestPermission : handle.queryPermission;
  if (typeof check !== "function") return true;
  return (await check.call(handle, { mode: "readwrite" })) === "granted";
}
type SaveFilePicker = (options?: {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<BackupFileHandle>;

function picker(): SaveFilePicker | null {
  const fn = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  return typeof fn === "function" ? fn : null;
}

export function backupSupported(): boolean {
  return picker() !== null;
}

// ---------------------------------------------------------------------------
// Handle persistence (IndexedDB — localStorage can't hold a file handle)
// ---------------------------------------------------------------------------

const KEY = "backupFile";
const handles = keyValueStore("quantprep_backup", "handles");

async function loadHandle(): Promise<BackupFileHandle | null> {
  try {
    return (await handles.get<BackupFileHandle>(KEY)) ?? null;
  } catch {
    return null;
  }
}

async function storeHandle(handle: BackupFileHandle | null): Promise<void> {
  try {
    if (handle) await handles.put(KEY, handle);
    else await handles.remove(KEY);
  } catch (err) {
    // Non-fatal: without persistence the backup simply won't auto-reconnect
    // after a reload. Auto-saving for the rest of this session still works.
    console.warn("QuantPrep couldn't remember the backup file across reloads.", err);
  }
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/** `off` = no file chosen; `reconnect` = file known but permission lapsed. */
export type BackupState = "unsupported" | "off" | "connected" | "reconnect" | "error";

export interface BackupStatus {
  state: BackupState;
  fileName: string | null;
  lastSavedAt: number | null;
  error: string | null;
}

export interface AutoBackup extends BackupStatus {
  /** Prompt for a file and start auto-saving. Must be called from a click. */
  choose: () => Promise<void>;
  /** Re-request permission on a remembered file. Must be called from a click. */
  reconnect: () => Promise<void>;
  /** Forget the file and stop auto-saving. Does not delete the file. */
  disconnect: () => Promise<void>;
  /** Write immediately rather than waiting for the debounce. */
  saveNow: () => Promise<void>;
}

const WRITE_DEBOUNCE_MS = 1500;

export function useAutoBackup(data: AppData): AutoBackup {
  const [handle, setHandle] = useState<BackupFileHandle | null>(null);
  const [status, setStatus] = useState<BackupStatus>({
    state: backupSupported() ? "off" : "unsupported",
    fileName: null,
    lastSavedAt: null,
    error: null,
  });

  // Latest data, so a write triggered outside the effect isn't stale.
  const dataRef = useRef(data);
  dataRef.current = data;
  // Guards against overlapping writes to the same handle.
  const writing = useRef(false);

  // On mount, pick up a file chosen in a previous session. Permission may have
  // lapsed, in which case regaining it needs a user gesture — hence "reconnect".
  useEffect(() => {
    if (!backupSupported()) return;
    let cancelled = false;
    void loadHandle().then(async (saved) => {
      if (cancelled || !saved) return;
      const granted = await hasWritePermission(saved, false);
      if (cancelled) return;
      setHandle(saved);
      setStatus((s) => ({ ...s, state: granted ? "connected" : "reconnect", fileName: saved.name }));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const write = useCallback(async (target: BackupFileHandle) => {
    if (writing.current) return;
    writing.current = true;
    try {
      const writable = await target.createWritable();
      await writable.write(JSON.stringify(dataRef.current, null, 2));
      await writable.close();
      setStatus((s) => ({ ...s, state: "connected", lastSavedAt: Date.now(), error: null }));
    } catch (err) {
      // Most likely the file was moved/deleted, or permission was revoked.
      setStatus((s) => ({
        ...s,
        state: "error",
        error: err instanceof Error ? err.message : "Couldn't write the backup file.",
      }));
    } finally {
      writing.current = false;
    }
  }, []);

  // Debounced auto-save. Each data change resets the timer, so a burst of edits
  // (typing in the note editor) produces one write rather than dozens.
  useEffect(() => {
    if (!handle || status.state !== "connected") return;
    const timer = setTimeout(() => void write(handle), WRITE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [data, handle, status.state, write]);

  const choose = useCallback(async () => {
    const show = picker();
    if (!show) return;
    try {
      const chosen = await show({
        suggestedName: `quantprep-backup-${new Date().toISOString().slice(0, 10)}.json`,
        types: [{ description: "QuantPrep backup", accept: { "application/json": [".json"] } }],
      });
      await storeHandle(chosen);
      setHandle(chosen);
      setStatus({ state: "connected", fileName: chosen.name, lastSavedAt: null, error: null });
      await write(chosen);
    } catch (err) {
      // Dismissing the file picker throws AbortError — that's a cancel, not a failure.
      if (err instanceof DOMException && err.name === "AbortError") return;
      setStatus((s) => ({
        ...s,
        state: "error",
        error: err instanceof Error ? err.message : "Couldn't open the file picker.",
      }));
    }
  }, [write]);

  const reconnect = useCallback(async () => {
    if (!handle) return;
    const granted = await hasWritePermission(handle, true);
    if (!granted) {
      setStatus((s) => ({ ...s, state: "reconnect", error: "Permission denied." }));
      return;
    }
    setStatus((s) => ({ ...s, state: "connected", error: null }));
    await write(handle);
  }, [handle, write]);

  const disconnect = useCallback(async () => {
    await storeHandle(null);
    setHandle(null);
    setStatus({ state: backupSupported() ? "off" : "unsupported", fileName: null, lastSavedAt: null, error: null });
  }, []);

  const saveNow = useCallback(async () => {
    if (handle) await write(handle);
  }, [handle, write]);

  return { ...status, choose, reconnect, disconnect, saveNow };
}

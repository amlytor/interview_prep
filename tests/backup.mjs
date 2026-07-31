// Continuous backup to a file on disk. Only the native file-picker *dialog* is
// stubbed (Playwright cannot drive it); the handle it hands back is a real
// FileSystemFileHandle, so structured-cloning into IndexedDB, persistence
// across reloads, and the write path itself all run for real.
import { APP_URL, launch, nav, reporter, resetApp } from "./harness.mjs";

const { check, finish } = reporter();

const BACKUP_FILE = "quantprep-backup.json";

/**
 * Stubs only the native file-picker dialog. The handle it returns is a *real*
 * FileSystemFileHandle (from the origin-private filesystem), so structured
 * cloning into IndexedDB, persistence across reloads, and the actual write path
 * are all exercised for real rather than faked. `permission` drives the
 * patched permission gate so the reconnect path can be reached.
 */
function stubPicker(permission = "granted") {
  return `
    window.__backup = { writes: 0, permission: ${JSON.stringify(permission)}, requested: 0 };

    const proto = FileSystemFileHandle.prototype;
    proto.queryPermission = async () => window.__backup.permission;
    proto.requestPermission = async () => {
      window.__backup.requested++;
      window.__backup.permission = "granted";
      return "granted";
    };

    // Count COMPLETED writes, not started ones. OPFS's createWritable() streams
    // into a swap file and only swaps it in on close(), so between those two
    // calls the file still reads back as its previous contents — valid,
    // parseable, and stale. A counter incremented at createWritable() would let
    // a waitForFunction pass while the old data is still what's on disk.
    const createWritable = proto.createWritable;
    proto.createWritable = async function (...args) {
      const writable = await createWritable.apply(this, args);
      const close = writable.close.bind(writable);
      writable.close = async (...a) => {
        const r = await close(...a);
        window.__backup.writes++;
        return r;
      };
      return writable;
    };

    window.showSaveFilePicker = async () => {
      const root = await navigator.storage.getDirectory();
      return root.getFileHandle(${JSON.stringify(BACKUP_FILE)}, { create: true });
    };
  `;
}

/**
 * Read back whatever the app wrote to the backup file.
 *
 * Retries while a write is still in flight. The `writes` counter increments
 * when createWritable() is *called*, not when the stream closes, so a caller
 * that waits on the counter can reach here mid-write — and a partially written
 * OPFS file throws NotReadableError/NotFoundError, or yields truncated JSON.
 * That race is timing-dependent on payload size, so it stayed invisible until
 * the seed bank grew past a megabyte.
 */
async function readBackup(page, timeout = 8000) {
  const deadline = Date.now() + timeout;
  let lastErr;
  for (;;) {
    try {
      return await page.evaluate(async (name) => {
        const root = await navigator.storage.getDirectory();
        const file = await (await root.getFileHandle(name)).getFile();
        const text = await file.text();
        return text ? JSON.parse(text) : null;
      }, BACKUP_FILE);
    } catch (err) {
      lastErr = err;
      if (Date.now() > deadline) throw lastErr;
      await page.waitForTimeout(100);
    }
  }
}

const browser = await launch();

// ===========================================================================
// 1. Choose a file, then verify edits are written to it automatically.
// ===========================================================================
{
  const page = await browser.newPage();
  await page.addInitScript(stubPicker());
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await resetApp(page);

  await nav(page, /Settings/);
  await page.waitForSelector(".backup-status");
  check("starts disconnected",
    (await page.locator(".backup-status").textContent())?.includes("Not backing up"));

  await page.getByRole("button", { name: "Choose backup file..." }).click();
  await page.waitForSelector(".backup-connected", { timeout: 5000 });
  check("connects to the chosen file",
    (await page.locator(".backup-status").textContent())?.includes("quantprep-backup.json"));

  // The counter increments on close(), not on createWritable(), so a large
  // payload can still be streaming when .backup-connected appears. Wait for the
  // completed write rather than sampling the instant the UI updates.
  let initialWrites = 0;
  try {
    await page.waitForFunction(() => window.__backup.writes > 0, null, { timeout: 5000 });
    initialWrites = await page.evaluate(() => window.__backup.writes);
  } catch {
    initialWrites = await page.evaluate(() => window.__backup.writes);
  }
  check("writes immediately on connect", initialWrites === 1, `${initialWrites} writes`);

  const firstPayload = await readBackup(page);
  check("the file on disk contains a full, valid backup",
    Array.isArray(firstPayload?.questions) && Array.isArray(firstPayload?.studyNotes),
    `${firstPayload?.questions?.length} questions, ${firstPayload?.studyNotes?.length} notes`);

  // Make a real change elsewhere in the app and confirm it lands in the file.
  await nav(page, /Topics/);
  await page.getByRole("button", { name: "+ New topic" }).click();
  await page.waitForSelector("#topicTitle");
  await page.fill("#topicTitle", "Optional stopping");
  await page.getByRole("button", { name: "Create topic" }).click();

  await page.waitForFunction(() => window.__backup.writes > 1, null, { timeout: 8000 });
  const latest = await readBackup(page);
  check("a change made anywhere in the app is auto-saved to the file",
    latest.customTopics.some((t) => t.id === "optional-stopping"),
    JSON.stringify(latest.customTopics));

  // Debounce: a burst of keystrokes must not produce a write per character.
  const before = await page.evaluate(() => window.__backup.writes);
  await page.getByRole("button", { name: "Edit" }).first().click();
  await page.locator("textarea").first().fill("## Core idea\nDoob's optional stopping theorem.");
  await page.getByRole("button", { name: "Save note" }).click();
  await page.waitForTimeout(3000);
  const after = await page.evaluate(() => window.__backup.writes);
  check("writes are debounced, not one per keystroke", after - before <= 2, `${after - before} writes`);

  const finalPayload = await readBackup(page);
  check("the note edit reached the file",
    finalPayload.studyNotes.some((n) => n.body.includes("optional stopping theorem")));

  // Disconnecting stops auto-saving without touching the data.
  await nav(page, /Settings/);
  await page.getByRole("button", { name: "Stop backing up" }).click();
  await page.waitForTimeout(300);
  check("can stop backing up",
    (await page.locator(".backup-status").textContent())?.includes("Not backing up"));

  const writesAtStop = await page.evaluate(() => window.__backup.writes);
  await nav(page, /Topics/);
  await page.getByRole("button", { name: "+ New topic" }).click();
  await page.waitForSelector("#topicTitle");
  await page.fill("#topicTitle", "After disconnect");
  await page.getByRole("button", { name: "Create topic" }).click();
  await page.waitForTimeout(3000);
  check("no further writes once disconnected",
    (await page.evaluate(() => window.__backup.writes)) === writesAtStop);

  await page.close();
}

// ===========================================================================
// 2. A remembered file whose permission lapsed asks to reconnect.
// ===========================================================================
{
  const page = await browser.newPage();
  await page.addInitScript(stubPicker("prompt"));
  await page.goto(APP_URL, { waitUntil: "networkidle" });

  // Connect normally, then reload: the handle must come back from IndexedDB on
  // its own. Permission is reported as lapsed on the next load.
  await nav(page, /Settings/);
  await page.getByRole("button", { name: /Choose backup file/ }).click();
  await page.waitForSelector(".backup-connected", { timeout: 5000 });
  await page.evaluate(() => { window.__backup.permission = "prompt"; });
  await page.reload({ waitUntil: "networkidle" });

  await nav(page, /Settings/);
  await page.waitForSelector(".backup-status");
  check("remembers the file across a reload",
    (await page.locator(".backup-status").textContent())?.includes("quantprep-backup.json"));
  check("asks for permission rather than silently failing",
    (await page.locator(".backup-reconnect").count()) === 1);

  const writesBefore = await page.evaluate(() => window.__backup.writes);
  check("does not write while permission is missing", writesBefore === 0, `${writesBefore} writes`);

  await page.getByRole("button", { name: /Reconnect/ }).click();
  await page.waitForSelector(".backup-connected", { timeout: 5000 });
  check("reconnect re-requests permission and resumes",
    (await page.evaluate(() => window.__backup.requested)) === 1);
  // Wait rather than sample: `writes` now counts COMPLETED writes, which land
  // shortly after the UI reports the connection.
  await page.waitForFunction(() => window.__backup.writes > 0, null, { timeout: 8000 });
  check("writes once reconnected", (await page.evaluate(() => window.__backup.writes)) > 0);

  await page.close();
}

// ===========================================================================
// 3. Browsers without the API get a clear explanation, not a broken button.
// ===========================================================================
{
  const page = await browser.newPage();
  await page.addInitScript("delete window.showSaveFilePicker;");
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await nav(page, /Settings/);
  await page.waitForTimeout(400);
  const body = (await page.locator("body").textContent()) ?? "";
  check("unsupported browsers are told why and pointed at manual export",
    body.includes("File System Access API") && body.includes("Export to JSON"));
  check("no backup buttons offered when unsupported",
    (await page.getByRole("button", { name: /Choose backup file/ }).count()) === 0);
  await page.close();
}

await browser.close();
finish();

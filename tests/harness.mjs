// Shared bits for the end-to-end suites.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

export const APP_URL = process.env.APP_URL ?? "http://localhost:4173/";
export const MOCK_URL = process.env.MOCK_URL ?? "http://localhost:4599/v1";

// Read from the seed file rather than hardcoded, so adding a topic doesn't
// break unrelated suites. The assertions that use this are about the DELTA
// from creating or deleting a custom topic, not about the taxonomy's size.
export const SEEDED_TOPICS = JSON.parse(
  readFileSync(new URL("../src/data/studyNotes.json", import.meta.url), "utf8"),
).notes.length;

/**
 * Launch Chromium. Honours CHROMIUM_PATH for environments with a pre-installed
 * browser; otherwise Playwright resolves its own (run `npx playwright install
 * chromium` once).
 */
export function launch() {
  return chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
}

/**
 * Click a sidebar destination. Scoped to the nav because page content can carry
 * buttons with the same words ("Start Drilling" vs the Drill nav item).
 */
export function nav(page, name) {
  return page.locator("nav.sidebar").getByRole("button", { name }).click();
}

// ---------------------------------------------------------------------------
// Persisted state (IndexedDB)
// ---------------------------------------------------------------------------
// The app keeps everything in IndexedDB — localStorage only holds the two
// pre-migration keys, which are read once and then retired. These helpers are
// what the suites use to inspect and seed saved state; they mirror the app's
// own database names exactly, and their onupgradeneeded creates the store the
// same way, so a test that runs before the app has ever loaded can't leave a
// storeless database behind for the app to trip over.

const STATE_DB = "quantprep";
const STATE_STORE = "app";
const STATE_KEY = "data";

// The stored value is an envelope, `{ revision, data }`. Tests care about the
// payload, so these helpers unwrap on read and re-wrap (bumping the revision,
// as a real commit would) on write. A bare payload — anything written before
// the envelope existed — is still accepted on read. The unwrapping is inlined
// into each helper rather than shared, because these bodies run in the browser
// and can't close over anything defined out here.

/** Body of the in-page IDB open, shared by the helpers below. */
function openArgs() {
  return [STATE_DB, STATE_STORE, STATE_KEY];
}

/** The app's saved state, or null if nothing has been persisted yet. */
export function readState(page) {
  return page.evaluate(
    ([dbName, storeName, key]) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(storeName)) {
            request.result.createObjectStore(storeName);
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          const get = db.transaction(storeName, "readonly").objectStore(storeName).get(key);
          get.onsuccess = () => {
            db.close();
            const raw = get.result;
            resolve(
              raw && typeof raw === "object" && typeof raw.revision === "number" && raw.data
                ? raw.data
                : (raw ?? null),
            );
          };
          get.onerror = () => reject(get.error);
        };
        request.onerror = () => reject(request.error);
      }),
    openArgs(),
  );
}

/**
 * Read the saved state, transform it in the page, and write it back.
 *
 * `mutate` runs in the browser, not in Node — it is shipped across as source
 * and rebuilt there, so it must not close over anything. Whatever it returns
 * is handed back to the caller, which is how the fixtures report what they
 * changed. Keeping the payload in the page also avoids serialising ~4 MB of
 * question bank over the wire twice per call.
 */
export function writeState(page, mutate) {
  return page.evaluate(
    async ([dbName, storeName, key, source]) => {
      const apply = new Function(`return (${source})`)();
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(storeName)) {
            request.result.createObjectStore(storeName);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const envelope = await new Promise((resolve, reject) => {
        const get = db.transaction(storeName, "readonly").objectStore(storeName).get(key);
        get.onsuccess = () => resolve(get.result ?? null);
        get.onerror = () => reject(get.error);
      });
      const wrapped =
        envelope && typeof envelope.revision === "number" && envelope.data
          ? envelope
          : { revision: 0, data: envelope };
      const report = apply(wrapped.data);
      await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        // Bump the revision the way a real commit does, so a running tab treats
        // this as a change it hasn't seen rather than ignoring it.
        tx.objectStore(storeName).put({ revision: wrapped.revision + 1, data: wrapped.data }, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      return report ?? null;
    },
    [...openArgs(), mutate.toString()],
  );
}

/** Write a state object built in Node (used to seed a specific payload). */
export function putState(page, state) {
  return page.evaluate(
    async ([dbName, storeName, key, value]) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(storeName)) {
            request.result.createObjectStore(storeName);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).put({ revision: 1, data: value }, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    [...openArgs(), state],
  );
}

/**
 * Wipe everything the app persists: the IndexedDB database and both legacy
 * localStorage keys. Deleting the database can block on the connection the app
 * itself is holding, which it releases via onversionchange — hence the resolve
 * on `onblocked` as well, so a suite can never hang here.
 */
export function clearState(page) {
  return page.evaluate(
    ([dbName]) =>
      new Promise((resolve) => {
        localStorage.clear();
        const request = indexedDB.deleteDatabase(dbName);
        request.onsuccess = resolve;
        request.onerror = resolve;
        request.onblocked = resolve;
      }),
    openArgs(),
  );
}

/**
 * Wait until the running app has persisted something.
 *
 * Wiping storage out from under a page that is still booting is a race: the
 * save issued by the first load can land AFTER the wipe, quietly restoring a
 * fresh install over whatever fixture the test just planted. Once a payload is
 * readable, every write the load issued has committed, and IndexedDB orders
 * anything that comes next behind it.
 */
export async function waitForSaved(page, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await readState(page)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("the app never persisted its state");
}

/** Clear saved state and reload into a guaranteed-fresh install. */
export async function resetApp(page) {
  await waitForSaved(page);
  await clearState(page);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("nav.sidebar");
}

/** Collects pass/fail lines and exits non-zero if anything failed. */
export function reporter() {
  const results = [];
  return {
    check(name, ok, detail = "") {
      results.push(Boolean(ok));
      console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
    },
    finish() {
      const failed = results.filter((r) => !r).length;
      console.log(`\n${results.length - failed}/${results.length} passed`);
      process.exit(failed === 0 ? 0 : 1);
    },
  };
}

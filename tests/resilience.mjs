// What the app does when the browser refuses to store things.
//
// These are not exotic. "Block site data" is a checkbox in every browser's
// settings, some enterprise policies set it, and private windows restrict one
// or both stores. The rule the suite enforces: losing storage costs you
// persistence, never the app — and never silently.
//
// The bug this suite exists for: localStorage's property getter THROWS when
// site data is blocked, rather than returning an empty store. That rejected
// loadData(), whose promise nothing caught, and the app sat on its loading
// screen forever with nothing on screen to explain it.
import { APP_URL, launch, reporter, waitForSaved } from "./harness.mjs";

const { check, finish } = reporter();
const browser = await launch();

// Replaces window.localStorage with one that throws SecurityError on contact.
const blockLocalStorage = () => {
  const boom = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get: () => ({ getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, length: 0 }),
  });
};

/** Boot the app under `initScript` and report whether it came up. */
async function boot(initScript) {
  const page = await browser.newPage();
  await page.addInitScript(initScript);
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  // Long enough that a hang is a hang, not a slow load.
  const booted = await page
    .waitForSelector("nav.sidebar", { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  return { page, booted };
}

// ===========================================================================
// 1. Site data blocked: every localStorage access throws.
// ===========================================================================
{
  const { page, booted } = await boot(blockLocalStorage);
  check("localStorage blocked: the app still boots", booted);
  check("localStorage blocked: it does not hang on the loading screen",
    (await page.locator(".app-loading").count()) === 0);
  check("localStorage blocked: the seeded bank is there",
    (await page.locator(".stat-value, .topic-card, h1").count()) > 0);

  // IndexedDB is untouched here, so saving still works and no alarm is raised.
  await waitForSaved(page);
  check("localStorage blocked: IndexedDB still saves, so no false alarm",
    (await page.getByText("Not saving.").count()) === 0);
  await page.close();
}

// ===========================================================================
// 2. IndexedDB refused: the app runs, but says out loud that it isn't saving.
// ===========================================================================
{
  const { page, booted } = await boot(() => {
    // Every open() fails asynchronously, the way a denied request does.
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      get: () => ({
        open: () => {
          const request = { onerror: null, onsuccess: null, onupgradeneeded: null, onblocked: null,
            error: new DOMException("denied", "UnknownError") };
          setTimeout(() => request.onerror?.({ target: request }), 0);
          return request;
        },
        deleteDatabase: () => ({ onerror: null, onsuccess: null, onblocked: null }),
      }),
    });
  });
  check("IndexedDB refused: the app still boots", booted);
  check("IndexedDB refused: it does not hang on the loading screen",
    (await page.locator(".app-loading").count()) === 0);

  // The important half: a session that cannot persist must SAY so. Losing work
  // quietly is worse than not starting.
  const warned = await page
    .waitForSelector("text=Not saving.", { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  check("IndexedDB refused: the user is warned that nothing is being saved", warned);
  check("IndexedDB refused: the warning points at exporting",
    ((await page.locator(".banner-error").first().textContent()) ?? "").includes("Export to JSON"));
  await page.close();
}

// ===========================================================================
// 3. Neither store available — the worst case still has to render.
// ===========================================================================
{
  const { page, booted } = await boot(() => {
    const boom = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => ({ getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, length: 0 }),
    });
    Object.defineProperty(window, "indexedDB", { configurable: true, get: () => undefined });
  });
  check("no storage at all: the app still boots", booted);
  check("no storage at all: it does not hang on the loading screen",
    (await page.locator(".app-loading").count()) === 0);
  check("no storage at all: the user is warned",
    (await page.getByText("Not saving.").count()) === 1);

  // And it must still be usable, not just visible.
  await page.locator("nav.sidebar").getByRole("button", { name: /Topics/ }).click();
  await page.waitForSelector(".topic-card", { timeout: 8000 });
  check("no storage at all: the app is still usable, not just rendered",
    (await page.locator(".topic-card").count()) > 40, `${await page.locator(".topic-card").count()} cards`);
  await page.close();
}

// ===========================================================================
// 4. Control: a normal browser shows none of this.
// ===========================================================================
{
  const { page, booted } = await boot(() => {});
  await waitForSaved(page);
  check("control: normal browser boots", booted);
  check("control: no save warning on a healthy browser",
    (await page.getByText("Not saving.").count()) === 0);
  await page.close();
}

await browser.close();
finish();

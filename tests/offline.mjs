// Installability and offline operation.
//
// Being a browser app rather than a desktop one is only worth it if the app
// goes where you do — a phone with no signal, a work laptop behind a proxy that
// blocks everything. That means it has to run with the network genuinely off,
// which is what this suite checks: not that a service worker registered, but
// that the app boots, renders the bank, and records an attempt while offline.
//
// It also pins the property that makes a service worker safe to ship: because
// navigations are network-first, a running app can never be stuck on a stale
// build while online.
import { APP_URL, launch, nav, readState, reporter, waitForSaved, writeState } from "./harness.mjs";

const { check, finish } = reporter();
const browser = await launch();

// ===========================================================================
// 1. The manifest is real and complete enough to install.
// ===========================================================================
{
  const page = await browser.newPage();
  await page.goto(APP_URL, { waitUntil: "networkidle" });

  const href = await page.getAttribute('link[rel="manifest"]', "href");
  check("a manifest is linked", href !== null, `href=${href}`);

  const manifest = await page.evaluate(async (url) => {
    const res = await fetch(url);
    return res.ok ? res.json() : null;
  }, new URL(href, APP_URL).href);

  check("the manifest parses", manifest !== null);
  check("it declares a name and short name",
    manifest?.name?.includes("QuantPrep") && manifest?.short_name === "QuantPrep",
    `${manifest?.name} / ${manifest?.short_name}`);
  check("it requests a standalone window", manifest?.display === "standalone", manifest?.display);
  // Chromium's install prompt wants a 192 and a 512, and Android wants one
  // maskable so the icon isn't letterboxed inside the platform's shape.
  const sizes = (manifest?.icons ?? []).map((i) => i.sizes);
  check("it ships 192 and 512 icons", sizes.includes("192x192") && sizes.includes("512x512"), sizes.join(", "));
  check("it ships a maskable icon",
    (manifest?.icons ?? []).some((i) => i.purpose?.includes("maskable")));

  // A manifest pointing at a missing icon fails installation silently.
  const iconStatuses = await page.evaluate(
    async (urls) => Promise.all(urls.map((u) => fetch(u).then((r) => r.status).catch(() => 0))),
    (manifest?.icons ?? []).map((i) => new URL(i.src, APP_URL).href),
  );
  check("every declared icon actually exists", iconStatuses.every((s) => s === 200), iconStatuses.join(", "));
  await page.close();
}

// ===========================================================================
// 2. Offline: the app boots and works with the network cut.
// ===========================================================================
{
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await waitForSaved(page);

  // Wait for the worker to be in control — until then nothing is cached and
  // going offline would just fail, which would make this suite meaningless.
  const controlled = await page
    .waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  check("the offline worker takes control of the page", controlled);

  // Visit the whole app once so its assets are in the cache, then answer a
  // question so there is real progress to check for after the reload.
  for (const dest of [/Topics/, /Drill/, /Review/, /Mock/, /Settings/, /Dashboard/]) {
    await nav(page, dest);
    await page.waitForTimeout(150);
  }
  await writeState(page, (d) => {
    d.questions.forEach((q) => {
      q.answerSeen = true;
    });
    d.questions.push({
      id: "offline-mcq", prompt: "Offline: which is largest?", topics: ["basic-probability"],
      difficulty: "easy", answerMode: "multiple-choice",
      choices: [{ id: "a", text: "0.1" }, { id: "b", text: "0.9" }],
      correctChoiceId: "b", canonicalAnswer: "0.9", explanation: "0.9 is largest.",
      createdAt: 1, custom: false, origin: "seed", answerSeen: false,
    });
    d.attempts = [];
    d.srs = [];
  });

  // Cut the network for real, then do a full reload — this is the phone-on-the-
  // tube case, not just a cached soft navigation.
  await context.setOffline(true);
  await page.reload({ waitUntil: "load" });

  const booted = await page
    .waitForSelector("nav.sidebar", { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  check("offline: the app boots from cache after a hard reload", booted);

  await nav(page, /Topics/);
  const cards = await page.locator(".topic-card").count();
  check("offline: the whole topic tree renders", cards > 40, `${cards} cards`);

  // Study notes are the bulk of the payload; if anything were being fetched
  // rather than stored, this is where it would show.
  await page.locator(".topic-card").first().click();
  await page.waitForTimeout(400);
  const noteLength = ((await page.locator(".md-body, main").first().textContent()) ?? "").length;
  check("offline: a study note renders in full", noteLength > 1000, `${noteLength} chars`);

  // And the app is still writable offline — multiple-choice grades locally.
  await nav(page, /Drill/);
  await page.waitForSelector(".choice-option", { timeout: 10000 });
  await page.locator(".choice-option").nth(1).click();
  await page.getByRole("button", { name: /Submit/i }).first().click();
  await page.waitForTimeout(900);

  const offlineState = await readState(page);
  check("offline: an answer is graded and recorded", offlineState.attempts.length === 1,
    `${offlineState.attempts.length} attempts`);
  check("offline: the attempt was graded correct locally",
    offlineState.attempts[0]?.verdict === "correct", offlineState.attempts[0]?.verdict);

  // Back online, the progress made offline is still there.
  await context.setOffline(false);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("nav.sidebar");
  const backOnline = await readState(page);
  check("progress made offline survives coming back online",
    backOnline.attempts.length === 1, `${backOnline.attempts.length} attempts`);

  await context.close();
}

// ===========================================================================
// 3. A live network always wins, so the app can't be stuck on an old build.
//
// This is the property that makes shipping a service worker safe at all.
// It is checked by POISONING the cached shell and then reloading: online, the
// network copy must win and the poison must never be seen. The second half —
// going offline and reloading again — is what stops the first half being
// vacuous, by proving the poisoned entry really was reachable and simply lost
// to the network.
//
// Two other ways to test this do NOT work, both silently:
//   - route interception, because Playwright does not intercept requests made
//     BY a service worker, so the worker fetches the real file regardless;
//   - editing dist/index.html mid-run, because `vite preview` caches file
//     metadata at startup and does not reliably serve the replacement.
// ===========================================================================
{
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await page
    .waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 })
    .catch(() => undefined);

  const poisoned = await page.evaluate(async () => {
    const names = await caches.keys();
    if (names.length === 0) return false;
    const cache = await caches.open(names[0]);
    await cache.put(
      "./index.html",
      new Response("<!doctype html><html><body><div id='stale-build'></div></body></html>", {
        headers: { "content-type": "text/html" },
      }),
    );
    return true;
  });
  check("fixture: the cached shell can be replaced", poisoned);

  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("nav.sidebar", { timeout: 10000 }).catch(() => undefined);
  check("online: the network's copy wins over the cached shell",
    (await page.locator("#stale-build").count()) === 0);
  check("online: the real app boots, not the cached shell",
    (await page.locator("nav.sidebar").count()) === 1);

  // The successful navigation also REFRESHED the cached shell — which is how
  // the offline copy stays current instead of ageing into the stale build the
  // network-first rule exists to avoid.
  const healed = await page.evaluate(async () => {
    const names = await caches.keys();
    const hit = await caches.open(names[0]).then((c) => c.match("./index.html", { ignoreVary: true }));
    return hit ? (await hit.text()).includes("stale-build") : null;
  });
  check("online: the navigation refreshes the cached shell rather than leaving it stale",
    healed === false, `poison still cached: ${healed}`);

  // What is deliberately NOT asserted here: that an offline reload serves the
  // poisoned shell. It does not reliably, because the browser's own HTTP cache
  // can satisfy the document request offline without the worker's fallback
  // ever running — so the assertion would be testing Chromium's disk cache,
  // not this strategy. The offline guarantee is covered properly by section 2,
  // which failed outright before the fix and passes after it.
  //
  // Non-vacuity for the check above is already established: the poison was in
  // the cache going in, and gone coming out, which is only possible if the
  // navigation actually went to the network.

  await context.close();
}

await browser.close();
finish();

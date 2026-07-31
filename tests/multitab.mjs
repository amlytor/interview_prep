// Two tabs open on the same origin.
//
// The bug this suite exists for: each tab held its own copy of the state and
// wrote the whole thing on every change, so a tab that had been open for ten
// minutes would overwrite everything done in the other one the moment you
// touched it. Nothing warned you; the work was simply gone on next load.
//
// Two mechanisms fix it, and they are tested separately because only the first
// is load-bearing:
//   1. commitData() applies each change INSIDE the transaction that reads the
//      current state, so a write can only ever be a change to the live value,
//      never a replacement of it. This is what makes concurrency safe.
//   2. BroadcastChannel tells the other tab to re-read, so it also stays
//      visually current. Convenience — remove it and nothing is lost.
//
// Both pages must live in ONE browser context. Playwright's browser.newPage()
// makes a fresh context each time, and separate contexts get separate storage,
// which would quietly make every assertion here vacuous.
import {
  APP_URL, SEEDED_TOPICS, launch, nav, readState, reporter, waitForSaved, writeState,
} from "./harness.mjs";

const { check, finish } = reporter();
const browser = await launch();

/** Create a custom topic through the real UI. */
async function createTopic(page, title) {
  await nav(page, /Topics/);
  await page.getByRole("button", { name: "+ New topic" }).click();
  await page.waitForSelector("#topicTitle");
  await page.fill("#topicTitle", title);
  await page.fill("#topicBody", `## Core idea\nNotes for ${title}.`);
  await page.getByRole("button", { name: "Create topic" }).click();
  await page.waitForTimeout(500);
}

const titles = (state) => (state?.customTopics ?? []).map((t) => t.label).sort();

// ===========================================================================
// 1. A stale tab must not clobber the other one — WITHOUT cross-tab sync.
//
// BroadcastChannel is disabled here on purpose. With it on, the second tab
// would have refreshed itself and never been stale in the first place, so this
// scenario would pass without the atomic commit doing any work at all. Turning
// it off is what actually points the test at the fix.
// ===========================================================================
{
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(window, "BroadcastChannel", { configurable: true, get: () => undefined });
  });

  const tabA = await context.newPage();
  await tabA.goto(APP_URL, { waitUntil: "networkidle" });
  await waitForSaved(tabA);

  // Tab B loads now, and from here on its in-memory copy is frozen in the past.
  const tabB = await context.newPage();
  await tabB.goto(APP_URL, { waitUntil: "networkidle" });
  await tabB.waitForSelector("nav.sidebar");

  await createTopic(tabA, "Alpha from tab A");
  const afterA = await readState(tabA);
  check("no sync: tab A's topic is saved", titles(afterA).includes("Alpha from tab A"), titles(afterA).join(", "));

  // Tab B still believes the world has no "Alpha". Under the old code its write
  // was a full snapshot, so this next line destroyed tab A's work.
  await createTopic(tabB, "Beta from tab B");
  const afterB = await readState(tabB);

  check("no sync: a stale tab's write does NOT destroy the other tab's work",
    titles(afterB).includes("Alpha from tab A"), titles(afterB).join(", "));
  check("no sync: the stale tab's own change is saved too",
    titles(afterB).includes("Beta from tab B"), titles(afterB).join(", "));
  check("no sync: both notes survive, exactly once each",
    afterB.studyNotes.length === SEEDED_TOPICS + 2, `${afterB.studyNotes.length} notes`);
  check("no sync: the seeded bank is not disturbed",
    afterB.questions.length === afterA.questions.length, `${afterB.questions.length} questions`);

  await context.close();
}

// ===========================================================================
// 2. With sync on, the other tab reflects the change without a reload.
// ===========================================================================
{
  const context = await browser.newContext();
  const tabA = await context.newPage();
  await tabA.goto(APP_URL, { waitUntil: "networkidle" });
  await waitForSaved(tabA);

  const tabB = await context.newPage();
  await tabB.goto(APP_URL, { waitUntil: "networkidle" });
  await nav(tabB, /Topics/);
  await tabB.waitForSelector(".topic-card");
  const before = await tabB.locator(".topic-card").count();

  await createTopic(tabA, "Gamma from tab A");

  // No reload, no navigation — tab B should pick this up on its own.
  const appeared = await tabB
    .locator(".topic-card-title", { hasText: "Gamma from tab A" })
    .first()
    .waitFor({ timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check("sync: a topic created in tab A appears in tab B without a reload", appeared);
  check("sync: tab B's tree grew by exactly one",
    (await tabB.locator(".topic-card").count()) === before + 1,
    `${before} -> ${await tabB.locator(".topic-card").count()}`);

  await context.close();
}

// ===========================================================================
// 3. Near-simultaneous writes in both tabs: both must land.
// ===========================================================================
{
  const context = await browser.newContext();
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  await tabA.goto(APP_URL, { waitUntil: "networkidle" });
  await waitForSaved(tabA);
  await tabB.goto(APP_URL, { waitUntil: "networkidle" });
  await tabB.waitForSelector("nav.sidebar");

  // Park both on a filled-in New Topic form, then submit them together, so the
  // two commits race rather than being neatly ordered by the test.
  for (const [page, title] of [[tabA, "Race A"], [tabB, "Race B"]]) {
    await nav(page, /Topics/);
    await page.getByRole("button", { name: "+ New topic" }).click();
    await page.waitForSelector("#topicTitle");
    await page.fill("#topicTitle", title);
    await page.fill("#topicBody", `## Core idea\n${title}.`);
  }
  await Promise.all([
    tabA.getByRole("button", { name: "Create topic" }).click(),
    tabB.getByRole("button", { name: "Create topic" }).click(),
  ]);
  await tabA.waitForTimeout(1200);

  const final = await readState(tabA);
  check("race: both tabs' topics survive a simultaneous write",
    titles(final).includes("Race A") && titles(final).includes("Race B"), titles(final).join(", "));
  check("race: neither is duplicated",
    final.studyNotes.length === SEEDED_TOPICS + 2, `${final.studyNotes.length} notes`);

  await context.close();
}

// ===========================================================================
// 4. Attempt history — the thing that actually hurts to lose — merges too.
// ===========================================================================
{
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(window, "BroadcastChannel", { configurable: true, get: () => undefined });
  });
  const tabA = await context.newPage();
  await tabA.goto(APP_URL, { waitUntil: "networkidle" });
  await waitForSaved(tabA);

  // Pin a multiple-choice question so Drill is guaranteed to serve one: it is
  // graded locally, so the attempt lands without a provider. Marking everything
  // else seen leaves this as the only fresh question, which is what practice
  // selection prefers. Done before tab B loads, so tab B starts from this state.
  await writeState(tabA, (d) => {
    d.questions.forEach((q) => {
      q.answerSeen = true;
    });
    d.questions.push({
      id: "multitab-mcq", prompt: "Which is the probability of a fair coin landing heads?",
      topics: ["basic-probability"], difficulty: "easy", answerMode: "multiple-choice",
      choices: [
        { id: "c1", text: "0.25" },
        { id: "c2", text: "0.5" },
        { id: "c3", text: "0.75" },
      ],
      correctChoiceId: "c2", canonicalAnswer: "0.5",
      explanation: "A fair coin is symmetric.", createdAt: 1, custom: false, origin: "seed",
      answerSeen: false,
    });
    d.attempts = [];
    d.srs = [];
  });
  await tabA.reload({ waitUntil: "networkidle" });
  await tabA.waitForSelector("nav.sidebar");

  const tabB = await context.newPage();
  await tabB.goto(APP_URL, { waitUntil: "networkidle" });
  await tabB.waitForSelector("nav.sidebar");

  await nav(tabA, /Drill/);
  await tabA.waitForSelector(".choice-option", { timeout: 10000 });
  await tabA.locator(".choice-option").first().click();
  await tabA.getByRole("button", { name: /Submit/i }).first().click();
  await tabA.waitForTimeout(900);

  const attemptsAfterA = (await readState(tabA)).attempts.length;
  check("attempts: tab A recorded an attempt", attemptsAfterA === 1, `${attemptsAfterA} attempts`);

  // Tab B, still stale, now writes. Its copy has zero attempts.
  await createTopic(tabB, "Delta from tab B");
  const final = await readState(tabB);
  check("attempts: a stale tab's write does not erase attempt history",
    final.attempts.length === attemptsAfterA, `${final.attempts.length} vs ${attemptsAfterA}`);
  check("attempts: the stale tab's own change still lands",
    titles(final).includes("Delta from tab B"), titles(final).join(", "));

  await context.close();
}

await browser.close();
finish();

// Mock Interview and Review, end to end.
//
// Both pages were entirely uncovered: every other suite drives Drill, Topics or
// Settings. A whole page with no test is where bugs sit unnoticed, and this one
// found the debrief printing raw topic slugs ("basic-probability") where the
// rest of the app shows a label ("Basic probability").
//
// The bank is stocked with multiple-choice questions on purpose. They are
// graded locally, so both flows run without a provider and without the mock —
// which keeps this suite about the flows themselves rather than about grading.
import { APP_URL, launch, nav, readState, reporter, waitForSaved, writeState } from "./harness.mjs";

const { check, finish } = reporter();
const browser = await launch();
const page = await browser.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 180)));
page.on("console", (m) => {
  const text = m.text();
  // The sandbox has no network; the model-catalogue fetch is meant to fail.
  if (/net::ERR_|Failed to fetch|NetworkError/.test(text)) return;
  if (m.type() === "error") errors.push(text.slice(0, 180));
});

await page.goto(APP_URL, { waitUntil: "networkidle" });
await waitForSaved(page);

// Marking the seeded bank as seen leaves these eight as the only fresh
// questions, so practice selection is guaranteed to serve them.
await writeState(page, (d) => {
  d.questions.forEach((q) => {
    q.answerSeen = true;
  });
  for (let i = 1; i <= 8; i++) {
    d.questions.push({
      id: `flow-mcq-${i}`, prompt: `Flow question ${i}: which is largest?`,
      topics: ["basic-probability"], difficulty: "easy", answerMode: "multiple-choice",
      choices: [{ id: "a", text: "0.1" }, { id: "b", text: "0.9" }, { id: "c", text: "0.5" }],
      correctChoiceId: "b", canonicalAnswer: "0.9", explanation: "0.9 is largest.",
      createdAt: 1, custom: false, origin: "seed", answerSeen: false,
    });
  }
  d.attempts = [];
  d.srs = [];
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("nav.sidebar");

// ===========================================================================
// Mock Interview: a full session through to the debrief.
// ===========================================================================
await nav(page, /Mock/);
await page.getByRole("button", { name: /Start Mock Interview/i }).click();
await page.waitForSelector(".choice-option", { timeout: 10000 });

// Answer every question wrong on purpose — a clean sweep would leave the weak-
// topics panel empty, which is the panel under test.
let answered = 0;
for (let i = 0; i < 10; i++) {
  if ((await page.locator(".choice-option").count()) === 0) break;
  await page.locator(".choice-option").first().click(); // "0.1", the wrong one
  const advance = page.getByRole("button", { name: /Next|Submit|Finish/i }).first();
  if ((await advance.count()) === 0) break;
  await advance.click();
  answered++;
  await page.waitForTimeout(300);
}
check("mock: the session serves and accepts a full set of questions", answered === 5, `${answered} answered`);

await page.waitForSelector(".stat-label", { timeout: 10000 });
const debrief = ((await page.locator("main").textContent()) ?? "").replace(/\s+/g, " ");
check("mock: the debrief appears once the session ends", debrief.includes("Mock Interview Debrief"));
check("mock: it scores the session", debrief.includes("0 correct"), debrief.slice(0, 80));

// The bug this suite was written on: raw topic ids leaking into the UI.
check("mock: weak topics are shown as labels, not raw slugs",
  debrief.includes("Basic probability (5)") && !debrief.includes("basic-probability"),
  debrief.slice(debrief.indexOf("Weak Topics"), debrief.indexOf("Weak Topics") + 60));

const afterMock = await readState(page);
check("mock: every answer is recorded", afterMock.attempts.length === 5, `${afterMock.attempts.length} attempts`);
check("mock: attempts are tagged as mock, not drill",
  afterMock.attempts.every((a) => a.source === "mock"),
  [...new Set(afterMock.attempts.map((a) => a.source))].join(", "));

// ===========================================================================
// Review: a due question resurfaces, and answering it advances the ladder.
// ===========================================================================
await writeState(page, (d) => {
  d.srs = [{
    questionId: "flow-mcq-1", stage: 0, nextReviewAt: Date.now() - 86400000,
    lastResult: "incorrect", updatedAt: Date.now() - 2 * 86400000, trickleCredit: 0,
  }];
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("nav.sidebar");

const sidebar = ((await page.locator("nav.sidebar").textContent()) ?? "").replace(/\s+/g, " ");
check("review: the sidebar shows a due count", /Review\s*1/.test(sidebar), sidebar.slice(0, 90));

await nav(page, /Review/);
await page.waitForSelector(".choice-option", { timeout: 10000 });
check("review: a due question is served", true);

await page.locator(".choice-option").nth(1).click(); // "0.9", correct this time
await page.getByRole("button", { name: /Submit/i }).first().click();
await page.waitForTimeout(900);

const afterReview = await readState(page);
const srs = afterReview.srs.find((s) => s.questionId === "flow-mcq-1");
check("review: a correct answer advances the SRS stage", srs?.stage === 1, `stage=${srs?.stage}`);
// Stage 1 is the 7-day rung of the 2 → 7 → 21 ladder.
const days = srs ? Math.round((srs.nextReviewAt - Date.now()) / 86400000) : null;
check("review: it is rescheduled onto the 7-day rung", days === 7, `${days} days`);
check("review: the attempt is tagged as review",
  afterReview.attempts.some((a) => a.source === "review"),
  [...new Set(afterReview.attempts.map((a) => a.source))].join(", "));

check("no runtime errors across either flow", errors.length === 0, errors.join(" | "));

await browser.close();
finish();

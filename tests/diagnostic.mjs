// The four diagnostic changes: daily streak, spoiler-free staging, difficulty
// calibration, and the "why did I get this wrong?" chat. Runs against the mock
// provider, so the AI paths execute end to end without a real key.
import { APP_URL, MOCK_URL, launch, nav, readState, reporter, resetApp, writeState } from "./harness.mjs";

// DAY is injected into the seeded snippets below rather than used here.

const { check, finish } = reporter();


/**
 * Seed the saved state with a known payload, then reload into it.
 *
 * The fixtures below are source strings so they can name `d` and `DAY`
 * directly; wrapping one in a Function here gives writeState the callable it
 * ships to the page. A dynamically built function still stringifies to valid
 * source, so the round-trip holds.
 */
async function seed(page, mutate) {
  // eslint-disable-next-line no-new-func
  await writeState(page, new Function("d", `const DAY = 24 * 60 * 60 * 1000;\n${mutate}`));
  await page.reload({ waitUntil: "networkidle" });
}

/** Point the app at the mock provider. */
async function configureProvider(page) {
  await nav(page, /Settings/);
  await page.waitForSelector("#provider");
  await page.selectOption("#provider", "custom");
  await page.fill("#baseUrl", MOCK_URL);
  await page.fill("#apiKey", "sk-mock");
  await page.selectOption("#model", "__custom__");
  await page.locator('input[placeholder*="exact model ID"]').fill("mock-model");
  await page.getByRole("button", { name: "Save Settings" }).click();
  await page.waitForTimeout(300);
}

const browser = await launch();

// ===========================================================================
// CHANGE 4 — daily calendar-day streak
// ===========================================================================
{
  const page = await browser.newPage();
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await resetApp(page);

  // Three consecutive days ending today, then a gap, then two more.
  await seed(page, `
    const at = (daysAgo, n) => Array.from({length: n}, (_, i) => ({
      id: 'a' + daysAgo + '-' + i, questionId: 'q', timestamp: Date.now() - daysAgo * DAY,
      source: 'drill', answerMode: 'free-text', userAnswer: 'x', verdict: 'correct',
    }));
    d.attempts = [...at(0,1), ...at(1,1), ...at(2,1), ...at(5,1), ...at(6,1)];
  `);

  const streakText = await page.locator(".stat-tile", { hasText: "Daily Streak" }).textContent();
  check("counts consecutive days ending today", streakText.includes("3"), streakText.trim().slice(0, 60));
  check("shows today as practiced", streakText.includes("practiced today"), streakText.trim().slice(0, 70));
  check("reports the longest run, not just the current one",
    streakText.includes("best 3") || streakText.includes("3 day"), streakText.trim().slice(0, 70));

  // No attempt today: the streak must survive the morning, not read 0.
  await seed(page, `
    const at = (daysAgo) => ({
      id: 'b' + daysAgo, questionId: 'q', timestamp: Date.now() - daysAgo * DAY,
      source: 'drill', answerMode: 'free-text', userAnswer: 'x', verdict: 'correct',
    });
    d.attempts = [at(1), at(2), at(3)];
  `);
  const pending = await page.locator(".stat-tile", { hasText: "Daily Streak" }).textContent();
  check("an unfinished today keeps yesterday's streak alive",
    pending.includes("3") && pending.includes("practice today to keep it"), pending.trim().slice(0, 70));

  // A missed day must break it.
  await seed(page, `
    const at = (daysAgo) => ({
      id: 'c' + daysAgo, questionId: 'q', timestamp: Date.now() - daysAgo * DAY,
      source: 'drill', answerMode: 'free-text', userAnswer: 'x', verdict: 'correct',
    });
    d.attempts = [at(0), at(3), at(4)];
  `);
  // Read the value element, not the whole tile: textContent concatenates the
  // label, so "Daily Streak1 day" defeats any word-boundary match.
  const brokenValue = await page
    .locator(".stat-tile", { hasText: "Daily Streak" })
    .locator(".stat-value")
    .textContent();
  check("a missed day breaks the streak", brokenValue.trim().startsWith("1"), brokenValue.trim());

  // The goal is configurable, and a day below it shouldn't count.
  await nav(page, /Settings/);
  await page.fill("#dailyGoal", "3");
  await page.getByRole("button", { name: "Save Goal" }).click();
  await page.waitForTimeout(300);
  await nav(page, /Dashboard/);
  const goalValue = await page
    .locator(".stat-tile", { hasText: "Daily Streak" })
    .locator(".stat-value")
    .textContent();
  check("a day below the configured goal doesn't count",
    goalValue.trim().startsWith("0"), goalValue.trim());

  await page.close();
}

// ===========================================================================
// CHANGE 2 + 3 — generation, validation, spoiler-free staging, calibration
// ===========================================================================
{
  const page = await browser.newPage();
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await resetApp(page);
  await configureProvider(page);

  await nav(page, /Topics/);
  await page.locator(".topic-card").filter({ has: page.locator(".topic-card-title", { hasText: "Bayes theorem" }) }).click();
  await page.waitForTimeout(300);

  await page.getByRole("button", { name: "Generate quiz from note" }).click();
  await page.waitForSelector(".staged-item", { timeout: 20000 });

  check("generated questions land in staging", (await page.locator(".staged-item").count()) === 2);
  check("the validation pass ran and split clean from suspect",
    (await page.getByText("checked", { exact: true }).count()) === 1 &&
      (await page.getByText("needs a look").count()) === 1);
  check("a flagged question shows why", (await page.locator(".staged-issues").count()) === 1);

  // The whole point: answers must not be visible by default.
  const stagingText = (await page.locator(".card", { hasText: "Staged questions" }).textContent()) ?? "";
  check("answers are NOT shown by default",
    !stagingText.includes("Set up state recursion") && !stagingText.includes("Canonical answer"),
    stagingText.includes("Reveal answer") ? "reveal toggle present" : "no reveal toggle!");
  check("the technique and rationale ARE shown (they don't spoil it)",
    stagingText.includes("condition on the first step"));

  // Bank the clean one without ever seeing its answer.
  await page.getByRole("button", { name: /Bank 1 checked question unseen/ }).click();
  await page.waitForTimeout(400);
  const afterBank = await readState(page);
  // Match the generated prompt exactly: the seeded bank also contains a
  // recursive-states question mentioning HTH, and it would match first.
  const banked = afterBank.questions.find((q) => q.prompt === "Expected number of flips to see HTH?");
  check("banked unseen enters the bank", banked !== undefined);
  check("banked unseen is marked unseen", banked?.answerSeen === false, `answerSeen=${banked?.answerSeen}`);
  check("suspect questions are NOT bulk-approved", afterBank.stagedQuestions.length === 1);

  // Revealing must stick, so approving afterwards can't claim it's unseen.
  await page.getByRole("button", { name: /Reveal answer/ }).click();
  await page.waitForTimeout(300);
  check("revealing shows the answer", (await page.locator(".staged-answer").count()) === 1);
  await page.getByRole("button", { name: "Add to bank", exact: true }).click();
  await page.waitForTimeout(400);
  const afterReveal = await readState(page);
  const revealed = afterReveal.questions.find((q) => q.prompt.includes("second generated"));
  check("a revealed question is recorded as seen", revealed?.answerSeen === true, `answerSeen=${revealed?.answerSeen}`);

  // Calibration: rate the same topic "too easy" three times.
  await seed(page, `
    const qid = d.questions.find(q => q.topics.includes('bayes-theorem')).id;
    d.attempts = [0,1,2].map(i => ({
      id: 'r' + i, questionId: qid, timestamp: Date.now() - i * 1000,
      source: 'drill', answerMode: 'free-text', userAnswer: 'x', verdict: 'correct',
      difficultyRating: 'too-easy',
    }));
  `);
  await nav(page, /Topics/);
  await page.locator(".topic-card").filter({ has: page.locator(".topic-card-title", { hasText: "Bayes theorem" }) }).click();
  await page.waitForTimeout(300);
  const calibText = (await page.locator(".calibration-line").textContent()) ?? "";
  check("per-topic calibration is shown and reacts to ratings",
    calibText.includes("too easy") && calibText.includes("harder"), calibText.trim());

  // And that calibration must actually reach the generation prompt.
  await page.getByRole("button", { name: "Generate quiz from note" }).click();
  await page.waitForSelector(".staged-item", { timeout: 20000 });
  const sent = await (await fetch("http://localhost:4599/__received")).json();
  const genCall = [...sent].reverse().find((r) => r.body.messages[0].content.includes("writing practice questions"));
  check("generation prompt carries the difficulty anchors",
    genCall.body.messages[0].content.includes("two heads in a row") &&
      genCall.body.messages[0].content.includes("Arithmetic weight is not difficulty"));
  check("generation prompt carries the calibration feedback",
    genCall.body.messages[0].content.includes("CALIBRATION FEEDBACK") &&
      genCall.body.messages[0].content.includes("TOO EASY"));

  await page.close();
}

// ===========================================================================
// CHANGE 1 — diagnostic chat, taxonomy, dashboard patterns
// ===========================================================================
{
  const page = await browser.newPage();
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await resetApp(page);
  await configureProvider(page);

  // One bayes-theorem question, so the prereq closure is non-empty — and it has
  // to be the question Drill actually serves, since the closure is computed from
  // that question's topics. Emptying the bank is not enough on its own: loadData
  // backfills any seed question the stored data is missing, so the rest of the
  // bank comes back on reload. Instead, mark everything else as already seen,
  // which leaves diag-q as the only fresh question — and pickPractice always
  // serves a fresh one when any exist.
  await seed(page, `
    d.questions.forEach((q) => { q.answerSeen = true; });
    d.questions.push({
      id: 'diag-q', prompt: 'P(A|B) given...?', topics: ['bayes-theorem'],
      difficulty: 'medium', answerMode: 'free-text', canonicalAnswer: '0.5',
      explanation: 'Apply Bayes.', createdAt: 1, custom: false, origin: 'seed',
    });
    d.attempts = []; d.srs = [];
  `);

  await nav(page, /Drill/);
  await page.waitForSelector("textarea");
  check("the pinned question is the one served",
    ((await page.locator(".question-prompt").first().textContent()) ?? "").includes("P(A|B)"),
    (await page.locator(".question-prompt").first().textContent())?.slice(0, 60));
  await page.locator("textarea").first().fill("I multiplied the probabilities.");
  await page.getByRole("button", { name: /Submit/i }).first().click();
  await page.waitForTimeout(1200);

  check("a miss offers the diagnostic chat",
    (await page.getByRole("button", { name: /Discuss \/ figure out why/ }).count()) === 1);

  await page.getByRole("button", { name: /Discuss \/ figure out why/ }).click();
  await page.getByRole("button", { name: "Start the diagnosis" }).click();
  await page.waitForSelector(".chat-assistant", { timeout: 20000 });
  check("the coach opens with a specific question",
    (await page.locator(".chat-assistant").first().textContent())?.includes("independence"));
  check("the seeding instruction is not shown as if the user typed it",
    (await page.locator(".chat-user").count()) === 0);

  // Multi-turn: reply in your own words and get a follow-up.
  await page.locator(".diagnosis-composer textarea").fill("I assumed they were independent.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForTimeout(1500);
  check("it's a real multi-turn chat",
    (await page.locator(".chat-user").count()) === 1 && (await page.locator(".chat-assistant").count()) === 2);

  await page.getByRole("button", { name: "Save the diagnosis" }).click();
  await page.waitForSelector(".diagnosis-result", { timeout: 20000 });

  const stored = (await readState(page)).attempts[0];
  check("the taxonomy tag is stored", stored.diagnosis?.tag === "missing prerequisite knowledge",
    `tag=${stored.diagnosis?.tag}`);
  check("the one-line summary is stored", (stored.diagnosis?.summary ?? "").includes("independent"));
  check("the transcript is kept for revisiting", (stored.diagnosis?.transcript ?? []).length === 4,
    `${stored.diagnosis?.transcript?.length} turns`);
  check("recommended prereqs are constrained to the real closure",
    JSON.stringify(stored.diagnosis?.recommendedTopics) === '["conditional-probability"]',
    JSON.stringify(stored.diagnosis?.recommendedTopics));
  check("the invented topic id was rejected",
    !(stored.diagnosis?.recommendedTopics ?? []).includes("not-a-real-topic"));
  check("the recommendation links straight to drilling that topic",
    (await page.getByRole("button", { name: /Drill Conditional probability/ }).count()) === 1);

  // Editing the summary in your own words.
  await page.getByRole("button", { name: "edit", exact: true }).click();
  await page.locator(".diagnosis-result textarea").fill("My own wording.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(400);
  const edited = (await readState(page)).attempts[0];
  check("the summary is editable and flagged as edited",
    edited.diagnosis?.summary === "My own wording." && edited.diagnosis?.edited === true);

  // --- Dashboard: the pivot and the recommendations -------------------------
  await seed(page, `
    const mk = (i, tag, topics) => ({
      id: 'm' + i, questionId: 'diag-q', timestamp: Date.now() - i * 1000,
      source: 'drill', answerMode: 'free-text', userAnswer: 'x', verdict: 'incorrect',
      diagnosis: { tag, summary: 's', recommendedTopics: topics, transcript: [], concludedAt: Date.now(), edited: false },
    });
    d.attempts = [
      mk(1, 'missing prerequisite knowledge', ['conditional-probability']),
      mk(2, 'missing prerequisite knowledge', ['conditional-probability']),
      mk(3, 'missing prerequisite knowledge', ['conditional-probability']),
      mk(4, 'arithmetic slip', []),
      { id: 'untagged', questionId: 'diag-q', timestamp: Date.now(), source: 'drill',
        answerMode: 'free-text', userAnswer: 'x', verdict: 'incorrect' },
    ];
  `);
  await nav(page, /Dashboard/);
  await page.waitForTimeout(400);

  const pivot = (await page.locator(".card", { hasText: "Why I'm Getting Things Wrong" }).textContent()) ?? "";
  check("the dashboard pivots miss reasons with counts and percentages",
    pivot.includes("missing prerequisite knowledge") && pivot.includes("3 (75%)"), pivot.slice(0, 120));
  check("undiagnosed misses are surfaced, not hidden", pivot.includes("1 still undiagnosed"));

  const focus = (await page.locator(".card", { hasText: "Recommended Focus" }).textContent()) ?? "";
  check("a repeated prerequisite fires a recommendation",
    focus.includes("Conditional probability") && focus.includes("point at"), focus.slice(0, 140));
  check("the recommendation is actionable",
    (await page.locator(".rec-prereq-cluster").count()) === 1 &&
      (await page.getByRole("button", { name: /Learn Conditional probability/ }).count()) === 1);

  await page.close();
}

await browser.close();
finish();

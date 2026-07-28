import { APP_URL, launch, nav, reporter } from "./harness.mjs";

const { check, finish } = reporter();

const browser = await launch();

// ===========================================================================
// 1. A v1 payload (display-string topics, flat apiKey) upgrades in place.
// ===========================================================================
{
  const page = await browser.newPage();
  await page.goto(APP_URL);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      "quantprep_data_v1",
      JSON.stringify({
        version: 1,
        questions: [
          { id: "seed-1", prompt: "Coin until first heads", topics: ["Geometric distribution"],
            difficulty: "easy", answerMode: "free-text", canonicalAnswer: "2", explanation: "E=1/p",
            createdAt: 1, custom: false },
          { id: "mine-1", prompt: "My own question", topics: ["Bayes theorem", "Combinatorics"],
            difficulty: "hard", answerMode: "free-text", canonicalAnswer: "x", explanation: "y",
            createdAt: 2, custom: true },
        ],
        attempts: [
          { id: "a1", questionId: "seed-1", timestamp: 1000, source: "drill", answerMode: "free-text",
            userAnswer: "2", verdict: "correct" },
          { id: "a2", questionId: "mine-1", timestamp: 2000, source: "drill", answerMode: "free-text",
            userAnswer: "?", verdict: "incorrect" },
        ],
        srs: [{ questionId: "mine-1", stage: 0, nextReviewAt: 9e12, lastResult: "incorrect", updatedAt: 2000 }],
        settings: { apiKey: "sk-ant-legacy", model: "claude-sonnet-4-6", spendNote: "cap at $20" },
      }),
    );
  });
  await page.reload({ waitUntil: "networkidle" });
  const d = await page.evaluate(() => JSON.parse(localStorage.getItem("quantprep_data_v2")));

  check("v1: attempts preserved", d.attempts.length === 2, `${d.attempts.length} attempts`);
  check("v1: legacy key moved into apiKeys.anthropic", d.settings.apiKeys.anthropic === "sk-ant-legacy",
    JSON.stringify(d.settings.apiKeys));
  check("v1: chosen model preserved (not reset to the new default)",
    d.settings.model === "claude-sonnet-4-6", `model=${d.settings.model}`);
  // Critically NOT the current default (OpenRouter) — a legacy install has an
  // Anthropic key and an Anthropic model ID, so moving it would break grading.
  check("v1: legacy install stays on Anthropic, not the new default",
    d.settings.provider === "anthropic", `provider=${d.settings.provider}`);
  check("v1: spend note preserved", d.settings.spendNote === "cap at $20");
  check("v1: customTopics backfilled", Array.isArray(d.customTopics) && d.customTopics.length === 0);
  const mine = d.questions.find((q) => q.id === "mine-1");
  check("v1: user question kept, topics remapped to ids",
    JSON.stringify(mine?.topics) === '["bayes-theorem","combinatorics"]', JSON.stringify(mine?.topics));
  check("v1: superseded seed question dropped", !d.questions.some((q) => q.id === "seed-1"));
  check("v1: srs gains trickleCredit", d.srs[0]?.trickleCredit === 0);
  check("v1: v1 key left as a rollback backup",
    await page.evaluate(() => localStorage.getItem("quantprep_data_v1") !== null));

  // The dropped question's attempt must still feed its topic's mastery.
  await nav(page, /Topics/);
  await page.waitForSelector(".topic-card");
  // Filter on the title element specifically — prereq chips on other cards
  // also carry the topic's name.
  const geoCard = page
    .locator(".topic-card")
    .filter({ has: page.locator(".topic-card-title", { hasText: "Geometric distribution" }) });
  check("v1: dropped question's attempt still counts toward mastery",
    (await geoCard.textContent())?.includes("1 attempt"), (await geoCard.textContent())?.slice(0, 80));
  await page.close();
}

// ===========================================================================
// 2. An older v2 payload (pre-multi-provider, pre-custom-topics) backfills.
// ===========================================================================
{
  const page = await browser.newPage();
  await page.goto(APP_URL);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      "quantprep_data_v2",
      JSON.stringify({
        version: 2,
        questions: [
          { id: "q1", prompt: "P", topics: ["bayes-theorem"], difficulty: "easy", answerMode: "free-text",
            canonicalAnswer: "a", explanation: "b", createdAt: 1, custom: false, origin: "seed" },
        ],
        attempts: [
          { id: "a1", questionId: "q1", timestamp: 1000, source: "drill", answerMode: "free-text",
            userAnswer: "a", verdict: "correct" },
        ],
        srs: [],
        settings: { apiKey: "sk-ant-old-v2", model: "claude-opus-5", spendNote: "" },
        studyNotes: [
          { topicId: "bayes-theorem", title: "Bayes theorem", prereqs: [], source: "authored",
            body: "my edited note", lastEdited: 5000, modified: true },
        ],
        stagedQuestions: [],
      }),
    );
  });
  await page.reload({ waitUntil: "networkidle" });
  const d = await page.evaluate(() => JSON.parse(localStorage.getItem("quantprep_data_v2")));

  check("old-v2: attempts preserved", d.attempts.length === 1);
  check("old-v2: legacy key migrated", d.settings.apiKeys.anthropic === "sk-ant-old-v2");
  check("old-v2: model preserved", d.settings.model === "claude-opus-5");
  check("old-v2: stays on Anthropic (key + model would not work elsewhere)",
    d.settings.provider === "anthropic", `provider=${d.settings.provider}`);
  check("old-v2: customTopics backfilled", Array.isArray(d.customTopics));
  check("old-v2: edited note NOT clobbered by re-seeding",
    d.studyNotes.find((n) => n.topicId === "bayes-theorem")?.body === "my edited note");
  await page.close();
}

// ===========================================================================
// 3. Export -> Erase -> Import round-trips custom topics.
// ===========================================================================
{
  const page = await browser.newPage();
  await page.goto(APP_URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await nav(page, /Topics/);
  await page.getByRole("button", { name: "+ New topic" }).click();
  await page.waitForSelector("#topicTitle");
  await page.fill("#topicTitle", "Martingale stopping");
  await page.fill("#topicBody", "## Core idea\nOptional stopping theorem.");
  await page.getByRole("button", { name: "Create topic" }).click();
  await page.waitForTimeout(300);

  const exported = await page.evaluate(() => localStorage.getItem("quantprep_data_v2"));
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  // Feed the export back through the real import path.
  await nav(page, /Settings/);
  // The real input is display:none behind an "Import from JSON" button.
  await page.waitForSelector('input[type="file"]', { state: "attached" });
  await page.setInputFiles('input[type="file"]', {
    name: "quantprep-backup.json", mimeType: "application/json", buffer: Buffer.from(exported),
  });
  await page.waitForTimeout(500);

  await nav(page, /Topics/);
  await page.waitForSelector(".topic-card");
  check("import: custom topic round-trips through export/import",
    (await page.locator(".topic-card-title", { hasText: "Martingale stopping" }).count()) === 1);
  check("import: seeded topics intact", (await page.locator(".topic-card").count()) === 20);
  await page.close();
}

// ===========================================================================
// 4. Seed content added after a user's data was written reaches them on load.
//
// Without the backfill in normalizeCurrent(), stored data is returned as-is and
// new seed questions only ever appear on fresh installs — pulling an update
// would add nothing. This simulates a user whose bank predates the derivatives
// set: strip those questions out, reload, and they should come back without
// disturbing anything else.
// ===========================================================================
{
  const page = await browser.newPage();
  await page.goto(APP_URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const before = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("quantprep_data_v2"));
    // Count by id prefix, not by topic: a couple of legacy starter questions
    // also carry the derivatives tag but aren't part of the authored bank.
    const derivs = d.questions.filter((q) => q.id.startsWith("sq-derivatives-greeks-"));
    // Pretend this user's data was written before the derivatives set landed,
    // and give them some history + an edit that must survive the backfill.
    d.questions = d.questions.filter((q) => !q.id.startsWith("sq-derivatives-greeks-"));
    d.questions[0].prompt = "EDITED BY THE USER";
    d.attempts = [{
      id: "a-keep", questionId: d.questions[0].id, timestamp: 1000, source: "drill",
      answerMode: "free-text", userAnswer: "x", verdict: "correct",
    }];
    const note = d.studyNotes.find((n) => n.topicId === "derivatives-greeks");
    note.body = "stale seeded body";
    const bayes = d.studyNotes.find((n) => n.topicId === "bayes-theorem");
    bayes.body = "MY OWN WORDS";
    bayes.modified = true;
    localStorage.setItem("quantprep_data_v2", JSON.stringify(d));
    return { seeded: derivs.length, count: d.questions.length };
  });
  check("fixture: seed bank ships derivatives questions", before.seeded > 20, `${before.seeded}`);

  await page.reload({ waitUntil: "networkidle" });
  const after = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("quantprep_data_v2"));
    return {
      derivs: d.questions.filter((q) => q.id.startsWith("sq-derivatives-greeks-")).length,
      total: d.questions.length,
      edited: d.questions.some((q) => q.prompt === "EDITED BY THE USER"),
      attempts: d.attempts.length,
      dupes: d.questions.length - new Set(d.questions.map((q) => q.id)).size,
      seededNote: d.studyNotes.find((n) => n.topicId === "derivatives-greeks")?.body,
      editedNote: d.studyNotes.find((n) => n.topicId === "bayes-theorem")?.body,
    };
  });

  check("backfill: missing seed questions are restored on load",
    after.derivs === before.seeded, `${after.derivs} of ${before.seeded}`);
  check("backfill: the user's own edit is not overwritten", after.edited);
  check("backfill: attempt history untouched", after.attempts === 1);
  check("backfill: no duplicate ids introduced", after.dupes === 0, `dupes=${after.dupes}`);
  check("backfill: an untouched seeded note is refreshed from the seed file",
    after.seededNote !== "stale seeded body" && (after.seededNote?.length ?? 0) > 1000,
    `${after.seededNote?.slice(0, 40)}`);
  check("backfill: an edited note is NOT refreshed", after.editedNote === "MY OWN WORDS");

  // Idempotence: a second load must not append the same questions again.
  await page.reload({ waitUntil: "networkidle" });
  const twice = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("quantprep_data_v2"));
    return { total: d.questions.length, dupes: d.questions.length - new Set(d.questions.map((q) => q.id)).size };
  });
  check("backfill: idempotent across reloads",
    twice.total === after.total && twice.dupes === 0, `${twice.total} vs ${after.total}`);
  await page.close();
}

await browser.close();
finish();

import { APP_URL, SEEDED_TOPICS, launch, nav, reporter } from "./harness.mjs";

const { check, finish } = reporter();

const browser = await launch();
const page = await browser.newPage();
// Settings fetches OpenRouter's public model catalogue. That request is meant
// to fail in a sandboxed or offline environment — the "model picker still
// usable" check below asserts the fallback. So network-layer failures are
// tolerated here; every other error still fails the suite.
const EXPECTED_OFFLINE = /net::ERR_|Failed to fetch|NetworkError/;
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error" && !EXPECTED_OFFLINE.test(m.text())) errors.push(m.text());
});

await page.goto(APP_URL, { waitUntil: "networkidle" });
check("app boots", (await page.locator("h1").first().textContent()) !== null);

// --- Fresh install writes the expected settings shape -----------------------
const settings = await page.evaluate(() => JSON.parse(localStorage.getItem("quantprep_data_v2")).settings);
check("fresh install defaults to OpenRouter", settings.provider === "openrouter", `provider=${settings.provider}`);
check("fresh settings have apiKeys map", typeof settings.apiKeys === "object" && settings.apiKeys !== null);
check("fresh settings default model", settings.model === "anthropic/claude-sonnet-5", `model=${settings.model}`);

// --- Settings page: provider switching -------------------------------------
await nav(page, /Settings/);
await page.waitForSelector("#provider");
const providerCount = await page.locator("#provider option").count();
check("provider dropdown populated", providerCount === 7, `${providerCount} providers`);

// This sandbox can't reach openrouter.ai, so the live model fetch fails here —
// which is exactly the fallback path worth asserting: the built-in suggestions
// must remain usable rather than leaving an empty picker.
await page.waitForFunction(
  () => !document.body.textContent.includes("Loading the live model list"),
  null,
  { timeout: 15000 },
);
const orModelValue = await page.locator("#model").inputValue();
check("model picker still usable when the live list can't load",
  orModelValue.length > 0, `model=${orModelValue}`);

await page.selectOption("#provider", "anthropic");
check("base URL hidden for Anthropic", (await page.locator("#baseUrl").count()) === 0);
await page.selectOption("#provider", "deepseek");
check("base URL shown for DeepSeek", (await page.locator("#baseUrl").inputValue()) === "https://api.deepseek.com/v1");
const dsModel = await page.locator("#model").inputValue();
check("model switches with provider", dsModel === "deepseek-chat", `model=${dsModel}`);

// Per-provider keys must not bleed across providers.
await page.fill("#apiKey", "sk-deepseek-test");
await page.selectOption("#provider", "anthropic");
check("key is per-provider", (await page.locator("#apiKey").inputValue()) === "");
await page.fill("#apiKey", "sk-ant-test");
await page.selectOption("#provider", "deepseek");
check("deepseek key retained on switch back", (await page.locator("#apiKey").inputValue()) === "sk-deepseek-test");

await page.getByRole("button", { name: "Save Settings" }).click();
await page.waitForTimeout(300);
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("quantprep_data_v2")).settings);
check("both keys persisted", saved.apiKeys.anthropic === "sk-ant-test" && saved.apiKeys.deepseek === "sk-deepseek-test",
  JSON.stringify(saved.apiKeys));
check("provider persisted", saved.provider === "deepseek");

// --- Custom topic creation --------------------------------------------------
await nav(page, /Topics/);
await page.waitForSelector(".topic-card");
// Derived, not hardcoded: the seeded taxonomy grows as topics are added, and
// the assertions below are about the DELTA from creating one custom topic.
const seededCount = await page.locator(".topic-card").count();
check("seeded topics render", seededCount === SEEDED_TOPICS, `${seededCount} topics`);

await page.getByRole("button", { name: "+ New topic" }).click();
await page.waitForSelector("#topicTitle");
await page.fill("#topicTitle", "Reflection principle");
// Pick two prerequisites.
await page.locator(".prereq-option", { hasText: "Combinatorics" }).first().click();
await page.locator(".prereq-option", { hasText: "Recursive states" }).first().click();
await page.fill("#topicBody", "## Core idea\nReflect paths that cross a level. $P = 2P(S_n > k)$\n");
await page.getByRole("button", { name: "Create topic" }).click();
await page.waitForTimeout(400);

check("lands on the new topic", (await page.locator("h2").first().textContent()) === "Reflection principle");
check("marked as user topic", await page.getByText("Your topic").isVisible());
check("KaTeX renders in the note", (await page.locator(".katex").count()) > 0);

const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("quantprep_data_v2")));
const custom = stored.customTopics[0];
check("customTopics persisted", custom?.id === "reflection-principle", JSON.stringify(stored.customTopics));
const newNote = stored.studyNotes.find((n) => n.topicId === "reflection-principle");
check("note created with prereqs", newNote?.prereqs.length === 2, JSON.stringify(newNote?.prereqs));
check("note source is user", newNote?.source === "user");

// --- The new topic flows through the rest of the app ------------------------
await page.getByRole("button", { name: "← All topics" }).click();
await page.waitForSelector(".topic-card");
const afterCount = await page.locator(".topic-card").count();
check("new topic appears in the tree", afterCount === seededCount + 1, `${afterCount} topics`);
// Prereqs are depth-2 and depth-3, so it should be placed in the deepest tier.
const tierHeadings = await page.locator(".tier-heading").allTextContents();
const lastTier = page.locator(".topic-grid").last();
check("placed in a deeper tier by its prereqs",
  (await lastTier.locator(".topic-card-title", { hasText: "Reflection principle" }).count()) === 1,
  `tiers: ${tierHeadings.join(" | ")}`);

await nav(page, /Add Question/);
await page.waitForTimeout(200);
check("custom topic offered in Add Question",
  (await page.getByText("Reflection principle", { exact: true }).count()) > 0);

await nav(page, /Drill/);
await page.waitForTimeout(200);
check("custom topic offered in Drill filters",
  (await page.getByText("Reflection principle", { exact: true }).count()) > 0);

// --- Persistence across a reload -------------------------------------------
await page.reload({ waitUntil: "networkidle" });
await nav(page, /Topics/);
await page.waitForSelector(".topic-card");
check("survives a reload", (await page.locator(".topic-card").count()) === seededCount + 1);
check("label survives (not a raw slug)",
  (await page.locator(".topic-card-title", { hasText: "Reflection principle" }).count()) === 1);

// --- Deletion ---------------------------------------------------------------
page.on("dialog", (d) => d.accept());
await page.locator(".topic-card", { hasText: "Reflection principle" }).click();
await page.waitForTimeout(200);
await page.getByRole("button", { name: "Delete this topic" }).click();
await page.waitForTimeout(400);
const afterDelete = await page.evaluate(() => JSON.parse(localStorage.getItem("quantprep_data_v2")));
check("topic deleted", afterDelete.customTopics.length === 0);
check("its note deleted", !afterDelete.studyNotes.some((n) => n.topicId === "reflection-principle"));
check("seeded topics untouched", afterDelete.studyNotes.length === SEEDED_TOPICS,
  `${afterDelete.studyNotes.length} notes`);

check("no runtime errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
finish();

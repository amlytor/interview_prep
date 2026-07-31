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
// Its prereqs (Combinatorics, Recursive states) sit at depth 1 and 2, so the
// new topic must land strictly below both. Asserted relatively rather than as
// "the last tier": the seeded graph has deeper branches of its own.
const tierHeadings = await page.locator(".tier-heading").allTextContents();
const tierIndexOf = async (title) => {
  const grids = await page.locator(".topic-grid").all();
  for (let i = 0; i < grids.length; i++) {
    if ((await grids[i].locator(".topic-card-title", { hasText: title }).count()) > 0) return i;
  }
  return -1;
};
const newTier = await tierIndexOf("Reflection principle");
const prereqTier = Math.max(await tierIndexOf("Combinatorics"), await tierIndexOf("Recursive states"));
check("placed in a deeper tier than its prereqs",
  newTier > prereqTier && prereqTier >= 0,
  `new=${newTier} deepest prereq=${prereqTier} tiers: ${tierHeadings.join(" | ")}`);
check("every tier has a name, not a bare index",
  tierHeadings.every((t) => !/^Tier \d+$/.test(t.trim())), tierHeadings.join(" | "));

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

// --- The prerequisite gate is advisory, never blocking ---------------------
// The graph is ten tiers deep, so gating Learn behind proficiency would hide
// most of the app from someone who arrives already competent in the upper
// tiers. The badge still shows the recommended order; the button still works.
await nav(page, /Topics/);
await page.waitForSelector(".topic-card");
await page
  .locator(".topic-card")
  .filter({ has: page.locator(".topic-card-title", { hasText: "Black-Scholes" }) })
  .click();
await page.waitForTimeout(300);
const learnBtn = page.getByRole("button", { name: /^Learn \(/ });
check("a topic with unmet prerequisites still shows the suggestion",
  (await page.getByText(/Suggested first:/).count()) > 0);
check("but Learn mode is NOT blocked by it", !(await learnBtn.isDisabled()));
check("the tooltip reads as advice, not a refusal",
  ((await learnBtn.getAttribute("title")) ?? "").startsWith("Recommended:"),
  await learnBtn.getAttribute("title"));

// --- Notes teach, and their math renders -----------------------------------
// Every seeded note carries a worked example; a note that only lists formulas
// is a reference sheet, not a lesson. KaTeX renders errors inline as
// .katex-error rather than throwing, so a broken macro is silent unless
// something looks for it — which is exactly how the escaped-dollar bug in the
// inline-math tokenizer survived.
check("the note shows a worked example",
  (await page.getByRole("heading", { name: /Worked example/i }).count()) > 0);
check("its math renders", (await page.locator(".katex").count()) > 0);
check("with no KaTeX errors", (await page.locator(".katex-error").count()) === 0);

// --- Currency dollars are text, not math delimiters ------------------------
// Notes are full of "$1m"-style amounts. Two on one line used to bracket the
// prose between them and render it as maths; the fix is that Markdown.tsx
// matches "\$" as its own token before it can act as a delimiter. This asserts
// the rendered OUTPUT, so it fails if either the escape or the tokenizer
// regresses.
await page.getByRole("button", { name: /All topics/ }).click();
await page.waitForSelector(".topic-card");
await page
  .locator(".topic-card")
  .filter({ has: page.locator(".topic-card-title", { hasText: "Optimal stopping" }) })
  .click();
await page.waitForSelector(".katex, .md-math-block, h3");
const noteText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
check("an escaped dollar renders as a dollar",
  noteText.includes("for $1m is not the same as a million rolls for $1 each"),
  noteText.slice(noteText.indexOf("one roll of a die"), noteText.indexOf("one roll of a die") + 110));
check("and its math still renders", (await page.locator(".katex-error").count()) === 0);

check("no runtime errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
finish();

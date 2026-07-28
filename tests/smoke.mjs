import { APP_URL, launch, reporter } from "./harness.mjs";

const { check, finish } = reporter();

const browser = await launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(APP_URL, { waitUntil: "networkidle" });
check("app boots", (await page.locator("h1").first().textContent()) !== null);

// --- Fresh install writes the expected settings shape -----------------------
const settings = await page.evaluate(() => JSON.parse(localStorage.getItem("quantprep_data_v2")).settings);
check("fresh settings have provider", settings.provider === "anthropic", `provider=${settings.provider}`);
check("fresh settings have apiKeys map", typeof settings.apiKeys === "object" && settings.apiKeys !== null);
check("fresh settings default model", settings.model === "claude-sonnet-5", `model=${settings.model}`);

// --- Settings page: provider switching -------------------------------------
await page.getByRole("button", { name: /Settings/ }).click();
await page.waitForSelector("#provider");
const providerCount = await page.locator("#provider option").count();
check("provider dropdown populated", providerCount === 7, `${providerCount} providers`);

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
await page.getByRole("button", { name: /Topics/ }).click();
await page.waitForSelector(".topic-card");
const seededCount = await page.locator(".topic-card").count();
check("seeded topics render", seededCount === 19, `${seededCount} topics`);

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
check("new topic appears in the tree", afterCount === 20, `${afterCount} topics`);
// Prereqs are depth-2 and depth-3, so it should be placed in the deepest tier.
const tierHeadings = await page.locator(".tier-heading").allTextContents();
const lastTier = page.locator(".topic-grid").last();
check("placed in a deeper tier by its prereqs",
  (await lastTier.locator(".topic-card-title", { hasText: "Reflection principle" }).count()) === 1,
  `tiers: ${tierHeadings.join(" | ")}`);

await page.getByRole("button", { name: /Add Question/ }).click();
await page.waitForTimeout(200);
check("custom topic offered in Add Question",
  (await page.getByText("Reflection principle", { exact: true }).count()) > 0);

await page.getByRole("button", { name: /Drill/ }).click();
await page.waitForTimeout(200);
check("custom topic offered in Drill filters",
  (await page.getByText("Reflection principle", { exact: true }).count()) > 0);

// --- Persistence across a reload -------------------------------------------
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("button", { name: /Topics/ }).click();
await page.waitForSelector(".topic-card");
check("survives a reload", (await page.locator(".topic-card").count()) === 20);
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
check("seeded topics untouched", afterDelete.studyNotes.length === 19, `${afterDelete.studyNotes.length} notes`);

check("no runtime errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
finish();

// Drives the OpenAI-compatible provider path end to end against the local mock
// in mock-provider.mjs: Test Connection, then a real free-text grading round-trip.
import { APP_URL, MOCK_URL, launch, nav, readState, reporter, resetApp, writeState } from "./harness.mjs";

const { check, finish } = reporter();

const browser = await launch();
const page = await browser.newPage();
await page.goto(APP_URL);
await resetApp(page);

// --- Point the app at the mock via the "custom endpoint" provider -----------
await nav(page, /Settings/);
await page.waitForSelector("#provider");
await page.selectOption("#provider", "custom");
await page.fill("#baseUrl", MOCK_URL);
await page.fill("#apiKey", "sk-mock-123");
await page.selectOption("#model", "__custom__");
await page.locator('input[placeholder*="exact model ID"]').fill("mock-model-v1");
await page.getByRole("button", { name: "Test Connection" }).click();

await page.waitForSelector(".banner-success, .banner-error", { timeout: 10000 });
const testBanner = (await page.locator(".banner-success, .banner-error").first().textContent()) ?? "";
check("Test Connection succeeds against an OpenAI-compatible endpoint",
  testBanner.includes("responded"), testBanner.trim().slice(0, 90));

await page.getByRole("button", { name: "Save Settings" }).click();
await page.waitForTimeout(300);

// --- Grade a real free-text answer through that provider --------------------
// Drill's question selection isn't deterministic, so pin it to a single
// free-text question rather than hunting for one and hoping. Note this marks
// the rest of the bank as seen rather than deleting it: loadData backfills any
// seed question that's missing, so a deleted bank simply comes back on reload —
// and a multiple-choice question has no textarea to type into.
async function pinFreeTextQuestion() {
  await writeState(page, (d) => {
    d.questions = d.questions.filter((q) => q.id !== "test-free-text");
    d.questions.forEach((q) => { q.answerSeen = true; });
    d.questions.push({
      id: "test-free-text", prompt: "Expected flips of a fair coin until the first head?",
      topics: ["geometric-distribution"], difficulty: "easy", answerMode: "free-text",
      canonicalAnswer: "2", explanation: "E = 1/p = 2.", createdAt: 1, custom: false,
      origin: "seed", answerSeen: false,
    });
    // No attempts anywhere, so the pinned question is the only fresh one and
    // pickPractice is guaranteed to serve it.
    d.attempts = [];
    d.srs = [];
  });
  await page.reload({ waitUntil: "networkidle" });
}

await pinFreeTextQuestion();

await nav(page, /Drill/);
await page.waitForTimeout(400);
check("the pinned free-text question is the one served",
  ((await page.locator(".question-prompt").first().textContent()) ?? "").includes("until the first head"),
  (await page.locator(".question-prompt").first().textContent())?.slice(0, 60));
check("no 'set up a provider' warning once configured",
  (await page.getByText("No AI provider set up").count()) === 0);

const textarea = page.locator("textarea").first();
await textarea.waitFor({ timeout: 5000 });
await textarea.fill("I think the expected value is 2, via 1/p.");
await page.getByRole("button", { name: /Submit/i }).first().click();
check("submitted a free-text answer for grading", true);

await page.waitForTimeout(1500);
const bodyText = (await page.locator("body").textContent()) ?? "";
check("verdict from the mock provider is rendered",
  bodyText.includes("You conditioned on the wrong event."),
  bodyText.includes("misread problem") ? "feedback + whyMissed shown" : "not found");

const stored = await readState(page);
const attempt = stored.attempts[stored.attempts.length - 1];
check("attempt recorded with the parsed verdict", attempt?.verdict === "incorrect", `verdict=${attempt?.verdict}`);
check("whyMissed tag parsed and stored", attempt?.whyMissed === "misread problem", `whyMissed=${attempt?.whyMissed}`);

// --- Verify the wire format the app actually sent ---------------------------
const sent = await (await fetch("http://localhost:4599/__received")).json();
check("hit /chat/completions on the configured base URL",
  sent.every((r) => r.url === "/v1/chat/completions"), sent.map((r) => r.url).join(", "));
check("sent the API key as a bearer token",
  sent.every((r) => r.auth === "Bearer sk-mock-123"), sent[0]?.auth);
check("sent the custom model ID", sent.every((r) => r.body.model === "mock-model-v1"), sent[0]?.body.model);
check("sent system + user messages in OpenAI shape",
  sent.every((r) => r.body.messages.length === 2 && r.body.messages[0].role === "system" && r.body.messages[1].role === "user"));
check("sent max_tokens", typeof sent[0]?.body.max_tokens === "number", String(sent[0]?.body.max_tokens));

// --- Reasoning models: empty content must be explained, not just reported ---
// A reasoning model spends its output budget thinking and returns empty visible
// content with finish_reason "length". The old code called that "an empty
// response", which told the user nothing about what to do.
await nav(page, /Settings/);
await page.waitForSelector("#baseUrl");
await page.locator('input[placeholder*="exact model ID"]').fill("reasoning-model");
await page.getByRole("button", { name: "Test Connection" }).click();
await page.waitForSelector(".banner-success, .banner-error", { timeout: 15000 });
const reasoningBanner = (await page.locator(".banner-success, .banner-error").first().textContent()) ?? "";
// The real fix is the token budget: Test Connection now sends enough headroom
// that a reasoning model gets past its thinking and answers normally.
check("a reasoning model no longer fails the connection test",
  reasoningBanner.includes("responded"), reasoningBanner.trim().slice(0, 100));

const budget = await (await fetch("http://localhost:4599/__received")).json();
check("Test Connection sends enough tokens for a reasoning model",
  budget[budget.length - 1].body.max_tokens >= 200,
  `max_tokens=${budget[budget.length - 1].body.max_tokens}`);

// If even the raised budget isn't enough, the message must name the cause and
// the fix rather than just saying "empty response".
await page.locator('input[placeholder*="exact model ID"]').fill("always-truncates");
await page.getByRole("button", { name: "Test Connection" }).click();
await page.waitForSelector(".banner-error", { timeout: 15000 });
const truncErr = (await page.locator(".banner-error").first().textContent()) ?? "";
check("exhausted-budget error names the cause and the fix",
  truncErr.includes("output-token limit") && truncErr.includes("reasoning models"),
  truncErr.trim().slice(0, 120));

// --- A provider error inside a 200 body is surfaced, not swallowed ----------
await page.locator('input[placeholder*="exact model ID"]').fill("error-in-200");
await page.getByRole("button", { name: "Test Connection" }).click();
await page.waitForSelector(".banner-error", { timeout: 15000 });
const inlineErr = (await page.locator(".banner-error").first().textContent()) ?? "";
check("an error inside a 200 response is reported verbatim",
  inlineErr.includes("No endpoints found for this model"), inlineErr.trim().slice(0, 100));

// --- Per-task model overrides ----------------------------------------------
// The point of the feature: a cheap model for the drilling loop and a strong
// one for generation, without switching Settings between the two.
await nav(page, /Settings/);
await page.waitForSelector("#baseUrl");
await page.fill("#baseUrl", MOCK_URL);
await page.locator('input[placeholder*="exact model ID"]').fill("default-model");
await page.locator(".task-models > summary").click();
await page.fill("#task-grading", "cheap-grader");
await page.fill("#task-generation", "strong-generator");
await page.getByRole("button", { name: "Save Settings" }).click();
await page.waitForTimeout(300);

const savedOverrides = (await readState(page)).settings.taskModels;
check("overrides are stored per provider",
  savedOverrides.custom?.grading === "cheap-grader" && savedOverrides.custom?.generation === "strong-generator",
  JSON.stringify(savedOverrides));

// Grade an answer, then generate a quiz, and compare what each actually sent.
// Re-pin first: the earlier attempt made the question stale, which would let
// Drill serve something else — possibly a multiple-choice question with no
// textarea, and with no grading call to inspect.
await pinFreeTextQuestion();
await nav(page, /Drill/);
await page.locator("textarea").first().fill("Another attempt.");
await page.getByRole("button", { name: /Submit/i }).first().click();
await page.waitForTimeout(1500);

await nav(page, /Topics/);
await page
  .locator(".topic-card")
  .filter({ has: page.locator(".topic-card-title", { hasText: "Bayes theorem" }) })
  .click();
await page.getByRole("button", { name: "Generate quiz from note" }).click();
await page.waitForSelector(".staged-item", { timeout: 20000 });

const calls = await (await fetch("http://localhost:4599/__received")).json();
const forSystem = (needle) =>
  [...calls].reverse().find((r) => r.body.messages[0].content.includes(needle))?.body.model;

check("grading uses its override", forSystem("grading a candidate's free-text answer") === "cheap-grader",
  forSystem("grading a candidate's free-text answer"));
check("generation uses a different override", forSystem("writing practice questions") === "strong-generator",
  forSystem("writing practice questions"));
check("validation falls back to the default when not overridden",
  forSystem("checking draft interview questions") === "default-model",
  forSystem("checking draft interview questions"));

// --- A bad base URL must fail with an actionable message, not a crash -------
await nav(page, /Settings/);
await page.waitForSelector("#baseUrl");
await page.fill("#baseUrl", "http://localhost:4598/v1"); // nothing listening
await page.getByRole("button", { name: "Test Connection" }).click();
await page.waitForSelector(".banner-error", { timeout: 15000 });
const errText = (await page.locator(".banner-error").first().textContent()) ?? "";
check("unreachable endpoint explains CORS/network rather than crashing",
  errText.includes("CORS") && errText.includes("OpenRouter"), errText.trim().slice(0, 110));

await browser.close();
finish();

// Drives the OpenAI-compatible provider path end to end against the local mock
// in mock-provider.mjs: Test Connection, then a real free-text grading round-trip.
import { APP_URL, MOCK_URL, launch, nav, reporter } from "./harness.mjs";

const { check, finish } = reporter();

const browser = await launch();
const page = await browser.newPage();
await page.goto(APP_URL);
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });

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
// Drill's question selection isn't deterministic, so pin the bank to a single
// free-text question rather than hunting for one and hoping.
await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem("quantprep_data_v2"));
  d.questions = [{
    id: "test-free-text", prompt: "Expected flips of a fair coin until the first head?",
    topics: ["geometric-distribution"], difficulty: "easy", answerMode: "free-text",
    canonicalAnswer: "2", explanation: "E = 1/p = 2.", createdAt: 1, custom: false, origin: "seed",
  }];
  d.attempts = [];
  d.srs = [];
  localStorage.setItem("quantprep_data_v2", JSON.stringify(d));
});
await page.reload({ waitUntil: "networkidle" });

await nav(page, /Drill/);
await page.waitForTimeout(400);
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
  bodyText.includes("Right setup, arithmetic slipped."),
  bodyText.includes("arithmetic slip") ? "feedback + whyMissed shown" : "not found");

const attempt = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem("quantprep_data_v2"));
  return d.attempts[d.attempts.length - 1];
});
check("attempt recorded with the parsed verdict", attempt?.verdict === "partial", `verdict=${attempt?.verdict}`);
check("whyMissed tag parsed and stored", attempt?.whyMissed === "arithmetic slip", `whyMissed=${attempt?.whyMissed}`);

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

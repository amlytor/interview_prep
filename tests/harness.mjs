// Shared bits for the end-to-end suites.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

export const APP_URL = process.env.APP_URL ?? "http://localhost:4173/";
export const MOCK_URL = process.env.MOCK_URL ?? "http://localhost:4599/v1";

// Read from the seed file rather than hardcoded, so adding a topic doesn't
// break unrelated suites. The assertions that use this are about the DELTA
// from creating or deleting a custom topic, not about the taxonomy's size.
export const SEEDED_TOPICS = JSON.parse(
  readFileSync(new URL("../src/data/studyNotes.json", import.meta.url), "utf8"),
).notes.length;

/**
 * Launch Chromium. Honours CHROMIUM_PATH for environments with a pre-installed
 * browser; otherwise Playwright resolves its own (run `npx playwright install
 * chromium` once).
 */
export function launch() {
  return chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
}

/**
 * Click a sidebar destination. Scoped to the nav because page content can carry
 * buttons with the same words ("Start Drilling" vs the Drill nav item).
 */
export function nav(page, name) {
  return page.locator("nav.sidebar").getByRole("button", { name }).click();
}

/** Collects pass/fail lines and exits non-zero if anything failed. */
export function reporter() {
  const results = [];
  return {
    check(name, ok, detail = "") {
      results.push(Boolean(ok));
      console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
    },
    finish() {
      const failed = results.filter((r) => !r).length;
      console.log(`\n${results.length - failed}/${results.length} passed`);
      process.exit(failed === 0 ? 0 : 1);
    },
  };
}

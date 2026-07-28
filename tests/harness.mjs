// Shared bits for the end-to-end suites.
import { chromium } from "playwright";

export const APP_URL = process.env.APP_URL ?? "http://localhost:4173/";
export const MOCK_URL = process.env.MOCK_URL ?? "http://localhost:4599/v1";

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

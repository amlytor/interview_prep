// Content invariants for the seed bank. No browser needed — this reads the
// JSON directly, so it runs in milliseconds and catches the class of mistake
// that the e2e suites cannot see: a question pointing at a topic with no note,
// an out-of-range multiple-choice index, a prompt added twice, or a topic
// quietly dropping below its depth target.
//
// The depth targets encode a judgement, not a rule. Not every topic warrants
// 30 questions: `pigeonhole` and `coupon-collector` are single-technique
// topics where 15-20 exhausts the material, while `statistics` and
// `stochastic-calculus` carry a whole discipline each. DEEP lists the topics
// judged broad enough (or central enough to a market-risk role) to need the
// full 30. Everything else has a lower floor.
import { readFileSync } from "node:fs";
import { reporter } from "./harness.mjs";

const { check, finish } = reporter();
const root = new URL("../src/data/", import.meta.url);
const questions = JSON.parse(readFileSync(new URL("seedQuestions.json", root), "utf8")).questions;
const notes = JSON.parse(readFileSync(new URL("studyNotes.json", root), "utf8")).notes;

const DEEP_TARGET = 30;
const OTHER_FLOOR = 6; // what the README promises for every topic

const DEEP = [
  // Market risk — the areas closest to the day job.
  "var-risk-theory", "var-model-building", "extreme-value-theory", "interest-rate-risk",
  "correlations-copulas", "basel-frtb", "stress-testing", "model-risk", "liquidity-risk",
  "counterparty-margin", "time-series-vol",
  // Derivatives pricing.
  "derivatives-greeks", "black-scholes", "implied-volatility", "risk-neutral-valuation",
  "stochastic-calculus", "martingales",
  // Broad quantitative foundations.
  "basic-probability", "conditional-probability", "continuous-distributions", "combinatorics",
  "statistics", "portfolio-theory", "linear-algebra", "calculus-methods", "markov-chains",
];

const counts = {};
const easy = {};
for (const q of questions) {
  counts[q.topicId] = (counts[q.topicId] ?? 0) + 1;
  if (q.difficulty === "easy") easy[q.topicId] = (easy[q.topicId] ?? 0) + 1;
}

// --- referential integrity --------------------------------------------------
const noteIds = new Set(notes.map((n) => n.topicId));
const orphans = [...new Set(questions.map((q) => q.topicId))].filter((t) => !noteIds.has(t));
check("every question points at a real note", orphans.length === 0, orphans.join(", "));

const deepMissing = DEEP.filter((t) => !noteIds.has(t));
check("every topic named in DEEP still exists", deepMissing.length === 0, deepMissing.join(", "));

// --- shape ------------------------------------------------------------------
const malformed = questions.filter((q) => {
  if (!q.prompt?.trim() || !q.explanation?.trim()) return true;
  if (q.type === "free_text") return !q.canonicalAnswer?.trim();
  if (q.type !== "multiple_choice") return true;
  return (
    !Array.isArray(q.options) ||
    q.options.length < 3 ||
    !Number.isInteger(q.correctOption) ||
    q.correctOption < 0 ||
    q.correctOption >= q.options.length
  );
});
check("every question is well formed", malformed.length === 0, malformed[0]?.prompt?.slice(0, 60));

// --- no repeats -------------------------------------------------------------
// Exact-text only. Near-duplicate screening happens at authoring time; this is
// the backstop for the same question being pasted in twice.
const seen = new Map();
const repeats = [];
for (const q of questions) {
  const key = q.prompt.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (seen.has(key)) repeats.push(q.prompt.slice(0, 60));
  else seen.set(key, true);
}
check("no prompt appears twice", repeats.length === 0, repeats.slice(0, 3).join(" | "));

// --- prerequisite graph -----------------------------------------------------
const byId = new Map(notes.map((n) => [n.topicId, n]));
const badPrereqs = [];
for (const n of notes) {
  for (const p of n.prereqs ?? []) {
    if (!byId.has(p)) badPrereqs.push(`${n.topicId} -> ${p}`);
    if (p === n.topicId) badPrereqs.push(`${n.topicId} is its own prereq`);
  }
}
check("every prerequisite names a real topic", badPrereqs.length === 0, badPrereqs.join(", "));

const state = new Map();
const cycles = [];
function visit(id, path) {
  if (state.get(id) === "done") return;
  if (state.get(id) === "open") return void cycles.push([...path, id].join(" -> "));
  state.set(id, "open");
  for (const p of byId.get(id)?.prereqs ?? []) visit(p, [...path, id]);
  state.set(id, "done");
}
for (const n of notes) visit(n.topicId, []);
check("the prerequisite graph is acyclic", cycles.length === 0, cycles[0]);

// --- depth ------------------------------------------------------------------
const shallow = DEEP.filter((t) => (counts[t] ?? 0) < DEEP_TARGET);
check(
  `every DEEP topic has ${DEEP_TARGET}+ questions`,
  shallow.length === 0,
  shallow.map((t) => `${t}=${counts[t] ?? 0}`).join(", "),
);

const thin = notes
  .map((n) => n.topicId)
  .filter((t) => !DEEP.includes(t) && (counts[t] ?? 0) < OTHER_FLOOR);
check(`every other topic has ${OTHER_FLOOR}+`, thin.length === 0, thin.join(", "));

// --- an entry point per topic ----------------------------------------------
// Practice serves the easiest band first, which only helps if an easy band
// exists. fixed-income is deliberately excluded — deprioritised by the user.
const noRamp = notes
  .map((n) => n.topicId)
  .filter((t) => t !== "fixed-income" && (easy[t] ?? 0) < 4);
check("every topic (bar fixed-income) has 4+ easy questions", noRamp.length === 0, noRamp.join(", "));

// --- notes teach ------------------------------------------------------------
const noExample = notes.filter((n) => !/##+\s*worked example/i.test(n.body)).map((n) => n.topicId);
check("every note carries a worked example", noExample.length === 0, noExample.join(", "));

// A note has to keep pace with its question bank. Tripling the banks without
// touching the notes once left combinatorics with 30 questions on a 2,200-word
// note that never named the multiplication principle — someone reading it cold
// was being asked things it had never covered. This is a crude proxy for that,
// but it catches the specific regression: questions added, note left alone.
const MIN_CHARS_PER_QUESTION = 100;
const thinNotes = notes
  .map((n) => [n.topicId, Math.round(n.body.length / Math.max(1, counts[n.topicId] ?? 0))])
  .filter(([, density]) => density < MIN_CHARS_PER_QUESTION);
check(
  `every note has ${MIN_CHARS_PER_QUESTION}+ characters per question it backs`,
  thinNotes.length === 0,
  thinNotes.map(([t, d]) => `${t}=${d}`).join(", "),
);

// The narrower topics have their own, lower target. fixed-income is exempt —
// deliberately deprioritised, so it keeps only the OTHER_FLOOR guarantee.
const SHALLOW_TARGET = 18;
const belowShallow = notes
  .map((n) => n.topicId)
  .filter((t) => !DEEP.includes(t) && t !== "fixed-income" && (counts[t] ?? 0) < SHALLOW_TARGET);
check(
  `every narrower topic has ${SHALLOW_TARGET}+ questions`,
  belowShallow.length === 0,
  belowShallow.map((t) => `${t}=${counts[t] ?? 0}`).join(", "),
);

console.log(`\nbank: ${questions.length} authored questions across ${notes.length} notes`);

finish();

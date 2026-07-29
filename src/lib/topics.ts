// Canonical topic taxonomy. The ids come from src/data/studyNotes.json and are
// the stable identifiers stored on questions, notes, and attempts; `label` is
// only for display. Two topics (basic-probability, conditional-probability)
// were added in v2 and have no v1 counterpart.
//
// TopicId is `KnownTopicId | (string & {})` rather than a closed union: the
// union half keeps editor autocomplete for the 42 seeded ids, the `string`
// half lets user-created topics carry runtime-generated slugs. Custom ids are
// registered at load time so topicLabel() can render them.
export type KnownTopicId =
  | "basic-probability"
  | "geometric-distribution"
  | "enumerate-scenarios"
  | "without-replacement-shortcut"
  | "complementary-counting"
  | "symmetry-condition-first"
  | "gamblers-ruin"
  | "coupon-collector"
  | "bayes-theorem"
  | "conditional-probability"
  | "combinatorics"
  | "pigeonhole"
  | "linearity-of-expectation"
  | "recursive-states"
  | "continuous-distributions"
  | "out-of-the-box"
  | "derivatives-greeks"
  | "var-risk-theory"
  | "statistics"
  | "fixed-income"
  | "portfolio-theory"
  | "time-series-vol"
  | "optimal-stopping"
  | "estimation-fermi"
  | "calculus-methods"
  | "linear-algebra"
  | "markov-chains"
  | "martingales"
  | "stochastic-calculus"
  | "order-statistics"
  | "algorithms-numerical"
  | "modular-arithmetic"
  | "proof-techniques"
  | "interest-rate-risk"
  | "correlations-copulas"
  | "extreme-value-theory"
  | "var-model-building"
  | "basel-frtb"
  | "counterparty-margin"
  | "stress-testing"
  | "liquidity-risk"
  | "model-risk";

// eslint-disable-next-line @typescript-eslint/ban-types
export type TopicId = KnownTopicId | (string & {});

export interface TopicInfo {
  id: TopicId;
  label: string;
}

export const TOPICS: TopicInfo[] = [
  { id: "basic-probability", label: "Basic probability" },
  { id: "conditional-probability", label: "Conditional probability" },
  { id: "geometric-distribution", label: "Geometric distribution" },
  { id: "enumerate-scenarios", label: "Enumerate scenarios" },
  { id: "without-replacement-shortcut", label: "Without-replacement shortcut" },
  { id: "complementary-counting", label: "Complementary counting" },
  { id: "symmetry-condition-first", label: "Symmetry/condition-on-first-step" },
  { id: "gamblers-ruin", label: "Gambler's ruin" },
  { id: "coupon-collector", label: "Coupon collector" },
  { id: "bayes-theorem", label: "Bayes theorem" },
  { id: "combinatorics", label: "Combinatorics" },
  { id: "pigeonhole", label: "Pigeonhole" },
  { id: "linearity-of-expectation", label: "Linearity of expectation" },
  { id: "recursive-states", label: "Recursive states" },
  { id: "continuous-distributions", label: "Continuous distributions" },
  { id: "out-of-the-box", label: "Out-of-the-box logic" },
  { id: "derivatives-greeks", label: "Derivatives/Greeks" },
  { id: "var-risk-theory", label: "VaR/risk theory" },
  { id: "statistics", label: "Statistics" },
  { id: "fixed-income", label: "Fixed income & the yield curve" },
  { id: "portfolio-theory", label: "Portfolio theory & CAPM" },
  { id: "time-series-vol", label: "Time series & volatility modelling" },
  { id: "optimal-stopping", label: "Optimal stopping & game strategy" },
  { id: "estimation-fermi", label: "Fermi estimation & valuation" },
  { id: "calculus-methods", label: "Calculus methods" },
  { id: "linear-algebra", label: "Linear algebra" },
  { id: "markov-chains", label: "Markov chains" },
  { id: "martingales", label: "Martingales & random walks" },
  { id: "stochastic-calculus", label: "Brownian motion & Ito calculus" },
  { id: "order-statistics", label: "Order statistics" },
  { id: "algorithms-numerical", label: "Algorithms & numerical methods" },
  { id: "modular-arithmetic", label: "Modular arithmetic & number theory" },
  { id: "proof-techniques", label: "Proof techniques" },
  { id: "interest-rate-risk", label: "Interest rate risk management" },
  { id: "correlations-copulas", label: "Correlations & copulas" },
  { id: "extreme-value-theory", label: "Historical simulation & EVT" },
  { id: "var-model-building", label: "Model-building VaR" },
  { id: "basel-frtb", label: "Basel & FRTB" },
  { id: "counterparty-margin", label: "Counterparty risk, margin & CCPs" },
  { id: "stress-testing", label: "Scenario analysis & stress testing" },
  { id: "liquidity-risk", label: "Liquidity risk" },
  { id: "model-risk", label: "Model risk" },
];

const SEED_LABEL_BY_ID = new Map<string, string>(TOPICS.map((t) => [t.id, t.label]));

// User-created topics live in AppData, but topicLabel() is called from dozens
// of render paths that have no access to the store. The store mirrors them into
// this module-level registry on every load/change so display stays a pure
// id -> label lookup. Display-only: nothing here is persisted.
let customTopics: TopicInfo[] = [];
let labelById = new Map(SEED_LABEL_BY_ID);

/** Called by the store whenever AppData.customTopics changes. */
export function registerCustomTopics(topics: TopicInfo[]): void {
  customTopics = topics;
  labelById = new Map(SEED_LABEL_BY_ID);
  for (const t of topics) labelById.set(t.id, t.label);
}

/** The 42 seeded topics plus whatever the user has added, for pickers. */
export function allTopics(): TopicInfo[] {
  return [...TOPICS, ...customTopics];
}

/** Display label for a topic id; falls back to the raw id for unknown values. */
export function topicLabel(id: string): string {
  return labelById.get(id) ?? id;
}

/** True for one of the 42 seeded ids (not user-created ones). */
export function isKnownTopicId(value: string): value is KnownTopicId {
  return SEED_LABEL_BY_ID.has(value);
}

/**
 * Turn a title into a stable topic id, avoiding collisions with seeded ids and
 * with topics the user already has.
 */
export function slugifyTopic(title: string, taken: Iterable<string>): TopicId {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "topic";
  const used = new Set<string>([...SEED_LABEL_BY_ID.keys(), ...taken]);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

// v1 stored topics as display strings. This map drives the v1 -> v2 migration
// (and importing old JSON backups). All 17 v1 labels map 1:1 onto ids.
export const V1_LABEL_TO_ID: Record<string, TopicId> = {
  "Geometric distribution": "geometric-distribution",
  "Enumerate scenarios": "enumerate-scenarios",
  "Without-replacement shortcut": "without-replacement-shortcut",
  "Complementary counting": "complementary-counting",
  "Symmetry/condition-on-first-step": "symmetry-condition-first",
  "Gambler's ruin": "gamblers-ruin",
  "Coupon collector": "coupon-collector",
  "Bayes theorem": "bayes-theorem",
  "Combinatorics": "combinatorics",
  "Pigeonhole": "pigeonhole",
  "Linearity of expectation": "linearity-of-expectation",
  "Recursive states": "recursive-states",
  "Continuous distributions": "continuous-distributions",
  "Out-of-the-box logic": "out-of-the-box",
  "Derivatives/Greeks": "derivatives-greeks",
  "VaR/risk theory": "var-risk-theory",
  "Statistics": "statistics",
};
